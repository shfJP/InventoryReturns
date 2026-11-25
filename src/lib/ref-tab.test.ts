import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ReftabWriteError } from "./reftab-write-error";

let createAndAssignReftabAsset: typeof import("./ref-tab").createAndAssignReftabAsset;
let reconcileReftabAssetOwner: typeof import("./ref-tab").reconcileReftabAssetOwner;
let createDecommissionedReftabAsset: typeof import("./ref-tab").createDecommissionedReftabAsset;
let fetchReftabCategories: typeof import("./ref-tab").fetchReftabCategories;
const globalForPrisma = globalThis as unknown as { prisma?: unknown };
const originalPrisma = globalForPrisma.prisma;

before(async () => {
  globalForPrisma.prisma = { equipmentAssignment: { findMany: async () => [] } };
  process.env.REF_TAB_API_URL = "https://reftab.test/api";
  process.env.REF_TAB_API_PUBLIC_KEY = "test-public-key";
  process.env.REF_TAB_API_SECRET_KEY = "test-secret-key";
  process.env.REF_TAB_CREATE_ASSET_ENDPOINT = "assets";
  process.env.REF_TAB_CHECKOUT_ENDPOINT = "loans";
  process.env.REF_TAB_CHECKIN_ENDPOINT_TEMPLATE = "loans/{loanId}/checkin";
  process.env.REF_TAB_CREATE_ASSET_LOCATION_ID = "67497";
  process.env.REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD = "Service Tag";
  process.env.REF_TAB_CREATE_ASSET_EXPRESS_CODE_FIELD = "Express Code";
  ({ createAndAssignReftabAsset, reconcileReftabAssetOwner, createDecommissionedReftabAsset, fetchReftabCategories } = await import("./ref-tab"));
});

after(() => {
  if (originalPrisma === undefined) delete globalForPrisma.prisma;
  else globalForPrisma.prisma = originalPrisma;
});

for (const targetOffset of [0, 100]) {
  test(`House import stops scanning loanees after a usable match at offset ${targetOffset}`, async (t) => {
    t.mock.method(console, "info", () => {});
    const offsets: number[] = [];
    t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === "GET" && url.pathname.startsWith("/api/assets/")) {
        return new Response(null, { status: 404 });
      }
      if (url.pathname === "/api/loanees") {
        const offset = Number(url.searchParams.get("offset"));
        offsets.push(offset);
        assert.ok(offset <= targetOffset, "must not request pages after finding IT Help");
        assert.equal(url.searchParams.get("limit"), "100");
        return Response.json(Array.from({ length: 100 }, (_, i) => ({
          lnid: offset + i + 1,
          email: offset === targetOffset && i === 5 ? "ithelp@sevenhills.org" : `person${offset + i}@example.test`,
        })));
      }
      if (url.pathname === "/api/assets") return Response.json({ aid: "HOUSE-PC" });
      assert.equal(url.pathname, "/api/loans");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.lnid, targetOffset + 6);
      return Response.json({ lid: 789 });
    });
    const result = await createAndAssignReftabAsset({
      assetTag: "HOUSE-PC", categoryId: "456",
      newOwnerEmployeeId: "ithelp", newOwnerEmail: "ithelp@sevenhills.org",
    });
    assert.equal(result.loaneeId, String(targetOffset + 6));
    assert.deepEqual(offsets, targetOffset === 0 ? [0] : [0, 100]);
  });
}

for (const scenario of [
  { name: "serial number", serial: "  5TBF1V3  ", expected: "5TBF1V3", expressCode: "12656608815" },
  { name: "serial number distinct from the asset tag", serial: "SERIAL123", expected: "SERIAL123", expressCode: undefined },
  { name: "missing serial number", serial: undefined, expected: "5TBF1V3", expressCode: "12656608815" },
  { name: "null serial number", serial: null, expected: "5TBF1V3", expressCode: "12656608815" },
  { name: "empty serial number", serial: "", expected: "5TBF1V3", expressCode: "12656608815" },
  { name: "whitespace serial number", serial: "   ", expected: "5TBF1V3", expressCode: "12656608815" },
  { name: "reported laptop FRXN7Y2", serial: "FRXN7Y2", expected: "FRXN7Y2", expressCode: "34340832506", assetTag: "FRXN7Y2" },
  { name: "lowercase service tag", serial: "  frxn7y2  ", expected: "frxn7y2", expressCode: "34340832506" },
  { name: "legacy five-character service tag", serial: "ABC12", expected: "ABC12", expressCode: "17324966" },
  { name: "serial containing punctuation", serial: "FRXN-Y2", expected: "FRXN-Y2", expressCode: undefined },
  { name: "six-character serial", serial: "ABC123", expected: "ABC123", expressCode: undefined },
  { name: "long non-Dell serial", serial: "PF4ABCDE", expected: "PF4ABCDE", expressCode: undefined },
]) {
  test(`creates and assigns an asset (${scenario.name})`, async (t) => {
    t.mock.method(console, "info", () => {});
    const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
    t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      const { pathname, origin } = new URL(url);
      assert.equal(origin, "https://reftab.test");
      if (init?.method === "GET" && pathname.startsWith("/api/assets/")) {
        return new Response(null, { status: 404 });
      }
      if (init?.method === "GET" && pathname === "/api/loanees") {
        return Response.json([{ lnid: 123, email: "owner@example.test" }]);
      }
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push({ path: pathname, body });
      if (pathname === "/api/assets") {
        assert.equal(body.aid, scenario.assetTag ?? "5TBF1V3", "Reftab requires aid for the asset barcode");
        assert.equal(body.id, undefined);
        // Reftab validates category custom fields inside details, keyed by field name.
        assert.deepEqual(body.details, {
          "Service Tag": scenario.expected,
          ...(scenario.expressCode ? { "Express Code": scenario.expressCode } : {}),
        });
        assert.equal(body.fields, undefined);
        assert.equal(body["Service Tag"], undefined);
        assert.equal(body["Express Code"], undefined);
        assert.equal(body.cid, 456);
        assert.equal(body.clid, 67497);
        return Response.json({ aid: scenario.assetTag ?? "5TBF1V3" });
      }
      assert.equal(pathname, "/api/loans");
      assert.deepEqual(body.aids, [scenario.assetTag ?? "5TBF1V3"]);
      assert.equal(body.lnid, 123);
      return Response.json({ lid: 789 });
    });

    const result = await createAndAssignReftabAsset({
      assetTag: scenario.assetTag ?? "5TBF1V3",
      serial: scenario.serial,
      title: scenario.assetTag === "FRXN7Y2" ? "BDOUCETTE-LT550" : "Laptop",
      categoryId: "456",
      newOwnerEmployeeId: "owner",
      newOwnerEmail: "owner@example.test",
    });

    assert.deepEqual(result, { aid: scenario.assetTag ?? "5TBF1V3", loaneeId: "123" });
    assert.deepEqual(writes.map(({ path }) => path), ["/api/assets", "/api/loans"]);
  });
}

for (const category of [{ name: "Laptop", id: "456" }, { name: "Desktop", id: "789" }]) {
  test(`creates the intended asset in the explicitly selected ${category.name} category`, async (t) => {
    t.mock.method(console, "info", () => {});
    const writes: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://reftab.test");
      if (init?.method === "GET" && url.pathname === "/api/assets/FRXN7Y2") {
        return new Response(null, { status: 404 });
      }
      if (init?.method === "GET" && url.pathname === "/api/loanees") {
        return Response.json([{ lnid: 123, email: "owner@example.test" }]);
      }
      assert.equal(init?.method, "POST");
      writes.push(url.pathname);
      const body = JSON.parse(String(init?.body));
      if (url.pathname === "/api/assets") {
        assert.equal(body.aid, "FRXN7Y2");
        assert.equal(body.cid, Number(category.id));
        assert.deepEqual(body.details, { "Service Tag": "FRXN7Y2", "Express Code": "34340832506" });
        return Response.json({ aid: body.aid, cid: body.cid });
      }
      assert.equal(url.pathname, "/api/loans");
      assert.deepEqual(body.aids, ["FRXN7Y2"]);
      return Response.json({ lid: 123 });
    });
    assert.deepEqual(await createAndAssignReftabAsset({
      assetTag: "FRXN7Y2", serial: "FRXN7Y2", title: "Device without category hints", categoryId: category.id,
      newOwnerEmployeeId: "owner", newOwnerEmail: "owner@example.test",
    }), { aid: "FRXN7Y2", loaneeId: "123" });
    assert.deepEqual(writes, ["/api/assets", "/api/loans"]);
  });
}

for (const failure of ["error response", "unreadable response", "empty response", "missing asset ID", "different asset ID"] as const) {
  test(`does not loan an asset after a successful HTTP response with ${failure}`, async (t) => {
    t.mock.method(console, "info", () => {});
    let checkoutCalls = 0;
    t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://reftab.test");
      if (init?.method === "GET" && url.pathname === "/api/assets/FRXN7Y2") {
        return new Response(null, { status: 404 });
      }
      if (init?.method === "GET" && url.pathname === "/api/loanees") {
        return Response.json([{ lnid: 123, email: "owner@example.test" }]);
      }
      assert.equal(init?.method, "POST");
      if (url.pathname === "/api/assets") {
        if (failure === "error response") return Response.json({ error: "Express Code is a required field" });
        if (failure === "unreadable response") return new Response("<html>Gateway error</html>");
        if (failure === "empty response") return new Response(null, { status: 204 });
        return Response.json(failure === "different asset ID" ? { aid: "AUTO123" } : { title: "Laptop" });
      }
      checkoutCalls++;
      return Response.json({ lid: 789 });
    });
    await assert.rejects(createAndAssignReftabAsset({
      assetTag: "FRXN7Y2", categoryId: "456",
      newOwnerEmployeeId: "owner", newOwnerEmail: "owner@example.test",
    }), (error) => {
      assert.ok(error instanceof ReftabWriteError);
      assert.equal(error.outcome, failure === "different asset ID" ? "partial" : "uncertain");
      if (failure === "error response") assert.match(error.message, /Express Code is a required field/);
      return true;
    });
    assert.equal(checkoutCalls, 0);
  });
}

test("reports category lookup failures instead of returning an empty category list", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://reftab.test");
    assert.equal(url.pathname, "/api/categories");
    assert.equal(init?.method, "GET");
    return Response.json({ error: "Category access denied" }, { status: 403 });
  });
  await assert.rejects(fetchReftabCategories(), /403.*Category access denied/);
});

for (const scenario of ["success", "already exists", "forbidden", "no status", "duplicate status", "bad readback", "wrong identity", "timeout"] as const) {
  test(`decommissioned Reftab creation handles ${scenario}`, async (t) => {
    t.mock.method(console, "info", () => {});
    let created = false;
    let writes = 0;
    const notes = "Decommissioned by IT\nThis device has not been online in over 1 year";
    t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://reftab.test");
      if (url.pathname === "/api/status") {
        assert.equal(init?.method, "GET");
        const status = { statid: 9, name: "Decommissioned" };
        return Response.json({ statuses: scenario === "no status" ? [] : scenario === "duplicate status" ? [status, { ...status, statid: 10 }] : [status] });
      }
      if (url.pathname === "/api/assets/FRXN7Y2") {
        assert.equal(init?.method, "GET");
        if (scenario === "forbidden") return new Response("Forbidden", { status: 403 });
        if (!created && scenario !== "already exists") return new Response("", { status: 404 });
        return Response.json({
          aid: scenario === "wrong identity" ? "OTHER" : "FRXN7Y2",
          status: { name: scenario === "bad readback" ? "Available" : "Decommissioned" }, notes,
        });
      }
      assert.equal(url.pathname, "/api/assets");
      assert.equal(init?.method, "POST");
      writes++;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        aid: "FRXN7Y2", title: "BDOUCETTE-LT550", cid: 456, statid: 9, notes, clid: 67497,
        details: { "Service Tag": "FRXN7Y2", "Express Code": "34340832506" },
      });
      if (scenario === "timeout") throw new Error("connection lost");
      created = true;
      return Response.json({ aid: "FRXN7Y2" });
    });
    const promise = createDecommissionedReftabAsset({ assetTag: "FRXN7Y2", serial: "FRXN7Y2", title: "BDOUCETTE-LT550", categoryId: "456", note: notes });
    if (scenario === "success") {
      assert.deepEqual(await promise, { aid: "FRXN7Y2", statusName: "Decommissioned", notes, url: "https://www.reftab.com/assets/FRXN7Y2" });
    } else {
      await assert.rejects(promise, (error) => {
        assert.ok(error instanceof Error);
        if (["bad readback", "wrong identity", "timeout"].includes(scenario)) {
          assert.ok(error instanceof ReftabWriteError);
          assert.equal(error.outcome, scenario === "timeout" ? "uncertain" : "partial");
        }
        return true;
      });
    }
    assert.equal(writes, ["success", "bad readback", "wrong identity", "timeout"].includes(scenario) ? 1 : 0);
  });
}

for (const failure of ["validation", "checkout", "timeout"] as const) {
  test(`preserves the outcome when asset creation encounters ${failure}`, async (t) => {
    t.mock.method(console, "info", () => {});
    t.mock.method(console, "error", () => {});
    let checkoutCalls = 0;
    t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://reftab.test");
      if (init?.method === "GET" && url.pathname === "/api/assets/FRXN7Y2") {
        return new Response(null, { status: 404 });
      }
      if (init?.method === "GET" && url.pathname === "/api/loanees") {
        return Response.json([{ lnid: 123, email: "owner@example.test" }]);
      }
      assert.equal(init?.method, "POST");
      if (url.pathname === "/api/assets") {
        if (failure === "timeout") throw new Error("network timeout");
        if (failure === "validation") return Response.json({ error: "Express Code is a required field" }, { status: 400 });
        return Response.json({ aid: "FRXN7Y2" });
      }
      assert.equal(url.pathname, "/api/loans");
      checkoutCalls++;
      return Response.json({ error: "Checkout rejected" }, { status: 400 });
    });
    await assert.rejects(createAndAssignReftabAsset({
      assetTag: "FRXN7Y2", serial: "FRXN7Y2", categoryId: "456",
      newOwnerEmployeeId: "owner", newOwnerEmail: "owner@example.test",
    }), (error) => {
      assert.ok(error instanceof ReftabWriteError);
      assert.equal(error.outcome, failure === "validation" ? "rejected" : failure === "checkout" ? "partial" : "uncertain");
      return true;
    });
    assert.equal(checkoutCalls, failure === "checkout" ? 1 : 0);
  });
}

for (const scenario of ["success", "checkin rejected", "checkout rejected"] as const) {
  test(`owner reassignment handles ${scenario} without hiding a completed check-in`, async (t) => {
    t.mock.method(console, "info", () => {});
    t.mock.method(console, "error", () => {});
    const writes: string[] = [];
    let loaneeReads = 0;
    t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://reftab.test");
      if (init?.method === "GET" && url.pathname === "/api/loanees") {
        loaneeReads++;
        return Response.json([{ lnid: 123, email: "owner@example.test" }]);
      }
      if (init?.method === "GET" && url.pathname === "/api/loans") {
        assert.equal(url.searchParams.get("status"), "out");
        return Response.json([{ lid: 789, lnid: 999, aids: ["FRXN7Y2"], status: "out" }]);
      }
      assert.equal(init?.method, "POST");
      writes.push(url.pathname);
      assert.deepEqual(JSON.parse(String(init?.body)).aids, ["FRXN7Y2"]);
      if (url.pathname === "/api/loans/789/checkin") {
        return scenario === "checkin rejected"
          ? Response.json({ error: "Check-in rejected" }, { status: 400 })
          : Response.json({});
      }
      assert.equal(url.pathname, "/api/loans");
      return scenario === "checkout rejected"
        ? Response.json({ error: "Checkout rejected" }, { status: 400 })
        : Response.json({ lid: 790 });
    });
    const change = reconcileReftabAssetOwner({
      assetTag: "FRXN7Y2", newOwnerEmployeeId: "owner", newOwnerEmail: "owner@example.test",
    });
    if (scenario === "success") {
      assert.deepEqual(await change, { loanId: "789", loaneeId: "123" });
    } else {
      await assert.rejects(change, (error) => {
        assert.ok(error instanceof ReftabWriteError);
        assert.equal(error.outcome, scenario === "checkin rejected" ? "rejected" : "partial");
        if (scenario === "checkout rejected") assert.match(error.message, /checked in, but checkout failed/);
        return true;
      });
    }
    assert.deepEqual(writes, scenario === "checkin rejected"
      ? ["/api/loans/789/checkin"] : ["/api/loans/789/checkin", "/api/loans"]);
    assert.equal(loaneeReads, 1, "only look up the new owner; loan lookup must not scan loanees");
  });
}

test("missing category fails before loanee lookup or asset creation", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    assert.equal(new URL(input).pathname, "/api/categories");
    assert.equal(init?.method, "GET");
    return Response.json([]);
  });
  await assert.rejects(createAndAssignReftabAsset({
    assetTag: "UNKNOWN", title: "Unknown device", newOwnerEmployeeId: "owner", newOwnerEmail: "owner@example.test",
  }), /Select a category.*No asset was created/);
});
