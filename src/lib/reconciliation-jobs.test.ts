import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const globals = globalThis as unknown as { prisma?: unknown };
const original = globals.prisma;
let enqueue: typeof import("./reconciliation-jobs").enqueueReconciliation;
let processNext: typeof import("./reconciliation-jobs").processNextReconciliationJob;
let active: Record<string, unknown> | null;
let interrupted: Record<string, unknown> | null;
let unfinished: { id: string } | null;
let heartbeat: string | null;
let created: Record<string, unknown>[];
let updates: Record<string, unknown>[];
let queued: Record<string, unknown> | null;
let claimed: boolean;
let auditsRead: number;
const db = {
  $queryRaw: async () => [],
  appSetting: { findUnique: async () => heartbeat === null ? null : { value: heartbeat } },
  reconciliationAudit: { findFirst: async () => { auditsRead++; return unfinished; } },
  reconciliationJob: {
    findFirst: async ({ where }: { where: { status: unknown } }) =>
      where.status === "QUEUED" ? queued : where.status === "REVIEW_REQUIRED" ? interrupted : active,
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
});
beforeEach(() => {
  active = null; interrupted = null; unfinished = null;
  heartbeat = String(Date.now()); created = []; updates = []; queued = null; claimed = true; auditsRead = 0;
});
after(() => { if (original === undefined) delete globals.prisma; else globals.prisma = original; });
const input = { action: "reassign-owner" as const, assetTag: "0000000024", ninjaDeviceId: "2224" };
const actor = { actorEmployeeId: "ABRW", actorName: "Reviewer", actorEmail: null };

test("persists a job with the authenticated actor without contacting Reftab", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("enqueue must not contact Reftab"); });
  const job = await enqueue(input, actor);
  assert.equal(job.id, "job-1");
  assert.deepEqual(created, [{ ...input, ...actor }]);
});
test("duplicate submissions return the existing active job", async () => {
  active = { id: "existing", status: "RUNNING" };
  assert.equal((await enqueue(input, actor)).id, "existing");
  assert.equal(created.length, 0);
});
test("does not persist extra client fields as job columns", async () => {
  await enqueue({ ...input, title: "client title", ownerEmail: "client@example.test" } as typeof input, actor);
  assert.deepEqual(created, [{ ...input, ...actor }]);
});
test("does not enqueue over an uncertain previous audit", async () => {
  unfinished = { id: "cmww8qnb000028hgqw2up3841" };
  await assert.rejects(enqueue(input, actor), /earlier Reftab write is unconfirmed.*cmww8qnb/);
  assert.equal(created.length, 0);
});
test("does not replay an interrupted job even without an audit", async () => {
  interrupted = { id: "interrupted" };
  await assert.rejects(enqueue(input, actor), /interrupted.*needs review/);
});
for (const unavailable of [null, String(Date.now() - 120_000)]) {
  test(`rejects new work when worker heartbeat is ${unavailable === null ? "missing" : "stale"}`, async () => {
    heartbeat = unavailable;
    await assert.rejects(enqueue(input, actor), /worker is unavailable.*No action was queued/);
    assert.equal(created.length, 0);
  });
}
test("worker never processes a job claimed by another worker", async () => {
  queued = { id: "job-1", ...input, ...actor }; claimed = false;
  await processNext();
  assert.equal(auditsRead, 0);
  assert.equal(updates.some((data) => data.status === "SUCCEEDED"), false);
});
test("worker rechecks audit after acquiring the automatic reconciliation lock", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("must not repeat an uncertain write"); });
  queued = { id: "job-1", ...input, ...actor };
  unfinished = { id: "previous-audit" };
  await processNext();
  assert.equal(updates.at(-1)?.status, "REVIEW_REQUIRED");
  assert.match(String(updates.at(-1)?.error), /previous-audit/);
});
