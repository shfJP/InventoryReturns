import { prisma } from "./db";

export type OrganizationGroupBy = "division" | "department" | "subdivision";

export type OrganizationReportRow = {
  organization: string;
  employeeCount: number;
  activeEmployeeCount: number;
  inactiveEmployeeCount: number;
  assetCount: number;
  purchaseValueCents: number;
  replacementValueCents: number;
  bookValueCents: number;
};

export type OrganizationReport = {
  generatedAt: string;
  groupBy: OrganizationGroupBy;
  rows: OrganizationReportRow[];
  filters: {
    divisions: string[];
    departments: string[];
  };
  totals: OrganizationReportRow;
};

function isInactiveDepartment(department: string | null | undefined): boolean {
  return /^\(inactive\)/i.test(department?.trim() ?? "");
}

function wasTerminatedMoreThanOneYearAgo(
  employee: { employmentStatus: string | null; terminationDate: Date | null },
  cutoff: Date,
): boolean {
  const status = employee.employmentStatus?.trim().toUpperCase();
  return (status === "T" || status === "TERMINATED") &&
    employee.terminationDate !== null &&
    employee.terminationDate < cutoff;
}

export async function getOrganizationReport(
  groupBy: OrganizationGroupBy,
  filters: { division?: string | null; department?: string | null } = {},
): Promise<OrganizationReport> {
  const terminationCutoff = new Date();
  terminationCutoff.setUTCFullYear(terminationCutoff.getUTCFullYear() - 1);
  const hasDirectorySnapshot = await prisma.directoryEmployeeState.count() > 0;
  const organizationWhere = {
    division: filters.division || undefined,
    department: filters.department || undefined,
  };
  const [assignments, categoryValues, organizationUsers] = await Promise.all([
    prisma.equipmentAssignment.findMany({
      where: {
        user: organizationWhere,
      },
      include: {
        user: {
          select: {
            employeeId: true,
            isActive: true,
            division: true,
            department: true,
            subdivision: true,
          },
        },
      },
    }),
    prisma.assetCategoryValue.findMany(),
    hasDirectorySnapshot
      ? prisma.directoryEmployeeState.findMany({
          where: organizationWhere,
          select: {
            employeeId: true,
            isActive: true,
            employmentStatus: true,
            terminationDate: true,
            division: true,
            department: true,
            subdivision: true,
          },
        })
      : prisma.user.findMany({
          where: organizationWhere,
          select: {
            employeeId: true,
            isActive: true,
            employmentStatus: true,
            terminationDate: true,
            division: true,
            department: true,
            subdivision: true,
          },
        }),
  ]);

  const visibleUsers = organizationUsers.filter(
    (user) =>
      !isInactiveDepartment(user.department) &&
      !wasTerminatedMoreThanOneYearAgo(user, terminationCutoff),
  );
  const visibleAssignments = assignments.filter((assignment) => !isInactiveDepartment(assignment.user?.department));
  const departmentsWithAssets = new Set(
    visibleAssignments
      .map((assignment) => assignment.user?.department?.trim())
      .filter((department): department is string => Boolean(department)),
  );
  const categoryMap = new Map(categoryValues.map((item) => [item.category.trim().toLowerCase(), item.estimatedValueCents]));
  const groups = new Map<string, OrganizationReportRow>();
  const employeesByGroup = new Map<string, Set<string>>();

  function rowFor(value: string | null | undefined): OrganizationReportRow {
    const organization = value?.trim() || "Unassigned";
    const existing = groups.get(organization);
    if (existing) return existing;
    const created: OrganizationReportRow = {
      organization,
      employeeCount: 0,
      activeEmployeeCount: 0,
      inactiveEmployeeCount: 0,
      assetCount: 0,
      purchaseValueCents: 0,
      replacementValueCents: 0,
      bookValueCents: 0,
    };
    groups.set(organization, created);
    employeesByGroup.set(organization, new Set());
    return created;
  }

  for (const user of visibleUsers) {
    const organization = user[groupBy]?.trim() || "Unassigned";
    const row = rowFor(organization);
    const employees = employeesByGroup.get(organization)!;
    if (!employees.has(user.employeeId)) {
      employees.add(user.employeeId);
      row.employeeCount += 1;
      if (user.isActive) row.activeEmployeeCount += 1;
      else row.inactiveEmployeeCount += 1;
    }
  }

  for (const assignment of visibleAssignments) {
    const organization = assignment.user?.[groupBy]?.trim() || "Unassigned";
    const row = rowFor(organization);
    const categoryFallback = categoryMap.get(assignment.catName?.trim().toLowerCase() ?? "") ?? 0;
    const replacement = assignment.replacementValueCents ?? categoryFallback;
    const purchase = assignment.purchaseValueCents ?? replacement;
    const book = assignment.bookValueCents ?? replacement;
    row.assetCount += 1;
    row.purchaseValueCents += purchase;
    row.replacementValueCents += replacement;
    row.bookValueCents += book;
  }

  const rows = Array.from(groups.values())
    .filter((row) => groupBy !== "department" || row.assetCount > 0)
    .sort((a, b) => b.replacementValueCents - a.replacementValueCents || a.organization.localeCompare(b.organization));
  const unique = (key: OrganizationGroupBy) =>
    Array.from(new Set(visibleUsers.map((user) => user[key]).filter((value): value is string => Boolean(value)))).sort();
  const totals = rows.reduce<OrganizationReportRow>((sum, row) => ({
    organization: "All organizations",
    employeeCount: sum.employeeCount + row.employeeCount,
    activeEmployeeCount: sum.activeEmployeeCount + row.activeEmployeeCount,
    inactiveEmployeeCount: sum.inactiveEmployeeCount + row.inactiveEmployeeCount,
    assetCount: sum.assetCount + row.assetCount,
    purchaseValueCents: sum.purchaseValueCents + row.purchaseValueCents,
    replacementValueCents: sum.replacementValueCents + row.replacementValueCents,
    bookValueCents: sum.bookValueCents + row.bookValueCents,
  }), {
    organization: "All organizations",
    employeeCount: 0,
    activeEmployeeCount: 0,
    inactiveEmployeeCount: 0,
    assetCount: 0,
    purchaseValueCents: 0,
    replacementValueCents: 0,
    bookValueCents: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    groupBy,
    rows,
    totals,
    filters: {
      divisions: unique("division"),
      departments: Array.from(departmentsWithAssets).sort(),
    },
  };
}
