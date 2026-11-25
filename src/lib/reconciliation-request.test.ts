import assert from "node:assert/strict";
import { test } from "node:test";
import { postReconciliationAction } from "./reconciliation-request";

test("a slow import can succeed after the old sixty-second deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (response: Response) => void;
  let signal!: AbortSignal;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    signal = init.signal!;
    return new Promise<Response>((resolve) => { finish = resolve; });
  });
  const pending = postReconciliationAction({ action: "add-missing-asset" });
  t.mock.timers.tick(90_000);
  assert.equal(signal.aborted, false);
  finish(Response.json({ ok: true, auditId: "audit-1" }));
  const result = await pending;
  assert.equal(result.res.ok, true);
  assert.equal(result.data.auditId, "audit-1");
});

test("an unconfirmed write times out safely without a second POST", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
  const pending = postReconciliationAction({ action: "add-missing-asset" });
  const rejected = assert.rejects(pending, /unconfirmed.*five minutes.*server may still complete.*audit history/i);
  t.mock.timers.tick(300_000);
  await rejected;
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("keeps the deadline active while reading the response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reading!: () => void;
  const started = new Promise<void>((resolve) => { reading = resolve; });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => ({
    ok: true,
    text: () => new Promise<string>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      reading();
    }),
  }) as Response);
  const pending = postReconciliationAction({ action: "add-missing-asset" });
  const rejected = assert.rejects(pending, /unconfirmed.*five minutes/i);
  await started;
  t.mock.timers.tick(300_000);
  await rejected;
});

test("preserves server errors and audit information", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Checkout rejected (Audit a1)" }, { status: 500 }));
  const { res, data } = await postReconciliationAction({ action: "add-missing-asset" });
  assert.equal(res.status, 500);
  assert.equal(data.error, "Checkout rejected (Audit a1)");
});
