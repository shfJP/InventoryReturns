import { prisma } from "./db";
import { getOwnerReconciliationRow } from "./owner-reconciliation";
import { HOUSE_REFTAB_EMAIL, isHouseNinjaLogin } from "./missing-reftab-policy";
import { reconcileReftabAssetOwner } from "./ref-tab";
import { runAuditedReftabChange } from "./reconciliation-audit";
import { invalidateOwnerReconciliationCache } from "./owner-reconciliation-cache";

export async function reconcileOwner(
  input: { assetTag: string; ninjaDeviceId: string; requireHouse?: boolean },
  actor: { actorEmployeeId: string; actorName: string; actorEmail: string | null },
) {
  const row = await getOwnerReconciliationRow(input.assetTag, input.ninjaDeviceId);
  if (!row) throw new Error("No current owner mismatch found for this asset and NinjaOne device.");
  const house = isHouseNinjaLogin(row.ninjaOwnerRaw);
  if (input.requireHouse && !house) throw new Error("The device no longer has the House login; automatic reconciliation stopped.");
  const email = house ? HOUSE_REFTAB_EMAIL : row.ninjaOwner.email;
  const owner = house ? await prisma.user.findFirst({
    where: { isActive: true, OR: [
      { email: { equals: email, mode: "insensitive" } },
      { upn: { equals: email, mode: "insensitive" } },
    ] },
    orderBy: { employeeId: "asc" }, select: { employeeId: true },
  }) : row.ninjaOwner;
  const note = house
    ? `House account policy: NinjaOne device ${row.ninjaDevice.id} last logged in as ${row.ninjaOwnerRaw}; assign to ${email}. Previous Reftab owner: ${row.reftabOwnerEmployeeId}.`
    : `Owner reconciliation approved from NinjaOne device ${row.ninjaDevice.id}. Previous Reftab owner: ${row.reftabOwnerEmployeeId}.`;
  try {
    return await runAuditedReftabChange({
      ...actor, action: "reassign-owner", decision: "YES",
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id,
      previousOwnerEmployeeId: row.reftabOwnerEmployeeId,
      previousOwnerName: row.reftabOwner?.displayName,
      proposedOwnerEmployeeId: owner?.employeeId ?? email,
      proposedOwnerName: house ? `IT Help (${email})` : row.ninjaOwner.displayName,
      notes: note, evidenceJson: JSON.stringify({ ...row.ownerEvidence, ninjaOwnerRaw: row.ninjaOwnerRaw, recipientEmail: email }),
    }, () => reconcileReftabAssetOwner({
      assetTag: row.assetTag, aid: row.aid,
      // Match House loans by the designated email, never a directory alias.
      newOwnerEmployeeId: house ? "" : row.ninjaOwner.employeeId,
      newOwnerEmail: email, newOwnerName: house ? "IT Help" : row.ninjaOwner.displayName, note,
    }), async (tx) => {
      await tx.equipmentAssignment.deleteMany({ where: { assetTag: row.assetTag, assignedToEmployeeId: row.reftabOwnerEmployeeId } });
      if (owner) {
        const assignment = {
          aid: row.aid, serial: row.serial, model: row.model, title: row.title,
          catName: row.category, source: "ref_tab", lastSyncedAt: new Date(),
        };
        await tx.equipmentAssignment.upsert({
          where: { assetTag_assignedToEmployeeId: { assetTag: row.assetTag, assignedToEmployeeId: owner.employeeId } },
          update: assignment, create: { ...assignment, assetTag: row.assetTag, assignedToEmployeeId: owner.employeeId },
        });
      } else {
        const assignment = {
          employeeName: "IT Help", employeeEmail: email, serial: row.serial,
          model: row.title ?? row.model, catName: row.category, source: "reftab_unmatched_assignee",
        };
        await tx.unresolvedCollection.upsert({
          where: { employeeId_assetTag_status: { employeeId: email, assetTag: row.assetTag, status: "UNRESOLVED" } },
          update: assignment, create: { ...assignment, employeeId: email, assetTag: row.assetTag, status: "UNRESOLVED" },
        });
      }
      const decision = await tx.reconciliationDecision.create({ data: {
        assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id,
        currentOwnerEmployeeId: row.reftabOwnerEmployeeId,
        proposedOwnerEmployeeId: owner?.employeeId ?? email,
        decision: "YES", reason: "Approved and written to Reftab",
        decidedByEmployeeId: actor.actorEmployeeId, decidedByName: actor.actorName,
      } });
      return { decisionId: decision.id };
    });
  } finally {
    await invalidateOwnerReconciliationCache().catch((error) => console.error("[owner-reconciliation] Cache invalidation failed", error));
  }
}
