import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentEmployeeId, getReportEmployeeIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyItCollected } from "@/lib/notify";
import { invalidateUnresolvedCollectionsCache } from "@/lib/unresolved-cache";

const bodySchema = z.object({
  assetTag: z.string().min(1),
  serial: z.string().optional(),
  assignedToEmployeeId: z.string().min(1),
  notes: z.string().optional(),
  collectedByRole: z.enum(["manager", "it"]).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const managerId = await getCurrentEmployeeId();
  if (!managerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reportIds = await getReportEmployeeIds(managerId);
  const directOnly = reportIds.length === 0;
  const scope = directOnly
    ? (await prisma.user.findMany({
        where: { manager: { employeeId: managerId } },
        select: { employeeId: true },
      })).map((u) => u.employeeId)
    : reportIds;
  const raw = await req.json().catch(() => ({}));
  if (!scope.includes((raw as { assignedToEmployeeId?: string }).assignedToEmployeeId ?? "")) {
    return NextResponse.json({ error: "Forbidden: not in your report scope" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { assetTag, serial, assignedToEmployeeId, notes, collectedByRole } = parsed.data;
  if (!scope.includes(assignedToEmployeeId)) {
    return NextResponse.json({ error: "Forbidden: not in your report scope" }, { status: 403 });
  }

  const manager = await prisma.user.findUnique({
    where: { employeeId: managerId },
    select: { id: true, displayName: true },
  });
  const assignee = await prisma.user.findUnique({
    where: { employeeId: assignedToEmployeeId },
    select: { displayName: true },
  });
  if (!manager || !assignee) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const equipment = await prisma.equipmentAssignment.findFirst({
    where: { assetTag, assignedToEmployeeId },
  });

  const event = await prisma.collectionEvent.create({
    data: {
      assetTag,
      serial: serial ?? null,
      assignedToEmployeeId,
      markedCollectedByManagerId: manager.id,
      notes: notes ?? null,
      status: "COLLECTED_PENDING_IT",
      collectedByRole: collectedByRole ?? "manager",
      equipmentAssignmentId: equipment?.id ?? null,
    },
  });

  if (equipment) {
    await prisma.equipmentAssignment.delete({ where: { id: equipment.id } });
  }

  const resolvedUnresolved = await prisma.unresolvedCollection.updateMany({
    where: {
      status: "UNRESOLVED",
      assetTag,
    },
    data: {
      status: "RESOLVED",
      resolvedAt: event.markedCollectedAt,
    },
  });
  if (resolvedUnresolved.count > 0) {
    await invalidateUnresolvedCollectionsCache();
  }

  const notifyResult = await notifyItCollected({
    assetTag,
    serial,
    employeeId: assignedToEmployeeId,
    employeeName: assignee.displayName,
    markedByManagerId: managerId,
    markedByManagerName: manager.displayName,
    notes,
    markedAt: event.markedCollectedAt.toISOString(),
    eventId: event.id,
  });
  if (!notifyResult.ok) {
    console.warn("IT notification failed:", notifyResult.error);
  }

  return NextResponse.json({
    id: event.id,
    assetTag: event.assetTag,
    status: event.status,
    markedCollectedAt: event.markedCollectedAt.toISOString(),
    notificationSent: notifyResult.ok,
  });
}
