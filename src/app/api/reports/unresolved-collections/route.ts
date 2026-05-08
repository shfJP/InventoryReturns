import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentEmployeeId, getCurrentUser, getReportEmployeeIds } from "@/lib/auth";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { calculateUnresolvedLossSummary } from "@/lib/loss-summary";

export const dynamic = "force-dynamic";

const statusValues = ["UNRESOLVED", "INVESTIGATING", "PENDING_MANAGER", "PENDING_IT", "PENDING_VENDOR", "RESOLVED"] as const;
const patchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(statusValues).optional(),
  investigationNotes: z.string().max(5000).nullable().optional(),
});

function statusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export async function GET(req: NextRequest) {
  const employeeId = await getCurrentEmployeeId();
  if (!employeeId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isCurrentUserAdmin(req);
  const reportIds = admin ? [] : await getReportEmployeeIds(employeeId);

  const unresolved = await prisma.unresolvedCollection.findMany({
    where: admin
      ? { status: { not: "RESOLVED" } }
      : {
          status: { not: "RESOLVED" },
          OR: [
            { managerEmployeeId: employeeId },
            { employeeId: { in: reportIds } },
          ],
        },
    orderBy: [{ detectedAt: "desc" }, { employeeName: "asc" }, { assetTag: "asc" }],
    include: {
      auditEvents: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  const items = unresolved.map((entry) => ({
      id: entry.id,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      employeeEmail: entry.employeeEmail,
      managerEmployeeId: entry.managerEmployeeId,
      managerName: entry.managerName,
      managerEmail: entry.managerEmail,
      assetTag: entry.assetTag,
      catName: entry.catName,
      serial: entry.serial,
      model: entry.model,
      source: entry.source,
      investigationNotes: entry.investigationNotes,
      auditEvents: entry.auditEvents.map((event) => ({
        id: event.id,
        action: event.action,
        oldStatus: event.oldStatus,
        newStatus: event.newStatus,
        note: event.note,
        actorEmployeeId: event.actorEmployeeId,
        actorName: event.actorName,
        actorEmail: event.actorEmail,
        createdAt: event.createdAt.toISOString(),
      })),
      detectedAt: entry.detectedAt.toISOString(),
      status: entry.status,
    }));
  const summary = await calculateUnresolvedLossSummary(unresolved.filter((entry) => entry.status !== "RESOLVED"));

  return NextResponse.json({ items, summary });
}

export async function PATCH(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getCurrentUser();

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.unresolvedCollection.findUnique({ where: { id: parsed.data.id } });
  if (!existing) {
    return NextResponse.json({ error: "Unresolved collection not found" }, { status: 404 });
  }

  const now = new Date();
  const data: { status?: string; investigationNotes?: string | null; resolvedAt?: Date | null } = {};
  const auditEvents: Array<{
    unresolvedCollectionId: string;
    action: string;
    oldStatus?: string | null;
    newStatus?: string | null;
    note?: string | null;
    actorEmployeeId?: string | null;
    actorName?: string | null;
    actorEmail?: string | null;
  }> = [];

  if (parsed.data.status && parsed.data.status !== existing.status) {
    data.status = parsed.data.status;
    data.resolvedAt = parsed.data.status === "RESOLVED" ? now : null;
    auditEvents.push({
      unresolvedCollectionId: existing.id,
      action: "STATUS_CHANGED",
      oldStatus: existing.status,
      newStatus: parsed.data.status,
      note: `Status changed from ${statusLabel(existing.status)} to ${statusLabel(parsed.data.status)}.`,
      actorEmployeeId: actor?.employeeId ?? null,
      actorName: actor?.displayName ?? null,
      actorEmail: actor?.email ?? null,
    });
  }

  if ("investigationNotes" in parsed.data) {
    const note = parsed.data.investigationNotes?.trim();
    if (note) {
      const actorLine = actor ? `${actor.displayName} (${actor.email})` : "Unknown user";
      const entry = `[${now.toLocaleString()}] ${actorLine}: ${note}`;
      data.investigationNotes = existing.investigationNotes ? `${existing.investigationNotes}\n\n${entry}` : entry;
      auditEvents.push({
        unresolvedCollectionId: existing.id,
        action: "NOTE_ADDED",
        note,
        actorEmployeeId: actor?.employeeId ?? null,
        actorName: actor?.displayName ?? null,
        actorEmail: actor?.email ?? null,
      });
    }
  }

  const [updated] = await prisma.$transaction([
    prisma.unresolvedCollection.update({
      where: { id: parsed.data.id },
      data,
    }),
    ...auditEvents.map((event) => prisma.unresolvedCollectionAudit.create({ data: event })),
  ]);

  const audit = await prisma.unresolvedCollectionAudit.findMany({
    where: { unresolvedCollectionId: updated.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    investigationNotes: updated.investigationNotes,
    auditEvents: audit.map((event) => ({
      id: event.id,
      action: event.action,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      note: event.note,
      actorEmployeeId: event.actorEmployeeId,
      actorName: event.actorName,
      actorEmail: event.actorEmail,
      createdAt: event.createdAt.toISOString(),
    })),
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
  });
}
