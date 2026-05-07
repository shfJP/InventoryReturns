import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getReportEmployeeIds } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const managerId = await getCurrentEmployeeId();
  if (!managerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reportIds = await getReportEmployeeIds(managerId);
  const scope = reportIds.length > 0 ? reportIds : (await prisma.user.findMany({
    where: { manager: { employeeId: managerId } },
    select: { employeeId: true },
  })).map((u) => u.employeeId);

  const employeeId = req.nextUrl.searchParams.get("employee_id");
  const targetIds = employeeId ? (scope.includes(employeeId) ? [employeeId] : []) : scope;
  if (targetIds.length === 0 && employeeId) {
    return NextResponse.json({ error: "Forbidden or not found" }, { status: 403 });
  }

  const includeCollected = req.nextUrl.searchParams.get("include_collected") === "true";

  const fromDb = await prisma.equipmentAssignment.findMany({
    where: { assignedToEmployeeId: { in: targetIds } },
    select: {
      id: true,
      assetTag: true,
      aid: true,
      serial: true,
      model: true,
      title: true,
      catName: true,
      locationName: true,
      statusName: true,
      detailsJson: true,
      assignedToEmployeeId: true,
      source: true,
      lastSyncedAt: true,
    },
    orderBy: { assetTag: "asc" },
  });

  const items = fromDb.map((e) => ({
    id: e.id,
    assetTag: e.assetTag,
    aid: e.aid ?? undefined,
    serial: e.serial ?? undefined,
    model: e.model ?? undefined,
    title: e.title ?? undefined,
    catName: e.catName ?? undefined,
    locationName: e.locationName ?? undefined,
    statusName: e.statusName ?? undefined,
    details: e.detailsJson ? JSON.parse(e.detailsJson) : undefined,
    assignedToEmployeeId: e.assignedToEmployeeId,
    source: e.source,
    lastSyncedAt: e.lastSyncedAt?.toISOString() ?? null,
  }));

  const collectionEvents = await prisma.collectionEvent.findMany({
    where: {
      assignedToEmployeeId: { in: targetIds },
      status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] },
    },
    select: { assetTag: true, assignedToEmployeeId: true },
  });
  const collectedSet = new Set(
    collectionEvents.map((ce) => `${ce.assetTag}-${ce.assignedToEmployeeId}`)
  );

  const annotated = items.map((e) => ({
    ...e,
    collectionStatus: collectedSet.has(`${e.assetTag}-${e.assignedToEmployeeId}`)
      ? ("collected" as const)
      : ("outstanding" as const),
  }));

  const result = includeCollected
    ? annotated
    : annotated.filter((e) => e.collectionStatus === "outstanding");

  return NextResponse.json(result);
}
