import assert from "node:assert/strict";
import { test } from "node:test";
import { runReconciliationBatch } from "./reconciliation-batch";

test("waits for each write before starting the next and reports successful items", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const events: string[] = [];
  const batch = runReconciliationBatch([1, 2], async (id) => {
    events.push(`start ${id}`);
    if (id === 1) await gate;
    events.push(`finish ${id}`);
  }, (id) => events.push(`success ${id}`), () => assert.fail("unexpected failure"));
  await Promise.resolve();
  assert.deepEqual(events, ["start 1"]);
  release();
  assert.deepEqual(await batch, { completed: 2, stopped: false });
  assert.deepEqual(events, ["start 1", "finish 1", "success 1", "start 2", "finish 2", "success 2"]);
});

test("preserves successes and stops after an uncertain write without retrying or processing remaining items", async () => {
  const attempted: number[] = [];
  const completed: number[] = [];
  const failures: number[] = [];
  const result = await runReconciliationBatch([1, 2, 3], async (id) => {
    attempted.push(id);
    if (id === 2) throw new Error("Timed out; check Reftab");
  }, (id) => completed.push(id), (id) => failures.push(id));
  assert.deepEqual(result, { completed: 1, stopped: true });
  assert.deepEqual(attempted, [1, 2]);
  assert.deepEqual(completed, [1]);
  assert.deepEqual(failures, [2]);
});
