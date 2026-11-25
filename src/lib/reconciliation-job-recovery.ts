import { prisma } from "./db";

const externalActions = ["reassign-owner", "add-missing-asset", "decommission-missing-asset"];

export function recordedRecipient(evidenceJson: string | null, proposedOwnerEmployeeId: string | null) {
  try {
    const evidence = JSON.parse(evidenceJson ?? "{}");
    if (typeof evidence?.recipientEmail === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(evidence.recipientEmail)) {
      return evidence.recipientEmail;
    }
  } catch { /* Older attempts may not include evidence. */ }
  return proposedOwnerEmployeeId && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposedOwnerEmployeeId)
    ? proposedOwnerEmployeeId : null;
}

// Adopt attempts made before every caller used the durable queue. Never infer an
// approved email from today's directory or replay an uncertain external write.
export async function restoreHistoricalReconciliationJobs() {
  let cursor: string | undefined;
  let restored = 0;
  const seenDevices = new Set<string>();
  const seenAssets = new Set<string>();
  while (true) {
    const audits = await prisma.reconciliationAudit.findMany({
      where: { action: { in: externalActions } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!audits.length) break;
    for (const audit of audits) {
      // A later completion or decision supersedes earlier failed attempts.
      if (seenDevices.has(audit.ninjaDeviceId) || seenAssets.has(audit.assetTag)) continue;
      seenDevices.add(audit.ninjaDeviceId);
      seenAssets.add(audit.assetTag);
      if (audit.jobId || !["FAILED", "PENDING", "REVIEW_REQUIRED"].includes(audit.status)) continue;
      if (audit.status === "PENDING" && audit.createdAt.getTime() > Date.now() - 5 * 60_000) continue;
      const adopted = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reconciliation-queue'), hashtext(${audit.ninjaDeviceId}))`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reconciliation-queue-asset'), hashtext(${audit.assetTag}))`;
        const existing = await tx.reconciliationJob.findFirst({ where: {
          OR: [{ ninjaDeviceId: audit.ninjaDeviceId }, { assetTag: audit.assetTag }],
        } });
        if (existing) return false; // Includes explicit cancellations/returns to review.
        const current = await tx.reconciliationAudit.findUniqueOrThrow({ where: { id: audit.id } });
        if (current.jobId || current.status !== audit.status) return false;
        const recipientEmail = recordedRecipient(audit.evidenceJson, audit.proposedOwnerEmployeeId);
        const decommission = audit.action === "decommission-missing-asset"
          ? await tx.hardwareDecommission.findUnique({ where: { ninjaDeviceId: audit.ninjaDeviceId } }) : null;
        const uncertain = audit.status !== "FAILED";
        const incomplete = audit.action === "decommission-missing-asset" ? !decommission?.categoryId : !recipientEmail;
        const status = uncertain ? "REVIEW_REQUIRED" : incomplete ? "BLOCKED" : "FAILED";
        const job = await tx.reconciliationJob.create({ data: {
          action: audit.action, assetTag: audit.assetTag, ninjaDeviceId: audit.ninjaDeviceId,
          actorEmployeeId: audit.actorEmployeeId, actorName: audit.actorName, actorEmail: audit.actorEmail,
          recipientEmail, categoryId: decommission?.categoryId ?? null,
          status, attempts: 1, createdAt: audit.createdAt, startedAt: audit.createdAt,
          completedAt: audit.completedAt,
          nextAttemptAt: status === "FAILED" ? new Date() : null,
          error: incomplete
            ? `${audit.error ?? "Earlier action failed."} The original recipient email or category was not recorded. Review the saved action before retrying.`
            : audit.error,
        } });
        await tx.reconciliationAudit.update({ where: { id: audit.id }, data: { jobId: job.id } });
        await tx.reconciliationAudit.create({ data: {
          jobId: job.id, action: "recover-historical-action", status: "SUCCEEDED",
          assetTag: audit.assetTag, ninjaDeviceId: audit.ninjaDeviceId,
          actorEmployeeId: audit.actorEmployeeId, actorName: audit.actorName, actorEmail: audit.actorEmail,
          notes: `Recovered earlier ${audit.status} attempt into Actions & Audit (${status}). Original decision retained; excluded from Ownership Review.`,
          completedAt: new Date(),
        } });
        return true;
      });
      if (adopted) restored++;
    }
    cursor = audits[audits.length - 1].id;
  }
  return restored;
}
