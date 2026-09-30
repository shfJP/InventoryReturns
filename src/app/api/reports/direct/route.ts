import { NextResponse } from "next/server";
import { getCurrentEmployeeId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getReportEquipmentMetrics,
  isOperationalReport,
  loadReportEquipmentMetrics,
  reportDirectoryUserScope,
} from "@/lib/report-directory";

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
    where: {
      managerId: manager.id,
      ...reportDirectoryUserScope(),
    },
    select: {
      employeeId: true,
      displayName: true,
      email: true,
      isActive: true,
    },
    orderBy: { displayName: "asc" },
  });

  const metricsByEmployee = await loadReportEquipmentMetrics(
    directReports.map((report) => report.employeeId),
  );
  const result = directReports
    .map((report) => {
      const metrics = getReportEquipmentMetrics(metricsByEmployee, report.employeeId);
      return {
        ...report,
        assigned: metrics.assigned,
        collected: metrics.collected,
        outstanding: report.isActive ? 0 : metrics.open,
        totalEverAssigned: metrics.totalEverAssigned,
      };
    })
    .filter((report) => isOperationalReport(report.isActive, {
      assigned: report.assigned,
      collected: report.collected,
      open: report.outstanding,
      totalEverAssigned: report.totalEverAssigned,
    }));

  return NextResponse.json(result);
}
