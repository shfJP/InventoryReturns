import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getMissingReftabAssetRow, getOwnerReconciliationRow } from "@/lib/owner-reconciliation";
import { createAndAssignReftabAsset, fetchReftabCategories, reconcileReftabAssetOwner } from "@/lib/ref-tab";
import { getCachedOwnerReconciliationResult, invalidateOwnerReconciliationCache } from "@/lib/owner-reconciliation-cache";
import { getAccessProfile } from "@/lib/access-control";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
  action: z.enum(["reassign-owner", "add-missing-asset", "record-decision"]).default("reassign-owner"),
  assetTag: z.string().min(1),
  ninjaDeviceId: z.string().min(1),
  serial: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  categoryId: z.string().min(1).optional(),
  ownerEmployeeId: z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  decision: z.enum(["YES", "NO", "UNSURE", "DEFER"]).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2_000).optional(),
});

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) {
    return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  }

  try {
    if (req.nextUrl.searchParams.get("categories") === "1") {
      const categories = await fetchReftabCategories();
      return NextResponse.json({ categories });
    }

    const cached = await getCachedOwnerReconciliationResult(req.nextUrl.searchParams.get("refresh") === "1");
    const decisions = await prisma.reconciliationDecision.findMany({
      orderBy: { createdAt: "desc" },
      select: { assetTag: true, ninjaDeviceId: true, decision: true, createdAt: true, reason: true },
    });
    const latestDecisionByKey = new Map<string, typeof decisions[number]>();
    for (const decision of decisions) {
      const key = `${decision.assetTag}\u0000${decision.ninjaDeviceId}`;
      if (!latestDecisionByKey.has(key)) latestDecisionByKey.set(key, decision);
    }
    const deferHours = Math.max(Number(process.env.RECONCILIATION_DEFER_HOURS) || 24, 1);
    const deferCutoff = Date.now() - deferHours * 60 * 60 * 1_000;
    const suppressesRow = (decision: typeof decisions[number] | undefined) =>
      Boolean(
        decision &&
        (decision.decision !== "DEFER" || decision.createdAt.getTime() > deferCutoff),
      );
    const includeDecided = req.nextUrl.searchParams.get("includeDecided") === "1";
    const rows = includeDecided
      ? cached.result.rows
      : cached.result.rows.filter((row) => !suppressesRow(latestDecisionByKey.get(`${row.assetTag}\u0000${row.ninjaDevice.id}`)));
    return NextResponse.json({
      ...cached.result,
      rows,
      count: rows.length,
      decisionCount: latestDecisionByKey.size,
      deferHours,
      cache: { generatedAt: cached.generatedAt, expiresAt: cached.expiresAt, hit: cached.cacheHit },
    });
  } catch (e) {
    console.error("[owner-reconciliation] GET failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load owner reconciliation" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) {
    return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  }

  try {
  const raw = await req.json().catch(() => ({}));
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "record-decision") {
    if (!parsed.data.decision) {
      return NextResponse.json({ error: "Decision is required" }, { status: 400 });
    }
    const row = await getOwnerReconciliationRow(parsed.data.assetTag, parsed.data.ninjaDeviceId);
    if (!row) {
      return NextResponse.json({ error: "No current reconciliation row found" }, { status: 404 });
    }
    let correctionRequestId: string | null = null;
    if (parsed.data.decision === "NO" || parsed.data.decision === "UNSURE") {
      const correction = await prisma.correctionRequest.create({
        data: {
          source: "owner_reconciliation",
          assetTag: row.assetTag,
          subjectEmployeeId: row.ninjaOwner.employeeId,
          currentOwnerEmployeeId: row.reftabOwnerEmployeeId,
          proposedOwnerEmployeeId: row.ninjaOwner.employeeId,
          ninjaDeviceId: row.ninjaDevice.id,
          reason: parsed.data.reason?.trim() || (parsed.data.decision === "NO" ? "Suggested owner rejected" : "Owner requires investigation"),
          details: parsed.data.notes?.trim() || null,
          requesterEmployeeId: access.user.employeeId,
          requesterName: access.user.displayName,
          requesterEmail: access.user.email,
          status: "OPEN",
          auditEvents: {
            create: {
              action: "CREATED_FROM_RECONCILIATION",
              newStatus: "OPEN",
              note: parsed.data.reason?.trim() || null,
              actorEmployeeId: access.user.employeeId,
              actorName: access.user.displayName,
            },
          },
        },
      });
      correctionRequestId = correction.id;
    }
    const decision = await prisma.reconciliationDecision.create({
      data: {
        assetTag: row.assetTag,
        ninjaDeviceId: row.ninjaDevice.id,
        currentOwnerEmployeeId: row.reftabOwnerEmployeeId,
        proposedOwnerEmployeeId: row.ninjaOwner.employeeId,
        decision: parsed.data.decision,
        reason: parsed.data.reason?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        decidedByEmployeeId: access.user.employeeId,
        decidedByName: access.user.displayName,
        correctionRequestId,
      },
    });
    return NextResponse.json({ ok: true, decision, correctionRequestId });
  }

  if (parsed.data.action === "add-missing-asset") {
    const owner = parsed.data.ownerEmployeeId
      ? await prisma.user.findUnique({
          where: { employeeId: parsed.data.ownerEmployeeId },
          select: { employeeId: true, email: true, displayName: true, isActive: true },
        })
      : null;
    const row = owner
      ? {
          assetTag: parsed.data.assetTag,
          serial: parsed.data.serial ?? null,
          model: parsed.data.model ?? null,
          title: parsed.data.title ?? null,
          ninjaOwner: owner,
          ninjaDevice: { id: parsed.data.ninjaDeviceId },
        }
      : await getMissingReftabAssetRow(parsed.data.ninjaDeviceId);

    if (!row || row.assetTag !== parsed.data.assetTag) {
      return NextResponse.json({ error: "No current NinjaOne device missing from Reftab was found for this request." }, { status: 404 });
    }
    if (!row.ninjaOwner?.isActive) {
      return NextResponse.json({ error: "This NinjaOne device does not resolve to an active directory owner yet." }, { status: 400 });
    }
    const existingAssignment = await prisma.equipmentAssignment.findFirst({
      where: { assetTag: row.assetTag },
      select: { id: true },
    });
    if (existingAssignment) {
      return NextResponse.json({ error: "This asset now exists in Reftab sync data. Refresh the page before retrying." }, { status: 409 });
    }

    try {
      const result = await createAndAssignReftabAsset({
        assetTag: row.assetTag,
        serial: row.serial,
        model: row.model,
        title: row.title,
        categoryId: parsed.data.categoryId,
        newOwnerEmployeeId: row.ninjaOwner.employeeId,
        newOwnerEmail: row.ninjaOwner.email,
        newOwnerName: row.ninjaOwner.displayName,
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
      await invalidateOwnerReconciliationCache();

      return NextResponse.json({ ok: true, result, completed: { action: "add-missing-asset", assetTag: row.assetTag, ninjaDeviceId: parsed.data.ninjaDeviceId } });
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
      newOwnerName: row.ninjaOwner.displayName,
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
    await prisma.reconciliationDecision.create({
      data: {
        assetTag: row.assetTag,
        ninjaDeviceId: row.ninjaDevice.id,
        currentOwnerEmployeeId: row.reftabOwnerEmployeeId,
        proposedOwnerEmployeeId: row.ninjaOwner.employeeId,
        decision: "YES",
        reason: "Approved and written to Reftab",
        decidedByEmployeeId: access.user.employeeId,
        decidedByName: access.user.displayName,
      },
    });
    await invalidateOwnerReconciliationCache();

    return NextResponse.json({ ok: true, result, completed: { action: "reassign-owner", assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Owner reconciliation failed" }, { status: 500 });
  }
  } catch (e) {
    console.error("[owner-reconciliation] POST failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Owner reconciliation failed" }, { status: 500 });
  }
}
