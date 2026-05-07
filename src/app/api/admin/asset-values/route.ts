import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { calculateLossSummary, getActiveUserAliases, getCategoryValueMap } from "@/lib/loss-summary";

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

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [savedValues, equipmentCategories, unresolvedCategories, unresolved, valuesByCategory, activeUserAliases] = await Promise.all([
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
    getCategoryValueMap(),
    getActiveUserAliases(),
  ]);

  const categories = new Set<string>();
  for (const row of savedValues) categories.add(normalizeCategory(row.category));
  for (const row of equipmentCategories) categories.add(normalizeCategory(row.catName));
  for (const row of unresolvedCategories) categories.add(normalizeCategory(row.catName));

  const summary = calculateLossSummary(unresolved, valuesByCategory, activeUserAliases);

  return NextResponse.json({
    categories: Array.from(categories)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((category) => ({
        category,
        estimatedValueCents: valuesByCategory.get(category.toLowerCase()) ?? 0,
      })),
    summary,
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
