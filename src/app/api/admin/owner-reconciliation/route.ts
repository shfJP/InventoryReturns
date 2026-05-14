import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getMissingReftabAssetRow, getOwnerReconciliationResult, getOwnerReconciliationRow } from "@/lib/owner-reconciliation";
import { createAndAssignReftabAsset, reconcileReftabAssetOwner } from "@/lib/ref-tab";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
  action: z.enum(["reassign-owner", "add-missing-asset"]).default("reassign-owner"),
  assetTag: z.string().min(1),
  ninjaDeviceId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getOwnerReconciliationResult();
  return NextResponse.json({ ...result, count: result.rows.length });
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

  if (parsed.data.action === "add-missing-asset") {
    const row = await getMissingReftabAssetRow(parsed.data.ninjaDeviceId);
    if (!row || row.assetTag !== parsed.data.assetTag) {
      return NextResponse.json({ error: "No current NinjaOne device missing from Reftab was found for this request." }, { status: 404 });
    }
    if (!row.ninjaOwner?.isActive) {
      return NextResponse.json({ error: "This NinjaOne device does not resolve to an active Entra owner yet." }, { status: 400 });
    }

    try {
      const result = await createAndAssignReftabAsset({
        assetTag: row.assetTag,
        serial: row.serial,
        model: row.model,
        title: row.title,
        newOwnerEmployeeId: row.ninjaOwner.employeeId,
        newOwnerEmail: row.ninjaOwner.email,
        note: `Asset created from NinjaOne device ${row.ninjaDevice.id} and assigned to ${row.ninjaOwner.employeeId}.`,
      });

      await prisma.equipmentAssignment.upsert({
        where: {
          assetTag_assignedToEmployeeId: {
            assetTag: row.assetTag,
            assignedToEmployeeId: row.ninjaOwner.employeeId,
          },
        },
        update: {
          aid: result.aid,
          serial: row.serial,
          model: row.model,
          title: row.title,
          source: "ref_tab",
          lastSyncedAt: new Date(),
        },
        create: {
          assetTag: row.assetTag,
          aid: result.aid,
          serial: row.serial,
          model: row.model,
          title: row.title,
          assignedToEmployeeId: row.ninjaOwner.employeeId,
          source: "ref_tab",
          lastSyncedAt: new Date(),
        },
      });

      const refreshed = await getOwnerReconciliationResult();
      return NextResponse.json({ ok: true, result, ...refreshed, count: refreshed.rows.length });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Missing asset creation failed" }, { status: 500 });
    }
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

    const refreshed = await getOwnerReconciliationResult();
    return NextResponse.json({ ok: true, result, ...refreshed, count: refreshed.rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Owner reconciliation failed" }, { status: 500 });
  }
}
