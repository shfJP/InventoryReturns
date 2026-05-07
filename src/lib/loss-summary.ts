import { prisma } from "./db";

export type LossSummary = {
  knownActive: { count: number; estimatedValueCents: number };
  unknown: { count: number; estimatedValueCents: number };
  total: { count: number; estimatedValueCents: number };
};

export type LossSummaryItem = {
  catName: string | null;
  managerEmployeeId: string | null;
  managerEmail: string | null;
  managerName: string | null;
};

function normalizeCategory(category: string | null | undefined) {
  return category?.trim() || "Uncategorized";
}

export function isKnownManager(item: { managerEmployeeId: string | null; managerEmail: string | null; managerName: string | null }) {
  return Boolean(
    item.managerEmployeeId?.trim() ||
    item.managerEmail?.trim() ||
    (item.managerName?.trim() && item.managerName.trim().toLowerCase() !== "unknown")
  );
}

export async function getCategoryValueMap() {
  const values = await prisma.assetCategoryValue.findMany();
  return new Map(values.map((row) => [row.category.trim().toLowerCase(), row.estimatedValueCents]));
}

export async function getActiveUserAliases() {
  const activeUsers = await prisma.user.findMany({
    where: { isActive: true },
    select: { employeeId: true, email: true, upn: true },
  });
  const aliases = new Set<string>();
  for (const user of activeUsers) {
    for (const value of [user.employeeId, user.email, user.upn]) {
      const alias = value?.trim().toLowerCase();
      if (alias) aliases.add(alias);
    }
  }
  return aliases;
}

export function getValueForCategory(category: string | null | undefined, values: Map<string, number>) {
  return values.get(normalizeCategory(category).toLowerCase()) ?? 0;
}

export function calculateLossSummary(items: LossSummaryItem[], valuesByCategory: Map<string, number>, activeUserAliases: Set<string>): LossSummary {
  let knownActiveCount = 0;
  let knownActiveEstimatedValueCents = 0;
  let unknownCount = 0;
  let unknownEstimatedValueCents = 0;
  let totalEstimatedValueCents = 0;

  for (const item of items) {
    const estimatedValueCents = getValueForCategory(item.catName, valuesByCategory);
    totalEstimatedValueCents += estimatedValueCents;
    const known = isKnownManager(item);
    const activeKnownManager = [item.managerEmployeeId, item.managerEmail]
      .map((value) => value?.trim().toLowerCase())
      .some((value) => Boolean(value && activeUserAliases.has(value)));

    if (known && activeKnownManager) {
      knownActiveCount++;
      knownActiveEstimatedValueCents += estimatedValueCents;
    }
    if (!known) {
      unknownCount++;
      unknownEstimatedValueCents += estimatedValueCents;
    }
  }

  return {
    knownActive: {
      count: knownActiveCount,
      estimatedValueCents: knownActiveEstimatedValueCents,
    },
    unknown: {
      count: unknownCount,
      estimatedValueCents: unknownEstimatedValueCents,
    },
    total: {
      count: items.length,
      estimatedValueCents: totalEstimatedValueCents,
    },
  };
}

export async function calculateUnresolvedLossSummary(items: LossSummaryItem[]) {
  const [valuesByCategory, activeUserAliases] = await Promise.all([
    getCategoryValueMap(),
    getActiveUserAliases(),
  ]);
  return calculateLossSummary(items, valuesByCategory, activeUserAliases);
}
