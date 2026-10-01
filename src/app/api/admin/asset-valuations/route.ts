import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  id: z.string().min(1),
  purchaseValueCents: z.number().int().nonnegative().nullable(),
  replacementValueCents: z.number().int().nonnegative().nullable(),
  bookValueCents: z.number().int().nonnegative().nullable(),
  purchaseDate: z.string().datetime().nullable(),
});

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const search = req.nextUrl.searchParams.get("search")?.trim();
  const items = await prisma.equipmentAssignment.findMany({
    where: search ? {
      OR: [
        { assetTag: { contains: search, mode: "insensitive" } },
        { serial: { contains: search, mode: "insensitive" } },
        { title: { contains: search, mode: "insensitive" } },
        { assignedToEmployeeId: { contains: search, mode: "insensitive" } },
      ],
    } : undefined,
    include: { user: { select: { displayName: true, division: true, department: true, subdivision: true } } },
    orderBy: { assetTag: "asc" },
    take: 500,
  });
  return NextResponse.json({ items });
}

export async function PATCH(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid valuation", details: parsed.error.flatten() }, { status: 400 });
  const item = await prisma.equipmentAssignment.update({
    where: { id: parsed.data.id },
    data: {
      purchaseValueCents: parsed.data.purchaseValueCents,
      replacementValueCents: parsed.data.replacementValueCents,
      bookValueCents: parsed.data.bookValueCents,
      purchaseDate: parsed.data.purchaseDate ? new Date(parsed.data.purchaseDate) : null,
    },
  });
  return NextResponse.json(item);
}
