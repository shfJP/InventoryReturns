import assert from "node:assert/strict";
import { after, before, test } from "node:test";

let syncNinjaOneToDb: typeof import("./ninjaone").syncNinjaOneToDb;
const globals = globalThis as unknown as { prisma?: unknown };
const original = globals.prisma;
const devices = new Map<string, Record<string, unknown>>();
const observations = new Map<string, Record<string, unknown>>();
const deviceModel = {
  upsert: async ({ where, update, create }: { where: { id: string }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
    const definedUpdate = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
    const record = devices.has(where.id) ? { ...devices.get(where.id), ...definedUpdate } : create;
    devices.set(where.id, record);
    return record;
  },
  updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const record = devices.get(where.id)!;
    if (record.loginHistoryStartedAt == null) Object.assign(record, data);
  },
  findMany: async () => [...devices.keys()].map((id) => ({ id })),
  deleteMany: async () => ({ count: 0 }),
};
const observationModel = {
  createMany: async ({ data, skipDuplicates }: { data: Record<string, unknown>[]; skipDuplicates: boolean }) => {
    assert.equal(skipDuplicates, true);
    for (const record of data) {
      const key = `${record.deviceId}:${record.username}:${String(record.loggedOnAt)}`;
      if (!observations.has(key)) observations.set(key, record);
    }
  },
  deleteMany: async () => ({ count: 0 }),
};
before(async () => {
  const tx = { ninjaOneDevice: deviceModel, ninjaOneLoginObservation: observationModel };
  globals.prisma = { ...tx, $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(tx) };
  process.env.NINJAONE_BASE_URL = "https://ninjaone.test";
  process.env.NINJAONE_CLIENT_ID = "test";
  process.env.NINJAONE_CLIENT_SECRET = "test";
  process.env.NINJAONE_SCOPE = "monitoring";
  process.env.NINJAONE_ENRICH_DEVICE_DETAILS = "true";
  ({ syncNinjaOneToDb } = await import("./ninjaone"));
});
after(() => { if (original === undefined) delete globals.prisma; else globals.prisma = original; });

test("sync retains distinct timestamped logins and leaves freshness unchanged on an endpoint failure", async (t) => {
  t.mock.method(console, "info", () => {});
  t.mock.method(console, "warn", () => {});
  let loginTime = Math.floor(Date.now() / 1000) - 3600;
  let unavailable = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://ninjaone.test");
    if (url.pathname === "/ws/oauth/token") return Response.json({ access_token: "test-token" });
    if (url.pathname === "/api/v2/devices") return Response.json([{ id: 123, systemName: "LT550" }]);
    if (url.pathname === "/api/v2/device/123") return Response.json({ id: 123 });
    if (url.pathname === "/api/v2/device/123/custom-fields") return Response.json({});
    assert.equal(url.pathname, "/api/v2/device/123/last-logged-on-user");
    return unavailable ? new Response("Forbidden", { status: 403 }) : Response.json({ userName: "7HILLS\\BDoucette", logonTime: loginTime });
  });
  await syncNinjaOneToDb();
  await syncNinjaOneToDb();
  assert.equal(observations.size, 1);
  const startedAt = devices.get("123")!.loginHistoryStartedAt;
  loginTime += 60;
  await syncNinjaOneToDb();
  assert.equal(observations.size, 2);
  assert.equal(devices.get("123")!.loginHistoryStartedAt, startedAt);
  const checkedAt = devices.get("123")!.loginHistoryCheckedAt;
  unavailable = true;
  await syncNinjaOneToDb();
  assert.equal(devices.get("123")!.loginHistoryCheckedAt, checkedAt);
  assert.equal(observations.size, 2);
});

test("NinjaOne removal without management scope fails before any network request", async (t) => {
  const { decommissionNinjaOneDevice, NinjaOneWriteError, canDecommissionNinjaOne } = await import("./ninjaone");
  t.mock.method(globalThis, "fetch", async () => { assert.fail("must not contact NinjaOne"); });
  assert.equal(canDecommissionNinjaOne(), false);
  await assert.rejects(decommissionNinjaOneDevice("123"), (error) => {
    assert.ok(error instanceof NinjaOneWriteError);
    assert.equal(error.outcome, "rejected");
    assert.match(error.message, /management/);
    return true;
  });
});
