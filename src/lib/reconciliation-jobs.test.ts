import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const globals = globalThis as unknown as { prisma?: unknown };
const original = globals.prisma;
let enqueue: typeof import("./reconciliation-jobs").enqueueReconciliation;
let processNext: typeof import("./reconciliation-jobs").processNextReconciliationJob;
let recover: typeof import("./reconciliation-jobs").recoverUnstartedReconciliation;
let active: Record<string, unknown> | null;
let interrupted: Record<string, unknown> | null;
let unfinished: { id: string } | null;
let heartbeat: string | null;
let created: Record<string, unknown>[];
let updates: Record<string, unknown>[];
let queued: Record<string, unknown> | null;
let claimed: boolean;
let auditsRead: number;
let auditRecords: Record<string, unknown>[];
let readyQuery: unknown;
const recipient = "ithelp@sevenhills.org";
const oldOwner = { employeeId: "OLD", displayName: "Old owner", email: "old@example.test", upn: null, isActive: true };
const db = {
  $queryRaw: async () => [],
  equipmentAssignment: { findMany: async () => [{ assetTag: "0000000024", aid: "0000000024", title: "TEST-PC", assignedToEmployeeId: "OLD", user: oldOwner }] },
  user: { findMany: async () => [oldOwner] },
  ninjaOneDevice: { findMany: async () => [{ id: "2224", systemName: "TEST-PC", detailsJson: JSON.stringify({ lastLoggedOnUser: { userName: "7HILLS\\House" } }), loginObservations: [] }] },
  hardwareDecommission: { findMany: async () => [] },
  unresolvedCollection: { findMany: async () => [] },
  appSetting: { findUnique: async () => heartbeat === null ? null : { value: heartbeat } },
  reconciliationAudit: {
    findFirst: async () => { auditsRead++; return unfinished; },
    create: async ({data}: {data: Record<string, unknown>}) => { auditRecords.push(data); return {id: "audit-1", ...data}; },
  },
  reconciliationJob: {
    findUniqueOrThrow: async () => active,
    findFirst: async ({ where }: { where: { status?: unknown; OR?: unknown } }) => {
      if (!where.status && where.OR) { readyQuery = where; return queued; }
      if (where.status && typeof where.status === "object" && "in" in where.status && !where.OR) return interrupted;
      return active;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data); return { id: "job-1", status: "QUEUED", ...data };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      updates.push(data);
      return { count: where.id ? (claimed ? 1 : 0) : 0 };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return data; },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
};
before(async () => {
  globals.prisma = db;
  const module = await import("./reconciliation-jobs");
  enqueue = module.enqueueReconciliation;
  processNext = module.processNextReconciliationJob;
  recover = module.recoverUnstartedReconciliation;
});
beforeEach(() => {
  active = null; interrupted = null; unfinished = null;
  heartbeat = String(Date.now()); created = []; updates = []; queued = null; claimed = true; auditsRead = 0; auditRecords = [];
  readyQuery = null;
});
after(() => { if (original === undefined) delete globals.prisma; else globals.prisma = original; });
const input = { action: "reassign-owner" as const, assetTag: "0000000024", ninjaDeviceId: "2224" };
const actor = { actorEmployeeId: "ABRW", actorName: "Reviewer", actorEmail: null };

test("worker includes failed actions without a retry timestamp in its ready queue", async () => {
  await processNext();
  assert.deepEqual(readyQuery, { OR: [
    { status: "QUEUED" },
    { status: "FAILED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: (readyQuery as any).OR[1].OR[1].nextAttemptAt.lte } }] },
  ] });
  assert.ok((readyQuery as any).OR[1].OR[1].nextAttemptAt.lte instanceof Date);
});

test("persists a job with the authenticated actor without contacting Reftab", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("enqueue must not contact Reftab"); });
  const job = await enqueue(input, actor);
  assert.equal(job.id, "job-1");
  assert.deepEqual(created, [{ ...input, recipientEmail: recipient, ...actor }]);
});
test("duplicate submissions return the existing active job", async () => {
  active = { id: "existing", status: "RUNNING", ...input, recipientEmail: recipient, categoryId: null };
  assert.equal((await enqueue(input, actor)).id, "existing");
  assert.equal(created.length, 0);
});
test("does not persist extra client fields as job columns", async () => {
  await enqueue({ ...input, title: "client title", ownerEmail: "client@example.test" } as typeof input, actor);
  assert.deepEqual(created, [{ ...input, recipientEmail: recipient, ...actor }]);
});
test("saves a decision during an uncertain prior write for background verification", async () => {
  unfinished = { id: "previous-audit" };
  const job = await enqueue(input, actor);
  assert.equal(job.id, "job-1");
  assert.equal(auditRecords[0].action, "queue-action");
  assert.match(String(auditRecords[0].notes), /Execution pending/);
});
test("conflicting approvals are rejected without changing the existing job", async () => {
  active = { id: "existing", status: "FAILED", ...input, recipientEmail: "other@example.test", categoryId: null };
  await assert.rejects(enqueue(input, actor), /already has a saved action/);
  assert.equal(created.length, 0);
});
for (const unavailable of [null, String(Date.now() - 120_000)]) {
  test(`accepts decisions when worker heartbeat is ${unavailable === null ? "missing" : "stale"}`, async () => {
    heartbeat = unavailable;
    assert.equal((await enqueue(input, actor)).id, "job-1");
    assert.equal(created.length, 1);
  });
}
test("worker never processes a job claimed by another worker", async () => {
  queued = { id: "job-1", status: "QUEUED", attempts: 0, ...input, ...actor }; claimed = false;
  await processNext();
  assert.equal(auditsRead, 0);
  assert.equal(updates.some((data) => data.status === "SUCCEEDED"), false);
});
test("worker rechecks audit after acquiring the automatic reconciliation lock", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("must not repeat an uncertain write"); });
  queued = { id: "job-1", status: "QUEUED", attempts: 0, ...input, ...actor };
  unfinished = { id: "previous-audit" };
  await processNext();
  assert.equal(updates.at(-1)?.status, "REVIEW_REQUIRED");
  assert.match(String(updates.at(-1)?.error), /previous-audit/);
});

test("due failures are claimed with an incremented attempt counter", async () => {
  queued = { id: "job-1", status: "FAILED", attempts: 2, ...input, ...actor };
  unfinished = { id: "uncertain-write" };
  await processNext();
  assert.deepEqual(updates.find((data) => data.status === "RUNNING")?.attempts, { increment: 1 });
  assert.equal(auditRecords.at(-1)?.jobId, "job-1");
  assert.match(String(auditRecords.at(-1)?.notes), /Background attempt 3/);
});

test("an interrupted approval recovers when no external write ever started", async () => {
  active = { id: "job-1", status: "REVIEW_REQUIRED", ...input, ...actor };
  assert.equal(await recover("job-1"), true);
  assert.equal(updates.at(-1)?.status, "QUEUED");
  assert.equal(auditRecords.at(-1)?.action, "recover-queued-action");
});

test("interrupted writes with an external audit are never blindly replayed", async () => {
  active = { id: "job-1", status: "REVIEW_REQUIRED", ...input, ...actor };
  unfinished = { id: "external-write" };
  assert.equal(await recover("job-1"), false);
  assert.equal(updates.length, 0);
});

test("recipient changes hold the approval without any external calls", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("must not redirect an approved action"); });
  queued = { id: "job-1", status: "QUEUED", attempts: 0, recipientEmail: "other@example.test", ...input, ...actor };
  await processNext();
  assert.equal(updates.at(-1)?.status, "BLOCKED");
});
