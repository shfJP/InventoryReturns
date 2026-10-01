import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getReportEquipmentMetrics,
  isOperationalReport,
  loadReportEquipmentMetrics,
  reportDirectoryUserScope,
} from "@/lib/report-directory";

export const dynamic = "force-dynamic";

function selected(req: NextRequest, name: string): string | null {
  return req.nextUrl.searchParams.get(name)?.trim() || null;
}

export async function GET(req: NextRequest) {
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

  const allDirectReports = await prisma.user.findMany({
    where: {
      managerId: manager.id,
      ...reportDirectoryUserScope(),
    },
    select: {
      employeeId: true,
      displayName: true,
      email: true,
      isActive: true,
      division: true,
      department: true,
      subdivision: true,
    },
    orderBy: { displayName: "asc" },
  });
  const division = selected(req, "division");
  const department = selected(req, "department");
  const subdivision = selected(req, "subdivision");
  const directReports = allDirectReports.filter((report) =>
    (!division || report.division === division) &&
    (!department || report.department === department) &&
    (!subdivision || report.subdivision === subdivision)
  );

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

  const unique = (key: "division" | "department" | "subdivision") =>
    Array.from(new Set(allDirectReports.map((row) => row[key]).filter((value): value is string => Boolean(value)))).sort();
  return NextResponse.json({
    items: result,
    filters: {
      divisions: unique("division"),
      departments: unique("department"),
      subdivisions: unique("subdivision"),
    },
  });
}
