import { NextResponse } from "next/server";
import { getCurrentEmployeeId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const managerId = await getCurrentEmployeeId();
  if (!managerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const manager = await prisma.user.findUnique({
    where: { employeeId: managerId },
    select: { id: true },
  });
  if (!manager) {
    return NextResponse.json({ error: "Manager not found" }, { status: 404 });
  }

  const directReports = await prisma.user.findMany({
    where: { managerId: manager.id },
    select: {
      employeeId: true,
      displayName: true,
      email: true,
      isActive: true,
    },
    orderBy: { displayName: "asc" },
  });

  const result = await Promise.all(
    directReports.map(async (report) => {
      const assigned = await prisma.equipmentAssignment.count({
        where: { assignedToEmployeeId: report.employeeId },
      });
      const collected = await prisma.collectionEvent.count({
        where: {
          assignedToEmployeeId: report.employeeId,
          status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] },
        },
      });
      return {
        ...report,
        assigned,
        collected,
        outstanding: report.isActive ? 0 : assigned,
        // Outstanding means current equipment assigned to a disabled or missing Entra user.
        totalEverAssigned: assigned + collected,
      };
    })
  );

  return NextResponse.json(result);
}
