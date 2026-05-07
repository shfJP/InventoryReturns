import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getReportEmployeeIds } from "@/lib/auth";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const employeeId = await getCurrentEmployeeId();
  if (!employeeId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isCurrentUserAdmin(req);
  const reportIds = admin ? [] : await getReportEmployeeIds(employeeId);

  const unresolved = await prisma.unresolvedCollection.findMany({
    where: admin
      ? { status: "UNRESOLVED" }
      : {
          status: "UNRESOLVED",
          OR: [
            { managerEmployeeId: employeeId },
            { employeeId: { in: reportIds } },
          ],
        },
    orderBy: [{ detectedAt: "desc" }, { employeeName: "asc" }, { assetTag: "asc" }],
  });

  return NextResponse.json(
    unresolved.map((entry) => ({
      id: entry.id,
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      employeeEmail: entry.employeeEmail,
      managerEmployeeId: entry.managerEmployeeId,
      managerName: entry.managerName,
      managerEmail: entry.managerEmail,
      assetTag: entry.assetTag,
      serial: entry.serial,
      model: entry.model,
      detectedAt: entry.detectedAt.toISOString(),
      status: entry.status,
    }))
  );
}
