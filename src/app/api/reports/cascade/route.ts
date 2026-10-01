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
  division: string | null;
  department: string | null;
  subdivision: string | null;
  depth: number;
  assigned: number;
  collected: number;
  outstanding: number;
  children: TreeNode[];
};

type OrgFilters = { division: string | null; department: string | null; subdivision: string | null };

function matchesOrganization(report: { division: string | null; department: string | null; subdivision: string | null }, filters: OrgFilters) {
  return (!filters.division || report.division === filters.division) &&
    (!filters.department || report.department === filters.department) &&
    (!filters.subdivision || report.subdivision === filters.subdivision);
}

async function buildTree(parentId: string, depth: number, maxDepth: number, filters: OrgFilters): Promise<TreeNode[]> {
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
      division: true,
      department: true,
      subdivision: true,
    },
    orderBy: { displayName: "asc" },
  });

  const metricsByEmployee = await loadReportEquipmentMetrics(
    reports.map((report) => report.employeeId),
  );
  const nodes: TreeNode[] = [];
  for (const report of reports) {
    const metrics = getReportEquipmentMetrics(metricsByEmployee, report.employeeId);
    const children = await buildTree(report.id, depth + 1, maxDepth, filters);
    if (!matchesOrganization(report, filters) && children.length === 0) continue;
    if (!isOperationalReport(report.isActive, metrics) && children.length === 0) continue;

    nodes.push({
      employeeId: report.employeeId,
      displayName: report.displayName,
      email: report.email,
      isActive: report.isActive,
      division: report.division,
      department: report.department,
      subdivision: report.subdivision,
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
  const filters: OrgFilters = {
    division: req.nextUrl.searchParams.get("division")?.trim() || null,
    department: req.nextUrl.searchParams.get("department")?.trim() || null,
    subdivision: req.nextUrl.searchParams.get("subdivision")?.trim() || null,
  };

  const [tree, organizationRows] = await Promise.all([
    buildTree(manager.id, 1, maxDepth, filters),
    prisma.user.findMany({
      where: { employeeId: { in: await getReportEmployeeIdsForFilters(manager.id) } },
      select: { division: true, department: true, subdivision: true },
    }),
  ]);
  const unique = (key: keyof OrgFilters) =>
    Array.from(new Set(organizationRows.map((row) => row[key]).filter((value): value is string => Boolean(value)))).sort();
  return NextResponse.json({
    tree,
    filters: {
      divisions: unique("division"),
      departments: unique("department"),
      subdivisions: unique("subdivision"),
    },
  });
}

async function getReportEmployeeIdsForFilters(managerDatabaseId: string): Promise<string[]> {
  const ids: string[] = [];
  const queue = [managerDatabaseId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    const rows = await prisma.user.findMany({
      where: { managerId: parentId, ...reportDirectoryUserScope() },
      select: { id: true, employeeId: true },
    });
    for (const row of rows) {
      ids.push(row.employeeId);
      queue.push(row.id);
    }
  }
  return ids;
}
