import { prisma } from "./db";
import { reconcileOwner } from "./reconcile-owner";
import { addMissingReftabAsset } from "./missing-reftab-asset";

export const RECONCILIATION_WORKER_KEY = "reconciliation-worker-heartbeat";
type JobInput = {
  action: "reassign-owner" | "add-missing-asset";
  assetTag: string;
  ninjaDeviceId: string;
  categoryId?: string;
};
type Actor = { actorEmployeeId: string; actorName: string; actorEmail: string | null };

export async function enqueueReconciliation(input: JobInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    // Serialize enqueue attempts for a device across tabs, users and app instances.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reconciliation-queue'), hashtext(${input.ninjaDeviceId}))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reconciliation-queue-asset'), hashtext(${input.assetTag}))`;
    const existing = await tx.reconciliationJob.findFirst({
      where: {
        OR: [{ assetTag: input.assetTag }, { ninjaDeviceId: input.ninjaDeviceId }],
        status: { in: ["QUEUED", "RUNNING"] },
      },
    });
    if (existing) return existing;
    const interrupted = await tx.reconciliationJob.findFirst({
      where: { assetTag: input.assetTag, status: "REVIEW_REQUIRED" }, select: { id: true },
    });
    if (interrupted) throw new Error(`Background action ${interrupted.id} needs review. Check Reftab and resolve the action before retrying.`);
    const unfinished = await tx.reconciliationAudit.findFirst({
      where: {
        assetTag: input.assetTag,
        action: { in: ["reassign-owner", "add-missing-asset", "decommission-missing-asset"] },
        status: { in: ["PENDING", "REVIEW_REQUIRED"] },
      }, select: { id: true },
    });
    if (unfinished) throw new Error(`An earlier Reftab write is unconfirmed (Audit ${unfinished.id}). Check Reftab and resolve that audit before retrying.`);
    const heartbeat = await tx.appSetting.findUnique({ where: { key: RECONCILIATION_WORKER_KEY } });
    if (!heartbeat || !Number.isFinite(Number(heartbeat.value)) || Date.now() - Number(heartbeat.value) > 60_000) {
      throw new Error("The reconciliation worker is unavailable. No action was queued. Start the reconciliation worker and try again.");
    }
    return tx.reconciliationJob.create({ data: {
      action: input.action, assetTag: input.assetTag, ninjaDeviceId: input.ninjaDeviceId,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}), ...actor,
    } });
  });
}

export async function processNextReconciliationJob() {
  // Interrupted jobs are never replayed: an external write may have completed.
  await prisma.reconciliationJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "REVIEW_REQUIRED", completedAt: new Date(),
      error: "The worker stopped reporting progress. Check Reftab and the audit history before retrying; this action was not replayed." },
  });
  const job = await prisma.reconciliationJob.findFirst({
    where: { status: "QUEUED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!job) return false;
  const claimed = await prisma.reconciliationJob.updateMany({
    where: { id: job.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() },
  });
  if (!claimed.count) return true;
  const heartbeat = setInterval(() => {
    void prisma.reconciliationJob.updateMany({
      where: { id: job.id, status: "RUNNING" }, data: { updatedAt: new Date() },
    }).catch((error) => console.error("[reconciliation-worker] Job heartbeat failed", error));
  }, 10_000);
  let completedChange = false;
  try {
    const result = await prisma.$transaction(async (lock) => {
      // Coordinate with the automatic House/-LT worker while it performs writes.
      await lock.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('house-reconciliation'), hashtext(${job.ninjaDeviceId}))`;
      const unfinished = await prisma.reconciliationAudit.findFirst({
        where: { assetTag: job.assetTag,
          action: { in: ["reassign-owner", "add-missing-asset", "decommission-missing-asset"] },
          status: { in: ["PENDING", "REVIEW_REQUIRED"] } },
        select: { id: true },
      });
      if (unfinished) throw new Error(`Unconfirmed Reftab write (Audit ${unfinished.id}). Check Reftab before retrying.`);
      const input = { assetTag: job.assetTag, ninjaDeviceId: job.ninjaDeviceId, categoryId: job.categoryId ?? undefined };
      const actor = { actorEmployeeId: job.actorEmployeeId, actorName: job.actorName, actorEmail: job.actorEmail };
      const changed = job.action === "add-missing-asset"
        ? await addMissingReftabAsset(input, actor)
        : await reconcileOwner(input, actor);
      completedChange = true;
      return { ok: true, ...changed, completed: { ...input, action: job.action } };
    }, { timeout: 30 * 60_000, maxWait: 5_000 });
    await prisma.reconciliationJob.update({
      where: { id: job.id }, data: { status: "SUCCEEDED", resultJson: JSON.stringify(result), completedAt: new Date() },
    });
  } catch (error) {
    const unfinished = await prisma.reconciliationAudit.findFirst({
      where: { assetTag: job.assetTag, status: { in: ["PENDING", "REVIEW_REQUIRED"] } }, select: { id: true },
    });
    await prisma.reconciliationJob.update({
      where: { id: job.id }, data: {
        status: unfinished || completedChange ? "REVIEW_REQUIRED" : "FAILED",
        error: error instanceof Error ? error.message : String(error), completedAt: new Date(),
      },
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
