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

type TreeNode = {
  employeeId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  depth: number;
  assigned: number;
  collected: number;
  outstanding: number;
  children: TreeNode[];
};

async function buildTree(parentId: string, depth: number, maxDepth: number): Promise<TreeNode[]> {
  if (maxDepth > 0 && depth > maxDepth) return [];

  const reports = await prisma.user.findMany({
    where: {
      managerId: parentId,
      ...reportDirectoryUserScope(),
    },
    select: {
      id: true,
      employeeId: true,
      displayName: true,
      email: true,
      isActive: true,
    },
    orderBy: { displayName: "asc" },
  });

  const metricsByEmployee = await loadReportEquipmentMetrics(
    reports.map((report) => report.employeeId),
  );
  const nodes: TreeNode[] = [];
  for (const report of reports) {
    const metrics = getReportEquipmentMetrics(metricsByEmployee, report.employeeId);
    const children = await buildTree(report.id, depth + 1, maxDepth);
    if (!isOperationalReport(report.isActive, metrics) && children.length === 0) continue;

    nodes.push({
      employeeId: report.employeeId,
      displayName: report.displayName,
      email: report.email,
      isActive: report.isActive,
      depth,
      assigned: metrics.assigned,
      collected: metrics.collected,
      outstanding: report.isActive ? 0 : metrics.open,
      children,
    });
  }

  return nodes;
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

  const maxDepthParam = req.nextUrl.searchParams.get("depth");
  const maxDepth = maxDepthParam ? parseInt(maxDepthParam, 10) : 0; // 0 = unlimited

  const tree = await buildTree(manager.id, 1, maxDepth);
  return NextResponse.json(tree);
}
