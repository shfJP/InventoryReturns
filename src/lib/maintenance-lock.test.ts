import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const globals = globalThis as unknown as { prisma?: unknown };
const original = globals.prisma;
let acquired = true;
let withMaintenanceLock: typeof import("./maintenance-lock").withMaintenanceLock;

before(async () => {
  globals.prisma = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ $queryRaw: async () => [{ acquired }] }),
  };
  ({ withMaintenanceLock } = await import("./maintenance-lock"));
});
after(() => { if (original === undefined) delete globals.prisma; else globals.prisma = original; });

test("an overlapping invocation does not execute work or overwrite run state", async () => {
  acquired = false;
  let called = false;
  assert.equal(await withMaintenanceLock(async () => { called = true; return "ran"; }, () => "busy"), "busy");
  assert.equal(called, false);
});

test("an acquired maintenance lock returns the action result and propagates failure", async () => {
  acquired = true;
  assert.equal(await withMaintenanceLock(async () => "completed", () => "busy"), "completed");
  await assert.rejects(withMaintenanceLock(async () => { throw new Error("sync failed"); }, () => "busy"), /sync failed/);
});
