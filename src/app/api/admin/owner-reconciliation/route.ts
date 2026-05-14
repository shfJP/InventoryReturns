import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getOwnerReconciliationRow, getOwnerReconciliationRows } from "@/lib/owner-reconciliation";
import { reconcileReftabAssetOwner } from "@/lib/ref-tab";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
  assetTag: z.string().min(1),
  ninjaDeviceId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await getOwnerReconciliationRows();
  return NextResponse.json({ rows, count: rows.length });
}

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const row = await getOwnerReconciliationRow(parsed.data.assetTag, parsed.data.ninjaDeviceId);
  if (!row) {
    return NextResponse.json({ error: "No current owner mismatch found for this asset and NinjaOne device." }, { status: 404 });
  }

  try {
    const result = await reconcileReftabAssetOwner({
      assetTag: row.assetTag,
      aid: row.aid,
      newOwnerEmployeeId: row.ninjaOwner.employeeId,
      newOwnerEmail: row.ninjaOwner.email,
      note: `Owner reconciliation approved from NinjaOne device ${row.ninjaDevice.id}. Previous Reftab owner: ${row.reftabOwnerEmployeeId}.`,
    });

    await prisma.equipmentAssignment.deleteMany({
      where: {
        assetTag: row.assetTag,
        assignedToEmployeeId: row.reftabOwnerEmployeeId,
      },
    });
    await prisma.equipmentAssignment.upsert({
      where: {
        assetTag_assignedToEmployeeId: {
          assetTag: row.assetTag,
          assignedToEmployeeId: row.ninjaOwner.employeeId,
        },
      },
      update: {
        aid: row.aid,
        serial: row.serial,
        model: row.model,
        title: row.title,
        catName: row.category,
        source: "ref_tab",
        lastSyncedAt: new Date(),
      },
      create: {
        assetTag: row.assetTag,
        aid: row.aid,
        serial: row.serial,
        model: row.model,
        title: row.title,
        catName: row.category,
        assignedToEmployeeId: row.ninjaOwner.employeeId,
        source: "ref_tab",
        lastSyncedAt: new Date(),
      },
    });

    const rows = await getOwnerReconciliationRows();
    return NextResponse.json({ ok: true, result, rows, count: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Owner reconciliation failed" }, { status: 500 });
  }
}
