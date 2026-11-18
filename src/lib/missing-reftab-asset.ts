import { prisma } from "./db";
import { getMissingReftabAssetRow } from "./owner-reconciliation";
import { missingReftabRecipient, isHouseNinjaLogin } from "./missing-reftab-policy";
import { createAndAssignReftabAsset } from "./ref-tab";
import { runAuditedReftabChange } from "./reconciliation-audit";
import { invalidateOwnerReconciliationCache } from "./owner-reconciliation-cache";

export async function addMissingReftabAsset(
  input: { assetTag: string; ninjaDeviceId: string; categoryId?: string },
  actor: { actorEmployeeId: string; actorName: string; actorEmail: string | null },
) {
  // Re-read device identity and login on the server, including during a bulk import.
  const row = await getMissingReftabAssetRow(input.ninjaDeviceId);
  if (!row || row.assetTag !== input.assetTag) {
    throw new Error("No current NinjaOne device missing from Reftab was found. Recalculate before retrying.");
  }
  const recipient = missingReftabRecipient(row);
  if (!recipient) throw new Error("This NinjaOne device does not resolve to an active directory owner yet.");
  const houseDevice = isHouseNinjaLogin(row.ninjaOwnerRaw);
  const directoryOwner = recipient.employeeId
    ? row.ninjaOwner
    : await prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [
          { email: { equals: recipient.email, mode: "insensitive" } },
          { upn: { equals: recipient.email, mode: "insensitive" } },
        ],
      },
      orderBy: { employeeId: "asc" },
      select: { employeeId: true },
    });
  const existingAssignment = await prisma.equipmentAssignment.findFirst({
    where: { assetTag: row.assetTag }, select: { id: true },
  });
  if (existingAssignment) throw new Error("This asset now exists in Reftab sync data. Refresh before retrying.");

  const note = houseDevice
    ? `Asset created from NinjaOne device ${row.ninjaDevice.id}, logged in as ${row.ninjaOwnerRaw}, and loaned to ${recipient.email}.`
    : `Asset created from NinjaOne device ${row.ninjaDevice.id} and assigned to ${recipient.employeeId}.`;
  try {
    const { result, auditId } = await runAuditedReftabChange({
      ...actor, action: "add-missing-asset",
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id,
      proposedOwnerEmployeeId: directoryOwner?.employeeId ?? recipient.email,
      proposedOwnerName: houseDevice ? `${recipient.displayName} (${recipient.email})` : recipient.displayName,
      notes: [note, input.categoryId ? `Selected category: ${input.categoryId}` : ""].filter(Boolean).join("\n"),
      evidenceJson: JSON.stringify({ ninjaOwnerRaw: row.ninjaOwnerRaw, recipientEmail: recipient.email }),
    }, () => createAndAssignReftabAsset({
      assetTag: row.assetTag, serial: row.serial, model: row.model, title: row.title,
      categoryId: input.categoryId,
      // House devices must match the requested Reftab email, regardless of directory aliases.
      newOwnerEmployeeId: houseDevice ? "" : recipient.employeeId!,
      newOwnerEmail: recipient.email, newOwnerName: recipient.displayName, note,
    }), async (tx, result) => {
      if (directoryOwner) {
        const assignment = {
          aid: result.aid, serial: row.serial, model: row.model, title: row.title,
          source: "ref_tab", lastSyncedAt: new Date(),
        };
        await tx.equipmentAssignment.upsert({
          where: { assetTag_assignedToEmployeeId: {
            assetTag: row.assetTag, assignedToEmployeeId: directoryOwner.employeeId,
          } },
          update: assignment,
          create: { ...assignment, assetTag: row.assetTag, assignedToEmployeeId: directoryOwner.employeeId },
        });
      } else {
        // Shared Reftab loanees need not be employees. Use the same local record as Reftab sync.
        const assignment = {
          employeeName: recipient.displayName, employeeEmail: recipient.email,
          serial: row.serial, model: row.title ?? row.model, source: "reftab_unmatched_assignee",
        };
        await tx.unresolvedCollection.upsert({
          where: { employeeId_assetTag_status: {
            employeeId: recipient.email, assetTag: row.assetTag, status: "UNRESOLVED",
          } },
          update: assignment,
          create: { ...assignment, employeeId: recipient.email, assetTag: row.assetTag, status: "UNRESOLVED" },
        });
      }
    });
    return { result, auditId, recipient };
  } finally {
    await invalidateOwnerReconciliationCache().catch((error) =>
      console.error("[owner-reconciliation] Cache invalidation failed", error));
  }
}
