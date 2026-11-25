import { prisma } from "./db";
import { getOwnerReconciliationResult } from "./owner-reconciliation";
import { isHouseNinjaLogin } from "./missing-reftab-policy";
import { reconcileOwner } from "./reconcile-owner";
import { addMissingReftabAsset } from "./missing-reftab-asset";
import { isAutomaticOwnerLaptop } from "./automatic-owner-policy";

const actor = {
  actorEmployeeId: "system:house-reconciliation",
  actorName: "Automatic House account reconciliation",
  actorEmail: null,
};

export async function reconcileAutomaticOwners(includeLaptops = true) {
  const result = await getOwnerReconciliationResult();
  const candidates = [
    ...result.rows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw) || (includeLaptops && isAutomaticOwnerLaptop(row.ninjaDevice))).map((row) => ({
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, action: "reassign-owner",
      house: isHouseNinjaLogin(row.ninjaOwnerRaw),
    })),
    ...result.missingReftabRows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw)).map((row) => ({
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, action: "add-missing-asset",
      house: true,
    })),
  ];
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    // Conflicting local assignments must be inspected rather than moved twice.
    if (candidates.filter((item) => item.ninjaDeviceId === candidate.ninjaDeviceId || item.assetTag === candidate.assetTag).length !== 1) {
      skipped++;
      continue;
    }
    try {
      await prisma.$transaction(async (lock) => {
        // Retain the shared House lock namespace so both policies coordinate
        // with scheduled, manual and House-only callers across processes.
        const [lease] = await lock.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext('house-reconciliation'), hashtext(${candidate.ninjaDeviceId})) AS acquired
        `;
        if (!lease.acquired) { skipped++; return; }
        const unfinished = await prisma.reconciliationAudit.findFirst({
          where: {
            assetTag: candidate.assetTag,
            action: { in: ["reassign-owner", "add-missing-asset", "decommission-missing-asset"] },
            status: { in: ["PENDING", "REVIEW_REQUIRED"] },
          }, select: { id: true },
        });
        // Never repeat an uncertain external write automatically.
        if (unfinished) { skipped++; return; }
        // Each service re-reads the current row, uses email-based checkout and
        // records its external/local outcome through the normal audit workflow.
        if (candidate.action === "reassign-owner") await reconcileOwner({
          ...candidate, requireHouse: candidate.house, requireLaptop: !candidate.house,
        }, candidate.house ? actor : {
          actorEmployeeId: "system:laptop-reconciliation",
          actorName: "Automatic -LT ownership reconciliation", actorEmail: null,
        });
        else await addMissingReftabAsset({ ...candidate, requireHouse: true }, actor);
        completed++;
      }, { timeout: 30 * 60_000, maxWait: 5_000 });
    } catch (error) {
      failed++;
      console.error(`[automatic-owner-reconciliation] ${candidate.assetTag} failed`, error);
    }
  }
  const counts = { completed, skipped, failed };
  console.info("[automatic-owner-reconciliation]", counts);
  return counts;
}

export async function reconcileAutomaticOwnersAfterSync(includeLaptops = true) {
  try {
    return await reconcileAutomaticOwners(includeLaptops);
  } catch (error) {
    console.error("[automatic-owner-reconciliation] Could not evaluate ownership policies after sync", error);
    return { completed: 0, skipped: 0, failed: 1 };
  }
}
