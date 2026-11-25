import { getOwnerReconciliationResult } from "./owner-reconciliation";
import { isHouseNinjaLogin } from "./missing-reftab-policy";
import { enqueueReconciliation, outstandingJobStatuses } from "./reconciliation-jobs";
import { isAutomaticOwnerLaptop } from "./automatic-owner-policy";
import { prisma } from "./db";

const actor = {
  actorEmployeeId: "system:house-reconciliation",
  actorName: "Automatic House account reconciliation",
  actorEmail: null,
};

export async function reconcileAutomaticOwners(includeLaptops = true) {
  const result = await getOwnerReconciliationResult();
  const candidates = [
    ...result.rows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw) || (includeLaptops && isAutomaticOwnerLaptop(row.ninjaDevice))).map((row) => ({
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, action: "reassign-owner" as const,
      house: isHouseNinjaLogin(row.ninjaOwnerRaw),
    })),
    ...result.missingReftabRows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw)).map((row) => ({
      assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id, action: "add-missing-asset" as const,
      house: true,
    })),
  ];
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    // Conflicting local assignments must be inspected rather than moved twice.
    if (candidates.filter((item) => item.ninjaDeviceId === candidate.ninjaDeviceId || item.assetTag === candidate.assetTag).length !== 1) {
      skipped++;
      continue;
    }
    try {
      const reserved = await prisma.reconciliationJob.findFirst({ where: {
        OR: [{ ninjaDeviceId: candidate.ninjaDeviceId }, { assetTag: candidate.assetTag }],
        status: { in: outstandingJobStatuses },
      }, select: { id: true } });
      if (reserved) { skipped++; continue; }
      // Persist automation decisions through the same queue as staff approvals.
      // Failures remain reserved and are retried by the worker/maintenance job.
      await enqueueReconciliation(candidate, candidate.house ? actor : {
        actorEmployeeId: "system:laptop-reconciliation",
        actorName: "Automatic -LT ownership reconciliation", actorEmail: null,
      });
      queued++;
    } catch (error) {
      failed++;
      console.error(`[automatic-owner-reconciliation] ${candidate.assetTag} failed`, error);
    }
  }
  const counts = { completed: 0, queued, skipped, failed };
  console.info("[automatic-owner-reconciliation]", counts);
  return counts;
}

export async function reconcileAutomaticOwnersAfterSync(includeLaptops = true) {
  // External scheduling refreshes both sources and then invokes the policies
  // once. Manual sync requests should not start a second ownership pass.
  if (process.env.SYNC_SCHEDULER === "external") return { completed: 0, skipped: 0, failed: 0 };
  try {
    return await reconcileAutomaticOwners(includeLaptops);
  } catch (error) {
    console.error("[automatic-owner-reconciliation] Could not evaluate ownership policies after sync", error);
    return { completed: 0, skipped: 0, failed: 1 };
  }
}
