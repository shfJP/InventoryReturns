import assert from "node:assert/strict";
import { after, before, beforeEach, test, type TestContext } from "node:test";

type RecordData = Record<string, unknown>;
let service: typeof import("./missing-reftab-asset");
let reconciliation: typeof import("./owner-reconciliation");
let automation: typeof import("./house-reconciliation");
const globals = globalThis as unknown as { prisma?: unknown };
const originalPrisma = globals.prisma;
const owner = { employeeId: "IT123", displayName: "IT Help", email: "ithelp@sevenhills.org", upn: null, isActive: true };
const actor = { actorEmployeeId: "REVIEWER", actorName: "Reviewer", actorEmail: "reviewer@example.test" };
const input = { assetTag: "HOUSE01", ninjaDeviceId: "123", categoryId: "456" };
let login: string | null;
let directoryOwner: typeof owner | null;
let assignments: RecordData[];
let unresolved: RecordData[];
let audits: RecordData[];
let writes: { path: string; body: RecordData }[];
let existingLiveAsset: boolean;
let checkoutFails: boolean;
let auditFails: boolean;
let cacheInvalidations: number;
let computerName: string;
let categories: { cid: number; name: string }[];

before(async () => {
  const models = {
    ninjaOneDevice: { findMany: async () => [{
      id: "123", systemName: computerName, displayName: null, dnsName: null, netbiosName: null,
      nodeClass: "WINDOWS_WORKSTATION", likelyUser: login,
      detailsJson: JSON.stringify({ serialNumber: "HOUSE01", model: "OptiPlex" }),
      loginObservations: [],
    }] },
    user: {
      findMany: async () => directoryOwner ? [directoryOwner] : [],
      findFirst: async ({ where }: { where: RecordData }) => {
        assert.deepEqual(where, {
          isActive: true, OR: [
            { email: { equals: "ithelp@sevenhills.org", mode: "insensitive" } },
            { upn: { equals: "ithelp@sevenhills.org", mode: "insensitive" } },
          ],
        });
        return directoryOwner;
      },
    },
    hardwareDecommission: { findMany: async () => [] },
    equipmentAssignment: {
      findMany: async () => assignments,
      findFirst: async () => assignments[0] ?? null,
      upsert: async ({ create }: { create: RecordData }) => {
        const assignment = { ...create, user: directoryOwner };
        assignments.push(assignment);
        return assignment;
      },
    },
    unresolvedCollection: {
      findMany: async () => unresolved,
      upsert: async ({ create }: { create: RecordData }) => { unresolved.push(create); return create; },
    },
    reconciliationAudit: {
      findFirst: async () => null,
      create: async ({ data }: { data: RecordData }) => {
        if (auditFails) throw new Error("Audit unavailable");
        const entry = { ...data, id: `audit-${audits.length}` };
        audits.push(entry);
        return entry;
      },
      update: async ({ where, data }: { where: { id: string }; data: RecordData }) => {
        const entry = audits.find((item) => item.id === where.id)!;
        Object.assign(entry, data);
        return entry;
      },
    },
    appSetting: { deleteMany: async () => { cacheInvalidations++; return { count: 1 }; } },
    $queryRaw: async () => [{ acquired: true }],
  };
  globals.prisma = { ...models, $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(models) };
  Object.assign(process.env, {
    REF_TAB_API_URL: "https://reftab.house.test/api",
    REF_TAB_API_PUBLIC_KEY: "test", REF_TAB_API_SECRET_KEY: "test",
    REF_TAB_CREATE_MISSING_LOANEES: "false", REF_TAB_CREATE_ASSET_ENDPOINT: "assets",
    REF_TAB_CHECKOUT_ENDPOINT: "loans", REF_TAB_CREATE_ASSET_LOCATION_ID: "67497",
  });
  service = await import("./missing-reftab-asset");
  reconciliation = await import("./owner-reconciliation");
  automation = await import("./house-reconciliation");
});

after(() => { if (originalPrisma === undefined) delete globals.prisma; else globals.prisma = originalPrisma; });
beforeEach(() => {
  login = "7HILLS\\house";
  directoryOwner = null;
  assignments = [];
  unresolved = [];
  audits = [];
  writes = [];
  existingLiveAsset = checkoutFails = auditFails = false;
  cacheInvalidations = 0;
  computerName = "HOUSE-DT01";
  categories = [{ cid: 789, name: "Laptops" }, { cid: 456, name: "OptiPlex Desktops" }];
});

function mockReftab(t: TestContext, expectedLoaneeId = 123) {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (value: string, init?: RequestInit) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://reftab.house.test");
    if (init?.method === "GET" && url.pathname === "/api/assets/HOUSE01") {
      return existingLiveAsset ? Response.json({ aid: "HOUSE01" }) : new Response(null, { status: 404 });
    }
    if (init?.method === "GET" && url.pathname === "/api/loanees") {
      return Response.json([
        { lnid: 999, employeeId: "IT123", email: "wrong@example.test" },
        { lnid: 123, email: "ITHELP@sevenhills.org" },
        { lnid: 456, employeeId: "EMP456", email: "employee@sevenhills.org" },
      ]);
    }
    if (init?.method === "GET" && url.pathname === "/api/categories") {
      return Response.json(categories);
    }
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as RecordData;
    writes.push({ path: url.pathname, body });
    if (url.pathname === "/api/assets") return Response.json({ aid: "HOUSE01" });
    assert.equal(url.pathname, "/api/loans");
    assert.equal(body.lnid, expectedLoaneeId, "loans must use the intended Reftab loanee");
    assert.deepEqual(body.aids, ["HOUSE01"]);
    return checkoutFails
      ? Response.json({ error: "Checkout rejected" }, { status: 400 })
      : Response.json({ lid: 789 });
  });
}

test("automatically imports a missing House device and does not repeat it", async (t) => {
  mockReftab(t);
  assert.deepEqual(await automation.reconcileHouseDevices(), { completed: 1, skipped: 0, failed: 0 });
  assert.deepEqual(writes.map((item) => item.path), ["/api/assets", "/api/loans"]);
  assert.equal(unresolved[0].employeeEmail, owner.email);
  assert.equal(audits[0].actorEmployeeId, "system:house-reconciliation");
  assert.deepEqual(await automation.reconcileHouseDevices(), { completed: 0, skipped: 0, failed: 0 });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].body.cid, 456);
});

test("House imports use Desktop even with a laptop hostname and a different selected category", async (t) => {
  mockReftab(t);
  computerName = "HOUSE-LT";
  await service.addMissingReftabAsset({ ...input, categoryId: "789" }, actor);
  assert.equal(writes[0].body.cid, 456);
  assert.match(String(audits[0].notes), /Category policy: Desktop/);
});

test("House imports fail before writing when a Desktop category cannot be identified", async (t) => {
  mockReftab(t);
  categories = [{ cid: 789, name: "Laptops" }];
  await assert.rejects(service.addMissingReftabAsset(input, actor), /House computers require a Desktop category/);
  assert.equal(writes.length, 0);
  assert.equal(audits[0].status, "FAILED");
});

test("automatic imports recheck the House login before writing", async (t) => {
  mockReftab(t);
  login = "7HILLS\\employee";
  directoryOwner = { ...owner, employeeId: "EMP456", displayName: "Employee", email: "employee@sevenhills.org" };
  await assert.rejects(service.addMissingReftabAsset({ ...input, requireHouse: true }, actor), /no longer has the House login/);
  assert.equal(writes.length, 0);
});

for (const withDirectoryOwner of [false, true]) {
  test(`creates and loans a house device ${withDirectoryOwner ? "with" : "without"} a directory account`, async (t) => {
    mockReftab(t);
    if (withDirectoryOwner) directoryOwner = owner;
    const result = await service.addMissingReftabAsset(input, actor);
    assert.equal(result.recipient.email, "ithelp@sevenhills.org");
    assert.deepEqual(result.result, { aid: "HOUSE01", loaneeId: "123" });
    assert.deepEqual(writes.map((item) => item.path), ["/api/assets", "/api/loans"]);
    assert.match(String(writes[0].body.notes), /7HILLS\\house.*loaned to ithelp@sevenhills.org/);
    assert.equal(writes[0].body.aid, "HOUSE01");
    assert.equal(writes[0].body.id, undefined);
    assert.equal(writes[0].body.serial, "HOUSE01");
    assert.equal(writes[0].body.title, "HOUSE-DT01");
    assert.equal(writes[0].body.cid, 456);
    assert.equal(audits[0].status, "SUCCEEDED");
    assert.equal(audits[0].actorEmployeeId, actor.actorEmployeeId);
    assert.match(String(audits[0].evidenceJson), /ithelp@sevenhills.org/);
    assert.equal(cacheInvalidations, 1);
    if (withDirectoryOwner) {
      assert.equal(assignments[0].assignedToEmployeeId, "IT123");
      assert.equal(unresolved.length, 0);
    } else {
      assert.equal(assignments.length, 0);
      assert.equal(unresolved[0].employeeEmail, "ithelp@sevenhills.org");
      assert.equal(unresolved[0].source, "reftab_unmatched_assignee");
    }
    assert.equal((await reconciliation.getOwnerReconciliationResult()).missingReftabRows.length, 0);
    await assert.rejects(service.addMissingReftabAsset(input, actor), /No current NinjaOne device/);
    assert.equal(writes.length, 2, "a repeat import must not write again");
  });
}

test("keeps ordinary missing-device imports assigned to their active directory owner", async (t) => {
  mockReftab(t, 456);
  login = "7HILLS\\employee";
  directoryOwner = {
    employeeId: "EMP456", displayName: "Employee", email: "employee@sevenhills.org",
    upn: null, isActive: true,
  };
  const result = await service.addMissingReftabAsset(input, actor);
  assert.equal(result.recipient.email, "employee@sevenhills.org");
  assert.equal(assignments[0].assignedToEmployeeId, "EMP456");
  assert.equal(unresolved.length, 0);
  assert.equal(audits[0].status, "SUCCEEDED");
  assert.equal((await reconciliation.getOwnerReconciliationResult()).missingReftabRows.length, 0);
});

test("rechecks the current login and ignores supplied owner/identity overrides", async (t) => {
  mockReftab(t);
  const untrustedInput = { ...input, ownerEmployeeId: "IT123", ownerEmail: "other@example.test", serial: "WRONG" };
  await service.addMissingReftabAsset(untrustedInput, actor);
  assert.equal(writes[0].body.serial, "HOUSE01");
  assert.equal(writes[1].body.lnid, 123);
});

for (const otherLogin of [null, "MACHINE\\house", "OTHER\\house", "7HILLS\\house2", "7HILLS\\someone"]) {
  test(`does not route unrelated or missing logins to IT Help (${otherLogin})`, async (t) => {
    mockReftab(t);
    login = otherLogin;
    await assert.rejects(service.addMissingReftabAsset(input, actor), /active directory owner/);
    assert.equal(writes.length, 0);
    assert.equal(audits.length, 0);
  });
}

test("rejects a stale asset identity without contacting Reftab", async (t) => {
  mockReftab(t);
  await assert.rejects(service.addMissingReftabAsset({ ...input, assetTag: "STALE" }, actor), /No current NinjaOne device/);
  assert.equal(writes.length, 0);
});

test("checks Reftab itself for an existing asset before creating or loaning it", async (t) => {
  mockReftab(t);
  existingLiveAsset = true;
  await assert.rejects(service.addMissingReftabAsset(input, actor), /already exists in Reftab/);
  assert.equal(writes.length, 0);
  assert.equal(audits[0].status, "FAILED");
});

test("a failed checkout requires review and does not claim a completed local assignment", async (t) => {
  mockReftab(t);
  checkoutFails = true;
  await assert.rejects(service.addMissingReftabAsset(input, actor), /created, but checkout failed.*Check Reftab/);
  assert.equal(audits[0].status, "REVIEW_REQUIRED");
  assert.equal(assignments.length, 0);
  assert.equal(unresolved.length, 0);
  assert.equal(cacheInvalidations, 1);
});

test("does not write to Reftab when the audit cannot be saved", async (t) => {
  mockReftab(t);
  auditFails = true;
  await assert.rejects(service.addMissingReftabAsset(input, actor), /Audit unavailable/);
  assert.equal(writes.length, 0);
});
