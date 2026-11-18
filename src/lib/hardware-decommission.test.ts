import assert from "node:assert/strict";
import { after, before, beforeEach, test, type TestContext } from "node:test";

type Fields = Record<string, unknown>;
let service: typeof import("./hardware-decommission");
const globals = globalThis as unknown as { prisma?: unknown };
const originalPrisma = globals.prisma;
let saved: Fields | null;
let audits: Fields[];
let live: Fields;
let createdAsset: Fields | null;
let reftabWrites: number;
let ninjaWrites: number;
let localDeletes: number;
let reftabOutcome: "success" | "timeout" | "bad notes" | "rejected";
let ninjaOutcome: "success" | "timeout" | "rejected" | "server error";
let failAuditStart: boolean;
let failLocalSave: boolean;
const actor = { actorEmployeeId: "IT123", actorName: "IT Reviewer", actorEmail: "it@example.test" };
const input = { ninjaDeviceId: "123", assetTag: "FRXN7Y2", categoryId: "456" };
const device = {
  id: "123", displayName: "BDOUCETTE-LT550", systemName: "BDOUCETTE-LT550",
  detailsJson: JSON.stringify({ serialNumber: "FRXN7Y2", model: "Latitude 550" }),
  offline: true, lastContact: "2024-04-11T15:38:00Z", lastUpdate: "2026-11-11T12:00:00Z",
  likelyUser: null, loginObservations: [],
};
function matches(where: Fields): boolean {
  if (!saved) return false;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      const condition = value as { in?: unknown[]; not?: unknown };
      return condition.in ? condition.in.includes(saved![key]) : saved![key] !== condition.not;
    }
    return saved![key] === value;
  });
}
function record(): Fields {
  assert.ok(saved);
  return saved;
}
function id(): string { return String(record().id); }
const workflowModel = {
  findUnique: async ({ where }: { where: Fields }) => matches(where) ? { ...saved } : null,
  findUniqueOrThrow: async ({ where }: { where: Fields }) => {
    assert.ok(matches(where)); return { ...saved };
  },
  findMany: async ({ where }: { where?: Fields } = {}) => saved && (!where || matches(where)) ? [{ ...saved }] : [],
  create: async ({ data }: { data: Fields }) => {
    if (saved) throw new Error("unique constraint prevents duplicate workflow");
    saved = { createdAt: new Date(), ...data }; return { ...saved };
  },
  update: async ({ data }: { data: Fields }) => {
    if (failLocalSave) throw new Error("local database failure");
    Object.assign(record(), data); return { ...saved };
  },
  updateMany: async ({ where, data }: { where: Fields; data: Fields }) => {
    if (!matches(where)) return { count: 0 };
    Object.assign(record(), data); return { count: 1 };
  },
};
const auditModel = {
  create: async ({ data }: { data: Fields }) => {
    if (failAuditStart) throw new Error("audit unavailable");
    const entry = { id: `audit-${audits.length}`, ...data };
    audits.push(entry); return entry;
  },
  update: async ({ where, data }: { where: { id: string }; data: Fields }) => {
    const entry = audits.find((item) => item.id === where.id)!; Object.assign(entry, data); return entry;
  },
};
before(async () => {
  const models = {
    hardwareDecommission: workflowModel, reconciliationAudit: auditModel,
    equipmentAssignment: { findMany: async () => [] },
    unresolvedCollection: { findMany: async () => [] },
    user: { findMany: async () => [] },
    ninjaOneDevice: {
      findMany: async () => [device],
      deleteMany: async () => { localDeletes++; return { count: 1 }; },
    },
    appSetting: { deleteMany: async () => ({ count: 1 }) },
  };
  globals.prisma = {
    ...models,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const oldRecord = saved ? { ...saved } : null;
      const oldAudits = audits.map((entry) => ({ ...entry }));
      try { return await callback(models); }
      catch (error) { saved = oldRecord; audits = oldAudits; throw error; }
    },
  };
  Object.assign(process.env, {
    NINJAONE_BASE_URL: "https://ninjaone.workflow.test", NINJAONE_CLIENT_ID: "test", NINJAONE_CLIENT_SECRET: "test",
    NINJAONE_SCOPE: "monitoring management",
    REF_TAB_API_URL: "https://reftab.workflow.test/api", REF_TAB_API_PUBLIC_KEY: "test", REF_TAB_API_SECRET_KEY: "test",
    REF_TAB_CREATE_ASSET_ENDPOINT: "assets", REF_TAB_CREATE_ASSET_LOCATION_ID: "67497",
    REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD: "Service Tag", REF_TAB_CREATE_ASSET_EXPRESS_CODE_FIELD: "Express Code",
  });
  service = await import("./hardware-decommission");
});
after(() => { if (originalPrisma === undefined) delete globals.prisma; else globals.prisma = originalPrisma; });
beforeEach((context) => {
  const t = context as TestContext;
  saved = null; audits = []; createdAsset = null;
  reftabWrites = 0; ninjaWrites = 0; localDeletes = 0;
  live = { id: 123, uid: "stable-uid", offline: true, lastContact: 1712849880, approvalStatus: "APPROVED" };
  reftabOutcome = "success"; ninjaOutcome = "success"; failAuditStart = false; failLocalSave = false;
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (value: string | URL, init?: RequestInit) => {
    const url = new URL(value);
    if (url.origin === "https://ninjaone.workflow.test") {
      if (url.pathname === "/ws/oauth/token") {
        assert.equal(new URLSearchParams(String(init?.body)).get("scope"), "monitoring management");
        return Response.json({ access_token: "mock-token" });
      }
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer mock-token");
      if (url.pathname === "/api/v2/device/123") return Response.json(live);
      assert.equal(url.pathname, "/api/v2/device/123/decommission");
      assert.equal(init?.method, "POST");
      assert.equal(record().status, "REMOVING");
      assert.equal(audits.at(-1)?.status, "PENDING");
      ninjaWrites++;
      if (ninjaOutcome === "timeout") throw new Error("connection lost");
      if (ninjaOutcome === "rejected") return new Response("Forbidden", { status: 403 });
      if (ninjaOutcome === "server error") return new Response("Server error", { status: 500 });
      live.approvalStatus = "DECOMMISSIONED";
      return new Response(null, { status: 204 });
    }
    assert.equal(url.origin, "https://reftab.workflow.test");
    if (url.pathname === "/api/status") return Response.json([{ statid: 9, name: "Decommissioned" }]);
    if (url.pathname === "/api/assets/FRXN7Y2") return createdAsset ? Response.json(createdAsset) : new Response("", { status: 404 });
    assert.equal(url.pathname, "/api/assets");
    assert.equal(init?.method, "POST");
    assert.equal(record().status, "CREATING");
    assert.equal(audits.at(-1)?.status, "PENDING");
    reftabWrites++;
    if (reftabOutcome === "rejected") return new Response("Validation failed", { status: 400 });
    const body = JSON.parse(String(init?.body));
    createdAsset = { aid: body.aid, status: { name: "Decommissioned" }, notes: reftabOutcome === "bad notes" ? "truncated" : body.notes };
    if (reftabOutcome === "timeout") throw new Error("connection lost after creation");
    return Response.json({ aid: body.aid });
  });
});

test("owner-independent creation persists notes and waits for visual confirmation", async () => {
  const result = await service.startHardwareDecommission(input, actor);
  assert.equal(result.status, "AWAITING_CONFIRMATION");
  assert.equal(record().actorEmployeeId, actor.actorEmployeeId);
  assert.equal(createdAsset?.notes, record().assetNotes);
  assert.match(String(record().assetNotes), /IT Reviewer \(IT123; it@example.test\)/);
  assert.match(String(record().assetNotes), /This device has not been online in over 1 year/);
  assert.equal(audits[0].status, "SUCCEEDED");
  assert.equal(ninjaWrites, 0);
  assert.equal(localDeletes, 0);
  await service.startHardwareDecommission(input, actor);
  assert.equal(reftabWrites, 1, "duplicate requests resume the saved review");
});

test("concurrent creates reserve the same device only once", async () => {
  const results = await Promise.allSettled([service.startHardwareDecommission(input, actor), service.startHardwareDecommission(input, actor)]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  assert.equal(reftabWrites, 1);
});

test("stale cache cannot allow a recently active device to be decommissioned", async () => {
  live.lastContact = Date.now() / 1000;
  await assert.rejects(service.startHardwareDecommission(input, actor), /within the last year/);
  assert.equal(saved, null);
  assert.equal(reftabWrites, 0);
});

test("no external action occurs if the audit insert fails", async () => {
  failAuditStart = true;
  await assert.rejects(service.startHardwareDecommission(input, actor), /audit unavailable/);
  assert.equal(record().status, "FAILED");
  assert.equal(reftabWrites, 0);
});

test("known creation rejection can be retried without losing the saved actor", async () => {
  reftabOutcome = "rejected";
  await assert.rejects(service.startHardwareDecommission(input, actor), /Validation failed/);
  assert.equal(record().status, "FAILED");
  reftabOutcome = "success";
  await service.startHardwareDecommission(input, actor);
  assert.equal(record().status, "AWAITING_CONFIRMATION");
});

for (const outcome of ["timeout", "bad notes", "local save failure"] as const) {
  test(`a ${outcome} during Reftab creation requires review and does not recreate the asset`, async () => {
    if (outcome === "local save failure") failLocalSave = true;
    else reftabOutcome = outcome;
    await assert.rejects(service.startHardwareDecommission(input, actor));
    assert.equal(record().status, "REVIEW_REQUIRED");
    assert.equal(audits[0].status, "REVIEW_REQUIRED");
    await service.startHardwareDecommission(input, actor);
    assert.equal(reftabWrites, 1);
    failLocalSave = false;
    if (outcome === "bad notes") {
      await assert.rejects(service.verifyHardwareDecommission(id(), actor), /complete app-generated Asset Notes/);
      createdAsset!.notes = record().assetNotes;
    }
    await service.verifyHardwareDecommission(id(), actor);
    assert.equal(record().status, "AWAITING_CONFIRMATION");
    assert.equal(ninjaWrites, 0);
  });
}

test("visual confirmation and verified Reftab notes are both mandatory before removal", async () => {
  await service.startHardwareDecommission(input, actor);
  await assert.rejects(service.confirmHardwareDecommission({ id: id(), choice: "remove", confirmedInReftab: false }, actor), /Visually confirm/);
  createdAsset!.notes = "modified";
  await assert.rejects(service.confirmHardwareDecommission({ id: id(), choice: "remove", confirmedInReftab: true }, actor), /complete app-generated Asset Notes/);
  assert.equal(ninjaWrites, 0);
});

test("keep confirms the actor without touching NinjaOne and can be reopened for later removal", async () => {
  await service.startHardwareDecommission(input, actor);
  await service.confirmHardwareDecommission({ id: id(), choice: "keep", confirmedInReftab: true }, actor);
  assert.equal(record().status, "KEPT");
  assert.equal(record().confirmedByEmployeeId, actor.actorEmployeeId);
  assert.equal(ninjaWrites, 0);
  await service.confirmHardwareDecommission({ id: id(), choice: "remove", confirmedInReftab: true }, actor);
  assert.equal(record().status, "NINJA_DECOMMISSIONED");
  assert.equal(ninjaWrites, 1);
  assert.equal(localDeletes, 1);
});

for (const change of ["recent activity", "online", "different uid", "missing uid"] as const) {
  test(`${change} discovered at confirmation prevents NinjaOne removal`, async () => {
    await service.startHardwareDecommission(input, actor);
    if (change === "recent activity") live.lastContact = Date.now() / 1000;
    if (change === "online") live.offline = false;
    if (change === "different uid") live.uid = "replacement";
    if (change === "missing uid") live.uid = null;
    await assert.rejects(service.confirmHardwareDecommission({ id: id(), choice: "remove", confirmedInReftab: true }, actor));
    assert.equal(record().status, "AWAITING_CONFIRMATION");
    assert.equal(ninjaWrites, 0);
    assert.equal(localDeletes, 0);
  });
}

test("simultaneous removal confirmations produce one audited NinjaOne POST", async () => {
  await service.startHardwareDecommission(input, actor);
  const confirmation = { id: id(), choice: "remove" as const, confirmedInReftab: true };
  await Promise.allSettled([service.confirmHardwareDecommission(confirmation, actor), service.confirmHardwareDecommission(confirmation, actor)]);
  assert.equal(ninjaWrites, 1);
  assert.equal(record().status, "NINJA_DECOMMISSIONED");
});

for (const outcome of ["rejected", "timeout", "server error"] as const) {
  test(`NinjaOne ${outcome} preserves the correct review state`, async () => {
    await service.startHardwareDecommission(input, actor);
    ninjaOutcome = outcome;
    const confirmation = { id: id(), choice: "remove" as const, confirmedInReftab: true };
    await assert.rejects(service.confirmHardwareDecommission(confirmation, actor));
    assert.equal(localDeletes, 0);
    assert.equal(record().status, outcome === "rejected" ? "AWAITING_CONFIRMATION" : "REMOVE_REVIEW_REQUIRED");
    if (outcome !== "rejected") {
      await assert.rejects(service.confirmHardwareDecommission(confirmation, actor), /not ready/);
      await assert.rejects(service.verifyHardwareDecommission(id(), actor), /has not confirmed/);
      live.approvalStatus = "DECOMMISSIONED";
      await service.verifyHardwareDecommission(id(), actor);
      assert.equal(record().status, "NINJA_DECOMMISSIONED");
      assert.equal(localDeletes, 1);
      assert.equal(ninjaWrites, 1, "status recovery must never repeat a removal");
    }
  });
}
