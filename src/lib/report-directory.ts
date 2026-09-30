import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

const DIRECTORY_DATABASE_CONFIGURED = Boolean(process.env.DIRECTORY_DATABASE_URL?.trim());
const DIRECTORY_SOURCE = process.env.DIRECTORY_SOURCE_NAME?.trim() || "paycom";

export type ReportEquipmentMetrics = {
  assigned: number;
  collected: number;
  open: number;
  totalEverAssigned: number;
};

const EMPTY_REPORT_METRICS: ReportEquipmentMetrics = {
  assigned: 0,
  collected: 0,
  open: 0,
  totalEverAssigned: 0,
};

/**
 * Once lifecycle-directory replication is configured, only replicated users
 * belong in the reporting hierarchy. This excludes legacy Entra/UPN rows that
 * may represent the same person under a different employee ID.
 */
export function reportDirectoryUserScope(): Prisma.UserWhereInput {
  return DIRECTORY_DATABASE_CONFIGURED ? { directorySource: DIRECTORY_SOURCE } : {};
}

/**
 * Load equipment counts in batches and de-duplicate by asset tag. Inactive
 * users no longer retain a normal EquipmentAssignment after Reftab sync, so
 * unresolved collection rows must also count as currently open equipment.
 */
export async function loadReportEquipmentMetrics(
  employeeIds: string[],
): Promise<Map<string, ReportEquipmentMetrics>> {
  const uniqueEmployeeIds = Array.from(new Set(employeeIds));
  if (uniqueEmployeeIds.length === 0) return new Map();

  const [assignments, collectionEvents, unresolvedCollections] = await Promise.all([
    prisma.equipmentAssignment.findMany({
      where: { assignedToEmployeeId: { in: uniqueEmployeeIds } },
      select: { assignedToEmployeeId: true, assetTag: true },
    }),
    prisma.collectionEvent.findMany({
      where: {
        assignedToEmployeeId: { in: uniqueEmployeeIds },
        status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] },
      },
      select: { assignedToEmployeeId: true, assetTag: true },
    }),
    prisma.unresolvedCollection.findMany({
      where: {
        employeeId: { in: uniqueEmployeeIds },
        status: { not: "RESOLVED" },
      },
      select: { employeeId: true, assetTag: true },
    }),
  ]);

  type AssetSets = {
    assigned: Set<string>;
    collected: Set<string>;
    unresolved: Set<string>;
  };
  const assetsByEmployee = new Map<string, AssetSets>();
  const getAssetSets = (employeeId: string): AssetSets => {
    const existing = assetsByEmployee.get(employeeId);
    if (existing) return existing;
    const created = {
      assigned: new Set<string>(),
      collected: new Set<string>(),
      unresolved: new Set<string>(),
    };
    assetsByEmployee.set(employeeId, created);
    return created;
  };

  for (const item of assignments) {
    getAssetSets(item.assignedToEmployeeId).assigned.add(item.assetTag);
  }
  for (const item of collectionEvents) {
    getAssetSets(item.assignedToEmployeeId).collected.add(item.assetTag);
  }
  for (const item of unresolvedCollections) {
    getAssetSets(item.employeeId).unresolved.add(item.assetTag);
  }

  return new Map(uniqueEmployeeIds.map((employeeId) => {
    const assets = assetsByEmployee.get(employeeId);
    if (!assets) return [employeeId, EMPTY_REPORT_METRICS];

    const openAssets = new Set([...assets.assigned, ...assets.unresolved]);
    const allAssets = new Set([...openAssets, ...assets.collected]);
    return [employeeId, {
      assigned: assets.assigned.size,
      collected: assets.collected.size,
      open: openAssets.size,
      totalEverAssigned: allAssets.size,
    }];
  }));
}

export function getReportEquipmentMetrics(
  metricsByEmployee: Map<string, ReportEquipmentMetrics>,
  employeeId: string,
): ReportEquipmentMetrics {
  return metricsByEmployee.get(employeeId) ?? EMPTY_REPORT_METRICS;
}

/**
 * Active reports always belong in the operational views. Inactive reports
 * remain visible only while equipment is still assigned or unresolved.
 */
export function isOperationalReport(
  isActive: boolean,
  metrics: ReportEquipmentMetrics,
): boolean {
  return isActive || metrics.open > 0;
}

export async function getOperationalReportEmployeeIds(employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { employeeId: { in: employeeIds } },
    select: { employeeId: true, isActive: true },
  });
  const metrics = await loadReportEquipmentMetrics(users.map((user) => user.employeeId));

  return users
    .filter((user) => isOperationalReport(
      user.isActive,
      getReportEquipmentMetrics(metrics, user.employeeId),
    ))
    .map((user) => user.employeeId);
}
