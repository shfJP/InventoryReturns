import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAccessProfile } from "@/lib/access-control";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  employeeId: z.string().trim().min(1).max(120),
  employeeName: z.string().trim().max(240).optional(),
  system: z.string().trim().min(2).max(120),
  issueType: z.enum(["ACCOUNT_MISSING", "ACCESS_INCORRECT", "PROVISIONING_FAILED", "DEPROVISIONING_FAILED", "OTHER"]),
  description: z.string().trim().min(5).max(4_000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["OPEN", "IN_REVIEW", "WAITING", "RESOLVED", "REJECTED"]),
  assignedToEmployeeId: z.string().trim().max(120).nullable().optional(),
  resolutionNotes: z.string().trim().max(4_000).optional(),
});

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const canManage = access.canManageAccountRemediation;
  const items = await prisma.accountRemediation.findMany({
    where: canManage ? undefined : {
      OR: [
        { requesterEmployeeId: access.user.employeeId },
        { employeeId: access.user.employeeId },
      ],
    },
    include: { auditEvents: { orderBy: { createdAt: "desc" }, take: 10 } },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return NextResponse.json({ items, canManage });
}

export async function POST(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });

  const item = await prisma.accountRemediation.create({
    data: {
      ...parsed.data,
      employeeName: parsed.data.employeeName || null,
      requesterEmployeeId: access.user.employeeId,
      requesterName: access.user.displayName,
      auditEvents: {
        create: {
          action: "CREATED",
          newStatus: "OPEN",
          note: parsed.data.description,
          actorEmployeeId: access.user.employeeId,
          actorName: access.user.displayName,
        },
      },
    },
  });
  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canManageAccountRemediation) {
    return NextResponse.json({ error: "Forbidden: account-support access is required" }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  const existing = await prisma.accountRemediation.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return NextResponse.json({ error: "Workflow item not found" }, { status: 404 });
  const terminal = ["RESOLVED", "REJECTED"].includes(parsed.data.status);
  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.accountRemediation.update({
      where: { id: parsed.data.id },
      data: {
        status: parsed.data.status,
        assignedToEmployeeId: parsed.data.assignedToEmployeeId,
        resolutionNotes: parsed.data.resolutionNotes || null,
        resolvedAt: terminal ? new Date() : null,
        resolvedByEmployeeId: terminal ? access.user.employeeId : null,
      },
    });
    await tx.accountRemediationAudit.create({
      data: {
        accountRemediationId: updated.id,
        action: "STATUS_CHANGED",
        oldStatus: existing.status,
        newStatus: updated.status,
        note: parsed.data.resolutionNotes || null,
        actorEmployeeId: access.user.employeeId,
        actorName: access.user.displayName,
      },
    });
    return updated;
  });
  return NextResponse.json(item);
}
