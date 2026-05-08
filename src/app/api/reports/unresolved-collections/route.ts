import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentEmployeeId, getReportEmployeeIds } from "@/lib/auth";
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

  const raw = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const data: { status?: string; investigationNotes?: string | null; resolvedAt?: Date | null } = {};
  if (parsed.data.status) {
    data.status = parsed.data.status;
    data.resolvedAt = parsed.data.status === "RESOLVED" ? new Date() : null;
  }
  if ("investigationNotes" in parsed.data) {
    data.investigationNotes = parsed.data.investigationNotes ?? null;
  }

  const updated = await prisma.unresolvedCollection.update({
    where: { id: parsed.data.id },
    data,
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    investigationNotes: updated.investigationNotes,
    resolvedAt: updated.resolvedAt?.toISOString() ?? null,
  });
}
