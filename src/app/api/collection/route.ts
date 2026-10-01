import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getReportEmployeeIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessProfile } from "@/lib/access-control";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const managerId = await getCurrentEmployeeId();
  if (!managerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getAccessProfile(req);
  const reportIds = await getReportEmployeeIds(managerId);
  const scope = access?.canCloseOut
    ? null
    : reportIds.length > 0 ? reportIds : (await prisma.user.findMany({
        where: { manager: { employeeId: managerId } },
        select: { employeeId: true },
      })).map((u) => u.employeeId);

  const events = await prisma.collectionEvent.findMany({
    where: scope ? { assignedToEmployeeId: { in: scope } } : undefined,
    orderBy: { markedCollectedAt: "desc" },
    include: {
      markedByManager: { select: { displayName: true, employeeId: true } },
      closedOutByIt: { select: { displayName: true, employeeId: true } },
    },
  });

  return NextResponse.json(
    events.map((e) => ({
      id: e.id,
      assetTag: e.assetTag,
      serial: e.serial,
      assignedToEmployeeId: e.assignedToEmployeeId,
      markedByManager: e.markedByManager.displayName,
      markedByManagerId: e.markedByManager.employeeId,
      markedCollectedAt: e.markedCollectedAt.toISOString(),
      notes: e.notes,
      status: e.status,
      returnRecipientRole: e.returnRecipientRole,
      returnLocation: e.returnLocation,
      notificationStatus: e.notificationStatus,
      notificationReference: e.notificationReference,
      notificationError: e.notificationError,
      closedOutAt: e.closedOutAt?.toISOString() ?? null,
      closedOutBy: e.closedOutByIt?.displayName ?? null,
    }))
  );
}
