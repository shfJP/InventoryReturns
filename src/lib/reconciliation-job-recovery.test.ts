import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const globals = globalThis as unknown as { prisma?: unknown };
const original = globals.prisma;
let restore: typeof import("./reconciliation-job-recovery").restoreHistoricalReconciliationJobs;
let audits: Record<string, unknown>[];
let jobs: Record<string, unknown>[];
let records: Record<string, unknown>[];
let existing: Record<string, unknown> | null;
const attempt = {
  id: "audit-1", jobId: null, action: "reassign-owner", status: "FAILED",
  assetTag: "0000244", ninjaDeviceId: "2503",
  actorEmployeeId: "system:house-reconciliation", actorName: "Automatic House account reconciliation", actorEmail: null,
  evidenceJson: JSON.stringify({ recipientEmail: "ithelp@sevenhills.org" }),
  proposedOwnerEmployeeId: "ITHELP", error: "Reftab timed out",
  createdAt: new Date("2026-11-25T15:00:00Z"), completedAt: new Date("2026-11-25T15:01:00Z"),
};
const db = {
  $queryRaw: async () => [],
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  reconciliationAudit: {
    findMany: async ({ cursor }: { cursor?: unknown }) => cursor ? [] : audits,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => audits.find((a) => a.id === where.id),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      Object.assign(audits.find((a) => a.id === where.id)!, data);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => { records.push(data); },
  },
  reconciliationJob: {
    findFirst: async () => existing ?? jobs[0] ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const job = { id: "restored-1", ...data }; jobs.push(job); return job;
    },
  },
  hardwareDecommission: { findUnique: async () => ({ categoryId: "123" }) },
};
before(async () => {
  globals.prisma = db;
  restore = (await import("./reconciliation-job-recovery")).restoreHistoricalReconciliationJobs;
});
beforeEach(() => { audits = [{ ...attempt }]; jobs = []; records = []; existing = null; });
after(() => { if (original === undefined) delete globals.prisma; else globals.prisma = original; });

test("older failed automation is requeued once with its recorded approval and linked audit", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("recovery must not contact Reftab"); });
  assert.equal(await restore(), 1);
  assert.equal(jobs[0].status, "FAILED");
  assert.equal(jobs[0].recipientEmail, "ithelp@sevenhills.org");
  assert.equal(jobs[0].actorEmployeeId, attempt.actorEmployeeId);
  assert.ok(jobs[0].nextAttemptAt instanceof Date);
  assert.equal(audits[0].jobId, "restored-1");
  assert.equal(records[0].action, "recover-historical-action");
  assert.equal(await restore(), 0);
});
test("uncertain writes await verification without being requeued for writes", async () => {
  audits[0].status = "REVIEW_REQUIRED";
  await restore();
  assert.equal(jobs[0].status, "REVIEW_REQUIRED");
  assert.equal(jobs[0].nextAttemptAt, null);
});
test("a failed historical action without a recorded email remains saved and blocked", async () => {
  audits[0].evidenceJson = "{}";
  await restore();
  assert.equal(jobs[0].status, "BLOCKED");
  assert.equal(jobs[0].recipientEmail, null);
});
test("a later completion supersedes old failures", async () => {
  audits.unshift({ ...attempt, id: "later-success", status: "SUCCEEDED" });
  assert.equal(await restore(), 0);
});
test("explicitly cancelled actions are not recovered again", async () => {
  existing = { status: "CANCELLED" };
  assert.equal(await restore(), 0);
});
test("decommission recovery retains its saved category without needing a recipient", async () => {
  audits[0] = { ...attempt, action: "decommission-missing-asset", evidenceJson: null, proposedOwnerEmployeeId: null };
  await restore();
  assert.equal(jobs[0].status, "FAILED");
  assert.equal(jobs[0].categoryId, "123");
});
test("recent pending attempts are left to their active caller", async () => {
  audits[0] = { ...attempt, status: "PENDING", createdAt: new Date() };
  assert.equal(await restore(), 0);
});
