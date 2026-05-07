import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  values: z.array(z.object({
    category: z.string().min(1),
    estimatedValueCents: z.number().int().min(0),
  })),
});

function normalizeCategory(category: string | null | undefined) {
  return category?.trim() || "Uncategorized";
}

function isKnownManager(item: { managerEmployeeId: string | null; managerEmail: string | null; managerName: string | null }) {
  return Boolean(
    item.managerEmployeeId?.trim() ||
    item.managerEmail?.trim() ||
    (item.managerName?.trim() && item.managerName.trim().toLowerCase() !== "unknown")
  );
}

function valueForCategory(category: string | null | undefined, values: Map<string, number>) {
  return values.get(normalizeCategory(category).toLowerCase()) ?? 0;
}

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [savedValues, equipmentCategories, unresolvedCategories, unresolved, activeUsers] = await Promise.all([
    prisma.assetCategoryValue.findMany({ orderBy: { category: "asc" } }),
    prisma.equipmentAssignment.findMany({ select: { catName: true } }),
    prisma.unresolvedCollection.findMany({ select: { catName: true } }),
    prisma.unresolvedCollection.findMany({
      where: { status: "UNRESOLVED" },
      select: {
        id: true,
        catName: true,
        managerEmployeeId: true,
        managerEmail: true,
        managerName: true,
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { employeeId: true, email: true, upn: true },
    }),
  ]);

  const categories = new Set<string>();
  for (const row of savedValues) categories.add(normalizeCategory(row.category));
  for (const row of equipmentCategories) categories.add(normalizeCategory(row.catName));
  for (const row of unresolvedCategories) categories.add(normalizeCategory(row.catName));

  const valuesByCategory = new Map(savedValues.map((row) => [row.category.trim().toLowerCase(), row.estimatedValueCents]));
  const activeUserAliases = new Set<string>();
  for (const user of activeUsers) {
    for (const value of [user.employeeId, user.email, user.upn]) {
      const alias = value?.trim().toLowerCase();
      if (alias) activeUserAliases.add(alias);
    }
  }

  let knownActiveCount = 0;
  let knownActiveEstimatedValueCents = 0;
  let unknownCount = 0;
  let unknownEstimatedValueCents = 0;
  let totalEstimatedValueCents = 0;

  for (const item of unresolved) {
    const estimatedValueCents = valueForCategory(item.catName, valuesByCategory);
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

  return NextResponse.json({
    categories: Array.from(categories)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((category) => ({
        category,
        estimatedValueCents: valuesByCategory.get(category.toLowerCase()) ?? 0,
      })),
    summary: {
      knownActive: {
        count: knownActiveCount,
        estimatedValueCents: knownActiveEstimatedValueCents,
      },
      unknown: {
        count: unknownCount,
        estimatedValueCents: unknownEstimatedValueCents,
      },
      total: {
        count: unresolved.length,
        estimatedValueCents: totalEstimatedValueCents,
      },
    },
  });
}

export async function PUT(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  for (const value of parsed.data.values) {
    const category = normalizeCategory(value.category);
    await prisma.assetCategoryValue.upsert({
      where: { category },
      update: { estimatedValueCents: value.estimatedValueCents },
      create: { category, estimatedValueCents: value.estimatedValueCents },
    });
  }

  return GET(req);
}
