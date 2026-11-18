import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ReftabWriteError } from "./reftab-write-error";

let runAuditedReftabChange: typeof import("./reconciliation-audit").runAuditedReftabChange;
const globals = globalThis as unknown as { prisma?: unknown };
const original = globals.prisma;
let state: Record<string, unknown>;
let failStart = false;
let failFinish = false;
let transactionCalls = 0;
const tx = { reconciliationAudit: { update: async ({ data }: { data: Record<string, unknown> }) => {
  if (failFinish) throw new Error("database unavailable");
  Object.assign(state, data);
} } };
before(async () => {
  globals.prisma = {
    reconciliationAudit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (failStart) throw new Error("audit insert failed");
        state = { ...data, id: "audit-123" };
        return state;
      },
      update: tx.reconciliationAudit.update,
    },
    $transaction: async (callback: (client: unknown) => Promise<unknown>) => {
      transactionCalls++;
      const previous = { ...state };
      try { return await callback(tx); }
      catch (error) { state = previous; throw error; }
    },
  };
  ({ runAuditedReftabChange } = await import("./reconciliation-audit"));
});
after(() => { if (original === undefined) delete globals.prisma; else globals.prisma = original; });
const data = { action: "reassign-owner", assetTag: "FRXN7Y2", ninjaDeviceId: "123", actorEmployeeId: "IT", actorName: "Reviewer" };

test("records a pending attempt before Reftab and completes audit with the local transaction", async () => {
  transactionCalls = 0;
  const result = await runAuditedReftabChange(data, async () => {
    assert.equal(state.status, "PENDING");
    return { aid: "123" };
  }, async () => ({ decisionId: "decision-123" }));
  assert.equal(result.auditId, "audit-123");
  assert.equal(state.status, "SUCCEEDED");
  assert.equal(state.decisionId, "decision-123");
  assert.equal(state.resultJson, '{"aid":"123"}');
  assert.equal(transactionCalls, 1);
});

test("does not contact Reftab if recording the initial audit fails", async () => {
  failStart = true;
  try {
    await assert.rejects(runAuditedReftabChange(data, async () => { assert.fail("must not write"); }, async () => {}), /audit insert failed/);
  } finally { failStart = false; }
});

for (const outcome of ["rejected", "uncertain", "partial"] as const) {
  test(`records a ${outcome} Reftab write with the correct outcome`, async () => {
    await assert.rejects(runAuditedReftabChange(data,
      async () => { throw new ReftabWriteError("checkout error", outcome); },
      async () => { assert.fail("must not save local assignment"); }), /checkout error.*Audit audit-123/);
    assert.equal(state.status, outcome === "rejected" ? "FAILED" : "REVIEW_REQUIRED");
  });
}

test("local save failure after external success requires review", async () => {
  await assert.rejects(runAuditedReftabChange(data, async () => ({ aid: "123" }),
    async () => { throw new Error("local save failed"); }), /Reftab completed.*Check Reftab/);
  assert.equal(state.status, "REVIEW_REQUIRED");
  assert.match(String(state.error), /Reftab completed/);
});

test("failed audit finalization retains the initial pending record", async (t) => {
  t.mock.method(console, "error", () => {});
  failFinish = true;
  try {
    await assert.rejects(runAuditedReftabChange(data, async () => "done", async () => {}), /Reftab completed/);
    assert.equal(state.status, "PENDING");
  } finally { failFinish = false; }
});
