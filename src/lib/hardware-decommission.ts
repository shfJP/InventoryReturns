import { randomUUID } from "crypto";
import { prisma } from "./db";
import { getMissingReftabAssetRow } from "./owner-reconciliation";
import { createDecommissionedReftabAsset, verifyDecommissionedReftabAsset } from "./ref-tab";
import { decommissionNinjaOneDevice, getNinjaOneDecommissionDevice, NinjaOneWriteError } from "./ninjaone";
import { runAuditedExternalChange } from "./reconciliation-audit";
import { ReftabWriteError } from "./reftab-write-error";
import { DECOMMISSION_REASON, decommissionAssetNotes, decommissionEligibility } from "./decommission-policy";
import { invalidateOwnerReconciliationCache } from "./owner-reconciliation-cache";

export type DecommissionActor = { actorEmployeeId: string; actorName: string; actorEmail: string | null; jobId?: string };

async function invalidateCache() {
  await invalidateOwnerReconciliationCache().catch((error) => console.error("[decommission] Cache invalidation failed", error));
}

export async function startHardwareDecommission(
  input: { ninjaDeviceId: string; assetTag: string; categoryId: string },
  actor: DecommissionActor,
) {
  const existing = await prisma.hardwareDecommission.findUnique({ where: { ninjaDeviceId: input.ninjaDeviceId } });
  if (existing && existing.assetTag !== input.assetTag) throw new Error("The saved device identity differs from this asset tag. Review its decommission record first.");
  if (existing && existing.status !== "FAILED") return existing;
  const row = await getMissingReftabAssetRow(input.ninjaDeviceId);
  if (!row || row.assetTag !== input.assetTag) throw new Error("This device is no longer missing from Reftab. Recalculate before continuing.");
  const live = await getNinjaOneDecommissionDevice(row.ninjaDevice.id);
  const eligibility = decommissionEligibility(live);
  if (!eligibility.eligible || !eligibility.lastContact) throw new Error(eligibility.reason);
  const at = new Date();
  const id = existing?.id ?? randomUUID();
  const assetNotes = decommissionAssetNotes({ id, ...actor, ninjaDeviceId: row.ninjaDevice.id, lastContact: eligibility.lastContact, at });
  const data = {
    actorEmployeeId: actor.actorEmployeeId, actorName: actor.actorName, actorEmail: actor.actorEmail,
    assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, ninjaUid: live.uid,
    serial: row.serial, model: row.model, title: row.title,
    deviceName: row.ninjaDevice.displayName ?? row.ninjaDevice.systemName ?? row.title ?? row.assetTag,
    lastContact: eligibility.lastContact, categoryId: input.categoryId, assetNotes, status: "CREATING", error: null,
  };
  // The unique device/tag reservation prevents two reviewers creating the same asset.
  if (existing) {
    const claimed = await prisma.hardwareDecommission.updateMany({ where: { id, status: "FAILED" }, data });
    if (!claimed.count) throw new Error("Another reviewer has already started this action.");
  } else {
    await prisma.hardwareDecommission.create({ data: { id, ...data } });
  }
  let mayHaveApplied = false;
  try {
    await runAuditedExternalChange("Reftab", {
      ...actor, action: "decommission-missing-asset", assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id,
      reason: DECOMMISSION_REASON, notes: assetNotes,
      evidenceJson: JSON.stringify({ ...live, checkedAt: at.toISOString() }),
    }, async () => {
      try {
        const receipt = await createDecommissionedReftabAsset({ ...row, categoryId: input.categoryId, note: assetNotes });
        mayHaveApplied = true;
        return receipt;
      } catch (error) {
        mayHaveApplied = error instanceof ReftabWriteError && error.outcome !== "rejected";
        throw error;
      }
    }, async (tx, result) => {
      await tx.hardwareDecommission.update({
        where: { id }, data: { status: "AWAITING_CONFIRMATION", reftabAid: result.aid, error: null },
      });
    });
  } catch (error) {
    await prisma.hardwareDecommission.updateMany({
      where: { id, status: "CREATING" },
      data: { status: mayHaveApplied ? "REVIEW_REQUIRED" : "FAILED", error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    await invalidateCache();
  }
  return prisma.hardwareDecommission.findUniqueOrThrow({ where: { id } });
}

export async function verifyHardwareDecommission(id: string, actor: DecommissionActor) {
  const record = await prisma.hardwareDecommission.findUniqueOrThrow({ where: { id } });
  const receipt = await verifyDecommissionedReftabAsset(record.reftabAid ?? record.assetTag, record.assetNotes);
  if (["CREATING", "REVIEW_REQUIRED"].includes(record.status)) {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.hardwareDecommission.updateMany({
        where: { id, status: { in: ["CREATING", "REVIEW_REQUIRED"] } },
        data: { status: "AWAITING_CONFIRMATION", reftabAid: receipt.aid, error: null },
      });
      if (changed.count) await tx.reconciliationAudit.create({ data: {
        ...actor, action: "verify-decommission", status: "SUCCEEDED",
        assetTag: record.assetTag, ninjaDeviceId: record.ninjaDeviceId,
        notes: "Recovered the Reftab creation by reading back its status and app-generated notes.",
        resultJson: JSON.stringify(receipt), completedAt: new Date(),
      } });
    });
  } else if (["REMOVING", "REMOVE_REVIEW_REQUIRED"].includes(record.status)) {
    const live = await getNinjaOneDecommissionDevice(record.ninjaDeviceId);
    if (!record.ninjaUid || live.uid !== record.ninjaUid) throw new Error("The NinjaOne device identity could not be confirmed. Removal stopped.");
    if (live.approvalStatus !== "DECOMMISSIONED") {
      throw new Error("NinjaOne has not confirmed decommissioning. Check the device in NinjaOne before attempting any further removal.");
    }
    await prisma.$transaction(async (tx) => {
      const changed = await tx.hardwareDecommission.updateMany({
        where: { id, status: { in: ["REMOVING", "REMOVE_REVIEW_REQUIRED"] } },
        data: { status: "NINJA_DECOMMISSIONED", ninjaDecommissionedAt: new Date(), error: null },
      });
      if (changed.count) {
        await tx.ninjaOneDevice.deleteMany({ where: { id: record.ninjaDeviceId } });
        await tx.reconciliationAudit.create({ data: {
          ...actor, action: "verify-ninja-decommission", status: "SUCCEEDED",
          assetTag: record.assetTag, ninjaDeviceId: record.ninjaDeviceId,
          notes: "Recovered an incomplete removal by confirming NinjaOne's DECOMMISSIONED state.",
          resultJson: JSON.stringify(live), completedAt: new Date(),
        } });
      }
    });
  }
  await invalidateCache();
  return { workflow: await prisma.hardwareDecommission.findUniqueOrThrow({ where: { id } }), receipt };
}

export async function confirmHardwareDecommission(
  input: { id: string; choice: "keep" | "remove"; confirmedInReftab: boolean },
  actor: DecommissionActor,
) {
  if (!input.confirmedInReftab) throw new Error("Visually confirm the asset, Decommissioned status, and Asset Notes in Reftab first.");
  const record = await prisma.hardwareDecommission.findUniqueOrThrow({ where: { id: input.id } });
  if (!["AWAITING_CONFIRMATION", "KEPT"].includes(record.status)) {
    throw new Error("This decommission action is not ready for confirmation. Check its saved status first.");
  }
  // Re-read Reftab on every confirmation, rather than trusting a client-supplied receipt.
  const receipt = await verifyDecommissionedReftabAsset(record.reftabAid ?? record.assetTag, record.assetNotes);
  const confirmation = {
    visuallyConfirmedAt: new Date(), confirmedByEmployeeId: actor.actorEmployeeId, confirmedByName: actor.actorName,
  };
  if (input.choice === "keep") {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.hardwareDecommission.updateMany({
        where: { id: record.id, status: "AWAITING_CONFIRMATION" }, data: { ...confirmation, status: "KEPT", error: null },
      });
      if (!claimed.count) throw new Error("This action has already been confirmed or another reviewer is processing it.");
      await tx.reconciliationAudit.create({ data: {
        ...actor, action: "confirm-decommission-keep", status: "SUCCEEDED",
        assetTag: record.assetTag, ninjaDeviceId: record.ninjaDeviceId,
        notes: "Visually confirmed in Reftab; kept in NinjaOne.", resultJson: JSON.stringify(receipt), completedAt: new Date(),
      } });
    });
  } else {
    const claimed = await prisma.hardwareDecommission.updateMany({
      where: { id: record.id, status: { in: ["AWAITING_CONFIRMATION", "KEPT"] } },
      data: { ...confirmation, status: "REMOVING", error: null },
    });
    if (!claimed.count) throw new Error("Another reviewer is already processing this removal.");
    let mayHaveApplied = false;
    try {
      await runAuditedExternalChange("NinjaOne", {
        ...actor, action: "decommission-ninja-device", assetTag: record.assetTag, ninjaDeviceId: record.ninjaDeviceId,
        reason: DECOMMISSION_REASON, notes: "Reviewer visually confirmed the Reftab asset before requesting NinjaOne decommissioning.",
        resultJson: JSON.stringify({ reftabAid: receipt.aid, visuallyConfirmedAt: confirmation.visuallyConfirmedAt }),
      }, async () => {
        const live = await getNinjaOneDecommissionDevice(record.ninjaDeviceId);
        if (!record.ninjaUid || live.uid !== record.ninjaUid) throw new Error("The NinjaOne device identity could not be confirmed. Removal stopped.");
        const eligibility = decommissionEligibility(live);
        if (!eligibility.eligible) throw new Error(eligibility.reason);
        try {
          const result = await decommissionNinjaOneDevice(record.ninjaDeviceId);
          mayHaveApplied = true;
          return result;
        } catch (error) {
          mayHaveApplied = error instanceof NinjaOneWriteError && error.outcome === "uncertain";
          throw error;
        }
      }, async (tx) => {
        await tx.hardwareDecommission.update({
          where: { id: record.id }, data: { status: "NINJA_DECOMMISSIONED", ninjaDecommissionedAt: new Date(), error: null },
        });
        await tx.ninjaOneDevice.deleteMany({ where: { id: record.ninjaDeviceId } });
      });
    } catch (error) {
      await prisma.hardwareDecommission.updateMany({
        where: { id: record.id, status: "REMOVING" },
        data: { status: mayHaveApplied ? "REMOVE_REVIEW_REQUIRED" : record.status, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    } finally {
      await invalidateCache();
    }
  }
  await invalidateCache();
  return prisma.hardwareDecommission.findUniqueOrThrow({ where: { id: record.id } });
}
