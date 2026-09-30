import { NextResponse } from "next/server";
import { getCurrentEmployeeId, getReportEmployeeIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOperationalReportEmployeeIds } from "@/lib/report-directory";

export const dynamic = "force-dynamic";

export async function GET() {
  const managerId = await getCurrentEmployeeId();
  if (!managerId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const reportIds = await getReportEmployeeIds(managerId);
  const operationalReportIds = await getOperationalReportEmployeeIds(reportIds);
  const staff = await prisma.user.findMany({
    where: { employeeId: { in: operationalReportIds } },
    select: { employeeId: true, displayName: true, email: true, isActive: true },
    orderBy: { displayName: "asc" },
  });
  return NextResponse.json(staff);
}
