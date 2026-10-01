import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAccessProfile } from "@/lib/access-control";
import { getReportEmployeeIds } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  assetTag: z.string().trim().max(120).optional(),
  subjectEmployeeId: z.string().trim().max(120).optional(),
  currentOwnerEmployeeId: z.string().trim().max(120).optional(),
  proposedOwnerEmployeeId: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(500),
  details: z.string().trim().max(2_000).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"]),
  assignedToEmployeeId: z.string().trim().max(120).nullable().optional(),
  resolutionNotes: z.string().trim().max(2_000).optional(),
});

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canManage = access.canReconcile || access.canCloseOut;
  const reports = canManage ? [] : await getReportEmployeeIds(access.user.employeeId);
  const rows = await prisma.correctionRequest.findMany({
    where: canManage ? undefined : {
      OR: [
        { requesterEmployeeId: access.user.employeeId },
        { subjectEmployeeId: access.user.employeeId },
        ...(reports.length > 0 ? [{ subjectEmployeeId: { in: reports } }] : []),
      ],
    },
    include: { auditEvents: { orderBy: { createdAt: "desc" }, take: 10 } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({ items: rows, canManage });
}

export async function POST(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const created = await prisma.correctionRequest.create({
    data: {
      ...parsed.data,
      assetTag: parsed.data.assetTag || null,
      subjectEmployeeId: parsed.data.subjectEmployeeId || null,
      currentOwnerEmployeeId: parsed.data.currentOwnerEmployeeId || null,
      proposedOwnerEmployeeId: parsed.data.proposedOwnerEmployeeId || null,
      details: parsed.data.details || null,
      requesterEmployeeId: access.user.employeeId,
      requesterName: access.user.displayName,
      requesterEmail: access.user.email,
      auditEvents: {
        create: {
          action: "CREATED",
          newStatus: "OPEN",
          note: parsed.data.reason,
          actorEmployeeId: access.user.employeeId,
          actorName: access.user.displayName,
        },
      },
    },
    include: { auditEvents: true },
  });
  return NextResponse.json(created, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile && !access?.canCloseOut) {
    return NextResponse.json({ error: "Forbidden: correction-management access is required" }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const existing = await prisma.correctionRequest.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return NextResponse.json({ error: "Correction request not found" }, { status: 404 });

  const terminal = ["RESOLVED", "REJECTED"].includes(parsed.data.status);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.correctionRequest.update({
      where: { id: parsed.data.id },
      data: {
        status: parsed.data.status,
        assignedToEmployeeId: parsed.data.assignedToEmployeeId,
        resolutionNotes: parsed.data.resolutionNotes || null,
        resolvedAt: terminal ? new Date() : null,
        resolvedByEmployeeId: terminal ? access.user.employeeId : null,
      },
    });
    await tx.correctionRequestAudit.create({
      data: {
        correctionRequestId: row.id,
        action: "STATUS_CHANGED",
        oldStatus: existing.status,
        newStatus: parsed.data.status,
        note: parsed.data.resolutionNotes || null,
        actorEmployeeId: access.user.employeeId,
        actorName: access.user.displayName,
      },
    });
    return row;
  });
  return NextResponse.json(updated);
}
