import { prisma } from "./db";
import { getOwnerReconciliationResult } from "./owner-reconciliation";
import { isHouseNinjaLogin } from "./missing-reftab-policy";
import { reconcileOwner } from "./reconcile-owner";
import { addMissingReftabAsset } from "./missing-reftab-asset";

const actor = {
  actorEmployeeId: "system:house-reconciliation",
  actorName: "Automatic House account reconciliation",
  actorEmail: null,
};

export async function reconcileHouseDevices() {
  const result = await getOwnerReconciliationResult();
  const candidates = [
    ...result.rows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw)).map((row) => ({
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, action: "reassign-owner",
    })),
    ...result.missingReftabRows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw)).map((row) => ({
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, action: "add-missing-asset",
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
        // Coordinate scheduled and manually requested syncs across processes.
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
        if (candidate.action === "reassign-owner") await reconcileOwner({ ...candidate, requireHouse: true }, actor);
        else await addMissingReftabAsset({ ...candidate, requireHouse: true }, actor);
        completed++;
      }, { timeout: 120_000, maxWait: 5_000 });
    } catch (error) {
      failed++;
      console.error(`[house-reconciliation] ${candidate.assetTag} failed`, error);
    }
  }
  const counts = { completed, skipped, failed };
  console.info("[house-reconciliation]", counts);
  return counts;
}

export async function reconcileHouseDevicesAfterSync() {
  try {
    return await reconcileHouseDevices();
  } catch (error) {
    console.error("[house-reconciliation] Could not evaluate House devices after sync", error);
    return { completed: 0, skipped: 0, failed: 1 };
  }
}
