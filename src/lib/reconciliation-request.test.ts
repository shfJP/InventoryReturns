import assert from "node:assert/strict";
import { test } from "node:test";
import { enqueueReconciliationAction, postReconciliationAction } from "./reconciliation-request";

test("saving a decision returns immediately without polling or repeating the POST", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ jobId: "saved-1", status: "QUEUED" }, { status: 202 }));
  const { res, data } = await enqueueReconciliationAction({ action: "reassign-owner" });
  assert.equal(res.status, 202);
  assert.equal(data.jobId, "saved-1");
  assert.equal(request.mock.callCount(), 1);
});

test("an uncertain save directs staff to the queue without resubmitting", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Connection lost"); });
  await assert.rejects(enqueueReconciliationAction({ action: "reassign-owner" }), /Check Actions & Audit before resubmitting/);
  assert.equal(request.mock.callCount(), 1);
});

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
  const rejected = assert.rejects(pending, /unconfirmed.*thirty minutes.*server may still complete.*audit history/i);
  t.mock.timers.tick(1_800_000);
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
  const rejected = assert.rejects(pending, /unconfirmed.*thirty minutes/i);
  await started;
  t.mock.timers.tick(1_800_000);
  await rejected;
});

test("preserves server errors and audit information", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Checkout rejected (Audit a1)" }, { status: 500 }));
  const { res, data } = await postReconciliationAction({ action: "add-missing-asset" });
  assert.equal(res.status, 500);
  assert.equal(data.error, "Checkout rejected (Audit a1)");
});

for (const outcome of ["SUCCEEDED", "FAILED", "REVIEW_REQUIRED", "status unavailable"]) {
  test(`polls queued actions through ${outcome} without repeating the POST`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const calls: string[] = [];
    const result = { ok: true, auditId: "audit-queued" };
    t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if (init?.method === "POST") return Response.json({ jobId: "queued-1", status: "QUEUED" }, { status: 202 });
      assert.match(url, /\?job=queued-1$/);
      assert.equal(init?.cache, "no-store");
      return outcome === "status unavailable"
        ? Response.json({ error: "Status unavailable" }, { status: 503 })
        : Response.json({ status: outcome, result, error: "Check the audit" });
    });
    const pending = postReconciliationAction({ action: "reassign-owner" });
    const rejection = outcome === "status unavailable"
      ? assert.rejects(pending, /Status unavailable.*server may still complete/) : null;
    // Let the POST body parse and schedule the first status check.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    t.mock.timers.tick(2_000);
    if (rejection) await rejection;
    else {
      const response = await pending;
      assert.equal(response.res.ok, outcome === "SUCCEEDED");
      if (outcome === "SUCCEEDED") assert.deepEqual(response.data, result);
      else assert.equal(response.data.error, "Check the audit");
    }
    assert.deepEqual(calls, ["POST", "GET"]);
  });
}
