import assert from "node:assert/strict";
import { after, before, beforeEach, test, type TestContext } from "node:test";

type RecordData = Record<string, any>;
const globals = globalThis as unknown as { prisma?: unknown };
const originalPrisma = globals.prisma;
const it = { employeeId: "IT123", displayName: "IT Help", email: "ithelp@sevenhills.org", upn: null, isActive: true };
const isaac = { employeeId: "ISAAC", displayName: "Isaac", email: "iadusu@sevenhills.org", upn: null, isActive: true };
const house = { employeeId: "HOUSE", displayName: "House", email: "house@sevenhills.org", upn: null, isActive: true };
const alice = { employeeId: "ALICE", displayName: "Alice", email: "alice@sevenhills.org", upn: null, isActive: true };
let users: typeof it[];
let assignments: RecordData[];
let unresolved: RecordData[];
let audits: RecordData[];
let decisions: RecordData[];
let writes: { path: string; body: RecordData }[];
let login: string;
let likelyUser: string;
let checkoutFails: boolean;
let jobs: RecordData[];
let processNext: typeof import("./reconciliation-jobs").processNextReconciliationJob;
let computerName: string;
let expectedCheckoutLnid: number;
let automation: typeof import("./house-reconciliation");
let automaticOwners: typeof import("./automatic-owner-reconciliation");
let reconciliation: typeof import("./owner-reconciliation");
let ownerService: typeof import("./reconcile-owner");

before(async () => {
  const models = {
    ninjaOneDevice: { findMany: async () => [{
      id: "123", systemName: computerName, displayName: null, dnsName: null, netbiosName: null,
      nodeClass: "WINDOWS_WORKSTATION", likelyUser,
      detailsJson: JSON.stringify({ lastLoggedOnUser: { userName: login, logonTime: "2026-11-05T21:18:00Z" } }),
      loginObservations: [], loginHistoryStartedAt: new Date("2026-11-05T00:00:00Z"),
      loginHistoryCheckedAt: new Date("2026-11-06T14:08:00Z"),
    }] },
    user: {
      findMany: async () => users,
      findFirst: async () => users.find((user) => user.email === it.email) ?? null,
    },
    hardwareDecommission: { findMany: async () => [] },
    reconciliationJob: {
      findFirst: async ({ where }: RecordData) => jobs.find((job) => where.status?.in
        ? where.status.in.includes(job.status)
        : job.status === "QUEUED" || (job.status === "FAILED" && (!job.nextAttemptAt || job.nextAttemptAt <= new Date())) ) ?? null,
      create: async ({ data }: RecordData) => {
        const job = { id: String(jobs.length), status: "QUEUED", attempts: 0, categoryId: null, ...data, updatedAt: new Date() };
        jobs.push(job); return job;
      },
      updateMany: async ({ where, data }: RecordData) => {
        if (!where.id) return { count: 0 };
        const job = jobs.find((job) => job.id === where.id && (!where.status || job.status === where.status));
        if (!job) return { count: 0 };
        const attempts = data.attempts?.increment ? job.attempts + data.attempts.increment : job.attempts;
        Object.assign(job, data, { attempts, updatedAt: new Date() }); return { count: 1 };
      },
    },
    equipmentAssignment: {
      findMany: async () => assignments.map((assignment) => ({ ...assignment, user: users.find((user) => user.employeeId === assignment.assignedToEmployeeId) })),
      deleteMany: async ({ where }: RecordData) => {
        assignments = assignments.filter((item) => item.assetTag !== where.assetTag || item.assignedToEmployeeId !== where.assignedToEmployeeId);
        return { count: 1 };
      },
      upsert: async ({ create }: RecordData) => { assignments.push(create); return create; },
    },
    unresolvedCollection: {
      findMany: async () => unresolved,
      upsert: async ({ create }: RecordData) => { unresolved.push(create); return create; },
    },
    reconciliationAudit: {
      findFirst: async () => audits.find((audit) => ["PENDING", "REVIEW_REQUIRED"].includes(audit.status)) ?? null,
      create: async ({ data }: RecordData) => { const audit = { ...data, id: String(audits.length) }; audits.push(audit); return audit; },
      update: async ({ where, data }: RecordData) => Object.assign(audits.find((audit) => audit.id === where.id)!, data),
    },
    reconciliationDecision: { create: async ({ data }: RecordData) => { const decision = { ...data, id: String(decisions.length) }; decisions.push(decision); return decision; } },
    appSetting: { deleteMany: async () => ({ count: 1 }) },
    $queryRaw: async () => [],
  };
  globals.prisma = { ...models, $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(models) };
  Object.assign(process.env, {
    REF_TAB_API_URL: "https://reftab.existing-house.test/api",
    REF_TAB_API_PUBLIC_KEY: "test", REF_TAB_API_SECRET_KEY: "test",
    REF_TAB_CREATE_MISSING_LOANEES: "false", REF_TAB_CHECKOUT_ENDPOINT: "loans",
  });
  automation = await import("./house-reconciliation");
  automaticOwners = await import("./automatic-owner-reconciliation");
  reconciliation = await import("./owner-reconciliation");
  ownerService = await import("./reconcile-owner");
  processNext = (await import("./reconciliation-jobs")).processNextReconciliationJob;
});
after(() => { if (originalPrisma === undefined) delete globals.prisma; else globals.prisma = originalPrisma; });
beforeEach(() => {
  users = [isaac, house, it, alice];
  computerName = "SHRI-2SGT624-TC";
  expectedCheckoutLnid = 123;
  assignments = [{ assetTag: "0000000468", aid: "0000000468", title: "SHRI-2SGT624-TC", serial: null, assignedToEmployeeId: isaac.employeeId }];
  unresolved = []; audits = []; decisions = []; writes = [];
  login = likelyUser = "7HILLS\\House";
  checkoutFails = false;
  jobs = [];
});

function mockReftab(t: TestContext) {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (value: string, init?: RequestInit) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://reftab.existing-house.test");
    if (init?.method === "GET" && url.pathname === "/api/loanees") {
      return Response.json([
        { lnid: 999, employeeId: it.employeeId, email: "wrong@example.test" },
        { lnid: 123, email: "ITHELP@sevenhills.org" },
        { lnid: 456, email: isaac.email },
        { lnid: 567, email: alice.email },
      ]);
    }
    if (init?.method === "GET" && url.pathname === "/api/loans") {
      assert.equal(url.searchParams.get("aid"), "0000000468");
      return Response.json([{ lid: 789, email: isaac.email, aids: ["0000000468"], status: "out" }]);
    }
    const body = JSON.parse(String(init?.body));
    writes.push({ path: url.pathname, body });
    if (url.pathname === "/api/loans/789") {
      assert.equal(init?.method, "PUT");
      assert.equal(body.status, "in");
      assert.equal(body.aids, undefined);
      return Response.json({});
    }
    assert.equal(init?.method, "POST");
    assert.deepEqual(body.aids, ["0000000468"]);
    assert.equal(url.pathname, "/api/loans");
    assert.equal(body.lnid, expectedCheckoutLnid, "must checkout to the intended recipient");
    return checkoutFails ? Response.json({ error: "Checkout rejected" }, { status: 400 }) : Response.json({ lid: 790 });
  });
}

async function runOwners(houseOnly = false, afterSync = false) {
  const writesBefore = writes.length;
  const countBefore = jobs.length;
  const result = houseOnly ? await automation.reconcileHouseDevices()
    : afterSync ? await automaticOwners.reconcileAutomaticOwnersAfterSync()
    : await automaticOwners.reconcileAutomaticOwners();
  assert.equal(writes.length, writesBefore, "policy evaluation must only save decisions");
  assert.equal("queued" in result ? result.queued : 0, jobs.length - countBefore);
  const pending = jobs.filter((job) => job.status === "QUEUED");
  for (const _ of pending) await processNext();
  return { completed: pending.filter((job) => job.status === "SUCCEEDED").length,
    skipped: result.skipped, failed: result.failed + pending.filter((job) => job.status !== "SUCCEEDED").length };
}

for (const directoryAccount of [true, false]) {
  test(`automatically moves existing Isaac asset to IT Help with stale House evidence, directory account=${directoryAccount}`, async (t) => {
    mockReftab(t);
    if (!directoryAccount) users = [isaac, house];
    const before = await reconciliation.getOwnerReconciliationResult();
    assert.equal(before.rows[0].ninjaOwner.email, it.email);
    assert.ok(before.rows[0].confidence >= 85);
    assert.match(before.rows[0].matchReason, /asset title/);
    assert.equal(before.rows[0].ownerEvidence.signal, "stale");
    assert.deepEqual(await runOwners(true), { completed: 1, skipped: 0, failed: 0 });
    assert.deepEqual(writes.map((write) => write.path), ["/api/loans/789", "/api/loans"]);
    assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.status, "SUCCEEDED");
    assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.action, "reassign-owner");
    assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.actorEmployeeId, "system:house-reconciliation");
    assert.match(audits.find((audit) => audit.action === "reassign-owner")!.proposedOwnerName, /ithelp@sevenhills.org/);
    assert.equal(decisions[0].reason, "Approved and written to Reftab");
    const after = await reconciliation.getOwnerReconciliationResult();
    assert.equal(after.rows.length, 0);
    assert.equal(after.reportItems[0].status, "Aligned");
    assert.deepEqual(await runOwners(true), { completed: 0, skipped: 0, failed: 0 });
    assert.equal(writes.length, 2, "next sync must not repeat the write");
  });
}

test("does not automatically move other domain House accounts", async (t) => {
  mockReftab(t);
  login = likelyUser = "OTHER\\House";
  assert.deepEqual(await runOwners(true), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 0);
});

test("last login overrides a conflicting inferred owner for House policy", async (t) => {
  mockReftab(t);
  likelyUser = "7HILLS\\Isaac";
  assert.deepEqual(await runOwners(true), { completed: 1, skipped: 0, failed: 0 });
});

test("does not auto-move when latest login is Isaac but inferred owner is House", async (t) => {
  mockReftab(t);
  login = "7HILLS\\Isaac";
  assert.deepEqual(await runOwners(true), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 0);
});

test("partial Reftab writes retain prior local owner and block automatic retry", async (t) => {
  mockReftab(t);
  checkoutFails = true;
  assert.deepEqual(await runOwners(true), { completed: 0, skipped: 0, failed: 1 });
  assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.status, "REVIEW_REQUIRED");
  assert.equal(assignments[0].assignedToEmployeeId, isaac.employeeId);
  assert.equal(decisions.length, 0);
  assert.deepEqual(await runOwners(true), { completed: 0, skipped: 1, failed: 0 });
  assert.equal(writes.length, 2);
});

test("House automation saves a durable decision before any Reftab request", async (t) => {
  mockReftab(t);
  assert.deepEqual(await automation.reconcileHouseDevices(), { completed: 0, queued: 1, skipped: 0, failed: 0 });
  assert.equal(jobs[0].recipientEmail, it.email);
  assert.equal(jobs[0].status, "QUEUED");
  assert.equal(writes.length, 0);
  assert.equal(audits[0].action, "queue-action");
});

test("automatic service rechecks House login before external writes", async (t) => {
  mockReftab(t);
  login = likelyUser = "OTHER\\House";
  await assert.rejects(ownerService.reconcileOwner(
    { assetTag: "0000000468", ninjaDeviceId: "123", requireHouse: true },
    { actorEmployeeId: "system", actorName: "System", actorEmail: null },
  ), /no longer has the House login/);
  assert.equal(writes.length, 0);
});

function laptop(name = "SHRI-2SGT624-LT") {
  computerName = name;
  assignments[0].title = name;
  login = likelyUser = alice.email;
  expectedCheckoutLnid = 567;
}

test("automatically checks in and checks out an LT mismatch and records the new owner", async (t) => {
  mockReftab(t);
  laptop();
  assert.deepEqual(await runOwners(), { completed: 1, skipped: 0, failed: 0 });
  assert.deepEqual(writes.map((write) => write.path), ["/api/loans/789", "/api/loans"]);
  assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.actorEmployeeId, "system:laptop-reconciliation");
  assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.status, "SUCCEEDED");
  assert.match(audits.find((audit) => audit.action === "reassign-owner")!.notes, /Automatic -LT ownership policy/);
  assert.equal(assignments[0].assignedToEmployeeId, alice.employeeId);
  assert.equal(decisions[0].proposedOwnerEmployeeId, alice.employeeId);
  const result = await reconciliation.getOwnerReconciliationResult();
  assert.equal(result.rows.length, 0);
  assert.equal(result.reportItems[0].status, "Aligned");
  assert.deepEqual(await runOwners(), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 2);
});

test("LT suffix is case insensitive", async (t) => {
  mockReftab(t);
  laptop("SHRI-2SGT624-lt");
  assert.deepEqual(await runOwners(), { completed: 1, skipped: 0, failed: 0 });
});

for (const name of ["SHRI-2SGT624-TC", "SHRI-2SGT624-LT550", "SHRI-2SGT624-LT-old"]) {
  test(`does not automatically change ordinary owner of ${name}`, async (t) => {
    mockReftab(t);
    laptop(name);
    assert.deepEqual(await runOwners(), { completed: 0, skipped: 0, failed: 0 });
    assert.equal(writes.length, 0);
  });
}

test("House policy takes priority on LT computers", async (t) => {
  mockReftab(t);
  laptop();
  login = likelyUser = "7HILLS\\House";
  expectedCheckoutLnid = 123;
  assert.deepEqual(await runOwners(), { completed: 1, skipped: 0, failed: 0 });
  assert.equal(assignments[0].assignedToEmployeeId, it.employeeId);
  assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.actorEmployeeId, "system:house-reconciliation");
});

test("House-only entry point does not process ordinary LT mismatches", async (t) => {
  mockReftab(t);
  laptop();
  assert.deepEqual(await runOwners(true), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 0);
});

test("ordinary LT computers missing from Reftab are not automatically imported", async (t) => {
  mockReftab(t);
  laptop();
  assignments = [];
  const result = await reconciliation.getOwnerReconciliationResult();
  assert.equal(result.missingReftabRows.length, 1);
  assert.deepEqual(await runOwners(), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 0);
});

test("does not change LT ownership for an unresolved or inactive NinjaOne user", async (t) => {
  mockReftab(t);
  laptop();
  users = users.filter((user) => user.employeeId !== alice.employeeId);
  assert.deepEqual(await runOwners(), { completed: 0, skipped: 0, failed: 0 });
  users.push({ ...alice, isActive: false });
  assert.deepEqual(await runOwners(), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 0);
});

test("partial LT checkout failure requires review and blocks automatic retry", async (t) => {
  mockReftab(t);
  laptop();
  checkoutFails = true;
  assert.deepEqual(await runOwners(false, true), { completed: 0, skipped: 0, failed: 1 });
  assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.status, "REVIEW_REQUIRED");
  assert.equal(assignments[0].assignedToEmployeeId, isaac.employeeId);
  assert.deepEqual(await runOwners(), { completed: 0, skipped: 1, failed: 0 });
  assert.equal(writes.length, 2);
});

test("LT automation saves its original recipient for background execution", async (t) => {
  mockReftab(t);
  laptop();
  assert.deepEqual(await automaticOwners.reconcileAutomaticOwners(), { completed: 0, queued: 1, skipped: 0, failed: 0 });
  assert.equal(jobs[0].recipientEmail, alice.email);
  assert.equal(jobs[0].actorEmployeeId, "system:laptop-reconciliation");
  assert.equal(writes.length, 0);
});

test("conflicting LT assignments are held for review", async (t) => {
  mockReftab(t);
  laptop();
  assignments.push({ ...assignments[0], assignedToEmployeeId: house.employeeId });
  const result = await runOwners();
  assert.equal(result.completed, 0);
  assert.ok(result.skipped > 0);
  assert.equal(writes.length, 0);
});

test("automatic service rechecks LT suffix before external writes", async (t) => {
  mockReftab(t);
  laptop("SHRI-2SGT624-TC");
  await assert.rejects(ownerService.reconcileOwner(
    { assetTag: "0000000468", ninjaDeviceId: "123", requireLaptop: true },
    { actorEmployeeId: "system:laptop-reconciliation", actorName: "System", actorEmail: null },
  ), /no longer ends in -LT/);
  assert.equal(writes.length, 0);
});

test("external scheduler keeps manual sync calls from running ownership automation", async (t) => {
  mockReftab(t);
  const previous = process.env.SYNC_SCHEDULER;
  process.env.SYNC_SCHEDULER = "external";
  try {
    assert.deepEqual(await runOwners(false, true), { completed: 0, skipped: 0, failed: 0 });
    assert.equal(writes.length, 0);
    // The scheduled command's direct entry point still executes and attributes
    // the write to automation even with the HTTP hook disabled.
    assert.deepEqual(await runOwners(), { completed: 1, skipped: 0, failed: 0 });
    assert.equal(audits.find((audit) => audit.action === "reassign-owner")!.actorEmployeeId, "system:house-reconciliation");
  } finally {
    if (previous === undefined) delete process.env.SYNC_SCHEDULER;
    else process.env.SYNC_SCHEDULER = previous;
  }
});
