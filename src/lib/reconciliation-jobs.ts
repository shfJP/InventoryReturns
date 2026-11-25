import { prisma } from "./db";
import { reconcileOwner } from "./reconcile-owner";
import { addMissingReftabAsset } from "./missing-reftab-asset";
import { getOwnerReconciliationRow, getMissingReftabAssetRow } from "./owner-reconciliation";
import { missingReftabRecipient } from "./missing-reftab-policy";
import { startHardwareDecommission } from "./hardware-decommission";
import { approvedRecipientMatches, failedJobStatus, retryAt } from "./reconciliation-queue-policy";
import { syncReftabToDb, verifyReftabQueuedOwner } from "./ref-tab";
import { verifyHardwareDecommission } from "./hardware-decommission";
import { invalidateOwnerReconciliationCache } from "./owner-reconciliation-cache";

export const RECONCILIATION_WORKER_KEY = "reconciliation-worker-heartbeat";
type JobInput = {
  action: "reassign-owner" | "add-missing-asset" | "decommission-missing-asset";
  assetTag: string;
  ninjaDeviceId: string;
  categoryId?: string;
};
type Actor = { actorEmployeeId: string; actorName: string; actorEmail: string | null };
export const outstandingJobStatuses = ["QUEUED", "RUNNING", "FAILED", "REVIEW_REQUIRED", "BLOCKED"];

// An interrupted worker can stop before creating its external-write audit.
// Recover only when there is proof no external write was started for this job.
export async function recoverUnstartedReconciliation(id: string) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.reconciliationJob.findUniqueOrThrow({ where: { id } });
    if (job.status !== "REVIEW_REQUIRED") return false;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('house-reconciliation'), hashtext(${job.ninjaDeviceId}))`;
    const externalActions = ["reassign-owner", "add-missing-asset", "decommission-missing-asset"];
    const started = await tx.reconciliationAudit.findFirst({ where: {
      action: { in: externalActions },
      OR: [{ jobId: id }, { assetTag: job.assetTag, status: { in: ["PENDING", "REVIEW_REQUIRED"] } }],
    }, select: { id: true } });
    if (started) return false;
    const changed = await tx.reconciliationJob.updateMany({
      where: { id, status: "REVIEW_REQUIRED", updatedAt: job.updatedAt },
      data: { status: "QUEUED", nextAttemptAt: null, completedAt: null, error: null },
    });
    if (!changed.count) return false;
    await tx.reconciliationAudit.create({ data: {
      jobId: id, action: "recover-queued-action", status: "SUCCEEDED",
      assetTag: job.assetTag, ninjaDeviceId: job.ninjaDeviceId,
      actorEmployeeId: job.actorEmployeeId, actorName: job.actorName, actorEmail: job.actorEmail,
      notes: "Background recovery confirmed no external write was started. Original approval queued again.",
      completedAt: new Date(),
    } });
    return true;
  }, { timeout: 30_000 });
}

export async function verifyQueuedReconciliation(id: string) {
  const job = await prisma.reconciliationJob.findUniqueOrThrow({ where: { id } });
  if (!["REVIEW_REQUIRED", "BLOCKED", "FAILED"].includes(job.status)) throw new Error("Only held or failed actions can be verified.");
  const actor = { actorEmployeeId: job.actorEmployeeId, actorName: job.actorName, actorEmail: job.actorEmail };
  let result: unknown;
  if (job.action === "decommission-missing-asset") {
    const workflow = await prisma.hardwareDecommission.findUniqueOrThrow({ where: { ninjaDeviceId: job.ninjaDeviceId } });
    const verified = await verifyHardwareDecommission(workflow.id, { ...actor, jobId: id });
    if (!["AWAITING_CONFIRMATION", "KEPT", "NINJA_DECOMMISSIONED"].includes(verified.workflow.status)) {
      throw new Error("The decommission creation has not been confirmed.");
    }
    result = verified;
  } else {
    if (!job.recipientEmail) throw new Error("This historical action has no saved recipient. Inspect its audit before resolving it.");
    result = await verifyReftabQueuedOwner(job.assetTag, job.recipientEmail);
    // Refresh local ownership before releasing the reservation.
    await syncReftabToDb();
    await invalidateOwnerReconciliationCache();
  }
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.reconciliationJob.updateMany({ where: { id, status: job.status, updatedAt: job.updatedAt },
      data: { status: "SUCCEEDED", error: null, nextAttemptAt: null, resultJson: JSON.stringify(result), completedAt: new Date() } });
    if (!claimed.count) throw new Error("The action changed during verification. Refresh its status.");
    await tx.reconciliationAudit.updateMany({ where: { jobId: id, status: { in: ["PENDING", "REVIEW_REQUIRED"] } },
      data: { status: "SUCCEEDED", completedAt: new Date(), error: null, resultJson: JSON.stringify({ verifiedByReadback: true, result }) } });
    await tx.reconciliationAudit.create({ data: { ...actor, jobId: id, assetTag: job.assetTag, ninjaDeviceId: job.ninjaDeviceId,
      action: "verify-queued-action", status: "SUCCEEDED", notes: "Background verification confirmed the saved action in Reftab without replaying the write.",
      completedAt: new Date(), resultJson: JSON.stringify(result) } });
  });
}

export async function enqueueReconciliation(input: JobInput, actor: Actor) {
  // Read local inventory only: saving a decision must not depend on Reftab uptime.
  const row = input.action === "reassign-owner"
    ? await getOwnerReconciliationRow(input.assetTag, input.ninjaDeviceId)
    : await getMissingReftabAssetRow(input.ninjaDeviceId);
  if (!row || row.assetTag !== input.assetTag) throw new Error("The inventory changed. Refresh before submitting this action.");
  const recipient = input.action === "decommission-missing-asset" ? null : missingReftabRecipient(row);
  if (input.action !== "decommission-missing-asset" && !recipient) throw new Error("No active recipient is available for this device.");
  if (input.action === "decommission-missing-asset" && !input.categoryId) throw new Error("Select a category for this decommission.");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reconciliation-queue'), hashtext(${input.ninjaDeviceId}))`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reconciliation-queue-asset'), hashtext(${input.assetTag}))`;
    const existing = await tx.reconciliationJob.findFirst({ where: {
      OR: [{ assetTag: input.assetTag }, { ninjaDeviceId: input.ninjaDeviceId }],
      status: { in: outstandingJobStatuses },
    } });
    if (existing) {
      if (existing.action !== input.action || existing.recipientEmail !== (recipient?.email ?? null) ||
          existing.categoryId !== (input.categoryId ?? null)) {
        throw new Error(`This item already has a saved action (${existing.id}). Review it in Actions & Audit.`);
      }
      return existing;
    }
    // Accept decisions even when the worker is offline; the durable queue waits.
    const saved = await tx.reconciliationJob.create({ data: {
      action: input.action, assetTag: input.assetTag, ninjaDeviceId: input.ninjaDeviceId,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      recipientEmail: recipient?.email ?? null, ...actor,
    } });
    await tx.reconciliationAudit.create({ data: {
      ...actor, jobId: saved.id, action: "queue-action", status: "SUCCEEDED",
      assetTag: input.assetTag, ninjaDeviceId: input.ninjaDeviceId,
      notes: `Decision saved for ${input.action}${recipient ? ` to ${recipient.email}` : ""}. Execution pending.`,
      completedAt: new Date(),
    } });
    return saved;
  });
}

export async function processNextReconciliationJob() {
  await prisma.reconciliationJob.updateMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "REVIEW_REQUIRED", completedAt: new Date(),
      error: "Worker interrupted. Verify Reftab before replaying an external write." },
  });
  const job = await prisma.reconciliationJob.findFirst({
    where: { OR: [{ status: "QUEUED" }, { status: "FAILED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }] },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  if (!job) {
    const held = await prisma.reconciliationJob.findFirst({ where: {
      status: { in: ["REVIEW_REQUIRED", "BLOCKED"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    }, orderBy: { updatedAt: "asc" } });
    if (!held) return false;
    // Lease verification so multiple workers do not scan the same action at once.
    const lease = await prisma.reconciliationJob.updateMany({ where: { id: held.id, updatedAt: held.updatedAt },
      data: { nextAttemptAt: new Date(Date.now() + 30 * 60_000) } });
    if (lease.count) {
      try { await verifyQueuedReconciliation(held.id); }
      catch (error) {
        if (!await recoverUnstartedReconciliation(held.id)) {
          console.info("[reconciliation-worker] Verification still pending", held.id, error instanceof Error ? error.message : error);
        }
      }
    }
    return true;
  }
  const claimed = await prisma.reconciliationJob.updateMany({
    where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
    data: { status: "RUNNING", startedAt: new Date(), completedAt: null, nextAttemptAt: null, attempts: { increment: 1 } },
  });
  if (!claimed.count) return true;
  const heartbeat = setInterval(() => {
    void prisma.reconciliationJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { updatedAt: new Date() } })
      .catch((error) => console.error("[reconciliation-worker] Job heartbeat failed", error));
  }, 10_000);
  let completedChange = false;
  let changedRecipient = false;
  try {
    const result = await prisma.$transaction(async (lock) => {
      await lock.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('house-reconciliation'), hashtext(${job.ninjaDeviceId}))`;
      const unfinished = await prisma.reconciliationAudit.findFirst({ where: {
        assetTag: job.assetTag,
        action: { in: ["reassign-owner", "add-missing-asset", "decommission-missing-asset"] },
        status: { in: ["PENDING", "REVIEW_REQUIRED"] },
      }, select: { id: true } });
      if (unfinished) throw new Error(`Unconfirmed Reftab write (Audit ${unfinished.id}). Check Reftab before retrying.`);
      if (job.action !== "decommission-missing-asset") {
        const row = job.action === "reassign-owner"
          ? await getOwnerReconciliationRow(job.assetTag, job.ninjaDeviceId)
          : await getMissingReftabAssetRow(job.ninjaDeviceId);
        changedRecipient = !row || row.assetTag !== job.assetTag || !approvedRecipientMatches(job.recipientEmail, missingReftabRecipient(row)?.email);
        if (changedRecipient) throw new Error("Inventory or approved recipient changed. Review this saved action; it will not be redirected automatically.");
      }
      const input = { assetTag: job.assetTag, ninjaDeviceId: job.ninjaDeviceId,
        categoryId: job.categoryId ?? undefined, expectedRecipientEmail: job.recipientEmail ?? undefined,
        requireHouse: job.actorEmployeeId === "system:house-reconciliation",
        requireLaptop: job.actorEmployeeId === "system:laptop-reconciliation" };
      const actor = { actorEmployeeId: job.actorEmployeeId, actorName: job.actorName, actorEmail: job.actorEmail, jobId: job.id };
      const changed = job.action === "add-missing-asset" ? await addMissingReftabAsset(input, actor)
        : job.action === "decommission-missing-asset"
          ? await startHardwareDecommission({ ...input, categoryId: job.categoryId! }, actor)
          : await reconcileOwner(input, actor);
      if (job.action === "decommission-missing-asset" && changed && "status" in changed && changed.status !== "AWAITING_CONFIRMATION") {
        throw new Error("The saved decommission requires verification before continuing.");
      }
      completedChange = true;
      return { ok: true, ...changed, completed: { ...input, action: job.action } };
    }, { timeout: 30 * 60_000, maxWait: 5_000 });
    await prisma.reconciliationJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: {
      status: "SUCCEEDED", resultJson: JSON.stringify(result), error: null, completedAt: new Date(), nextAttemptAt: null,
    } });
  } catch (error) {
    const unfinished = await prisma.reconciliationAudit.findFirst({ where: {
      assetTag: job.assetTag, status: { in: ["PENDING", "REVIEW_REQUIRED"] },
      action: { in: ["reassign-owner", "add-missing-asset", "decommission-missing-asset"] },
    }, select: { id: true } });
    const message = error instanceof Error ? error.message : String(error);
    const status = failedJobStatus(Boolean(unfinished) || completedChange, changedRecipient || message.startsWith("Approved recipient changed."));
    await prisma.$transaction(async (tx) => {
      const changed = await tx.reconciliationJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: {
        status, error: message, completedAt: new Date(),
        nextAttemptAt: status === "FAILED" ? retryAt(job.attempts + 1) : null,
      } });
      if (changed.count) await tx.reconciliationAudit.create({ data: {
        jobId: job.id, action: "queued-attempt", status: status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "FAILED",
        assetTag: job.assetTag, ninjaDeviceId: job.ninjaDeviceId,
        actorEmployeeId: job.actorEmployeeId, actorName: job.actorName, actorEmail: job.actorEmail,
        notes: `Background attempt ${job.attempts + 1}: ${status}.`, error: message, completedAt: new Date(),
      } });
    });
  } finally { clearInterval(heartbeat); }
  return true;
}
