import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeReconciliation } from "./reconciliation-scope";
import type { OwnerReconciliationResult, OwnerReconciliationRow, MissingReftabAssetRow } from "./owner-reconciliation";

function owner(id: string, name: string, raw: string) {
  return { id, assetTag: id, ninjaOwnerRaw: raw,
    ninjaDevice: { id, systemName: name, netbiosName: null, dnsName: null } } as OwnerReconciliationRow;
}
function missing(id: string, name: string, raw: string) {
  return owner(id, name, raw) as unknown as MissingReftabAssetRow;
}

test("manual and automation queues partition eligible policies without losing ordinary laptop imports", () => {
  const result: OwnerReconciliationResult = {
    rows: [owner("house", "SH-PC", "7HILLS\\House"), owner("lt", "SH-Lt", "alice"), owner("manual", "SH-PC", "bob")],
    missingReftabRows: [missing("house-import", "SH-PC", "7HILLS\\House"), missing("lt-import", "SH-LT", "alice")],
    reportItems: ["house", "lt", "manual", "house-import", "lt-import"].map((id) => ({
      assetTag: id, ninjaDeviceId: id, status: "Owner mismatch", serial: null, title: null,
    })),
    summary: { equipmentCount: 3, ninjaDeviceCount: 5, matchedDeviceCount: 3, missingReftabCount: 2,
      mismatchCount: 3, missingNinjaOwnerCount: 0, unresolvedNinjaOwnerCount: 0, inactiveNinjaOwnerCount: 0, alreadyMatchedOwnerCount: 0 },
  };
  const manual = scopeReconciliation(result, false);
  const automated = scopeReconciliation(result, true);
  assert.deepEqual(manual.rows.map((row) => row.id), ["manual"]);
  assert.deepEqual(manual.missingReftabRows.map((row) => row.id), ["lt-import"]);
  assert.equal(manual.summary.mismatchCount, 1);
  assert.equal(manual.summary.missingReftabCount, 1);
  assert.deepEqual(automated.rows.map((row) => row.id), ["house", "lt"]);
  assert.equal(automated.summary.missingReftabCount, 1);
  assert.equal(manual.reportItems.length + automated.reportItems.length, result.reportItems.length);
  assert.equal(result.rows.length, 3, "full inventory remains available for exports and write validation");
});

test("a House laptop uses the IT Help policy before the laptop owner policy", () => {
  const result = { rows: [owner("house-lt", "SH-LT", "7HILLS\\House")],
    missingReftabRows: [], reportItems: [], summary: {} } as unknown as OwnerReconciliationResult;
  assert.equal(scopeReconciliation(result, true).rows.length, 1);
  assert.equal(scopeReconciliation(result, false).rows.length, 0);
});

test("no owner signal has its own queue and does not count as missing Reftab in manual review", () => {
  const missingSignal = { ...missing("no-signal-import", "PC", ""), ownerStatus: "missing" as const };
  const unresolved = { ...missing("unresolved-import", "PC", "unknown"), ownerStatus: "unresolved" as const };
  const inactive = { ...missing("inactive-import", "PC", "former"), ownerStatus: "inactive" as const };
  const result = {
    rows: [owner("manual", "PC", "bob"), owner("auto", "PC-LT", "alice")],
    missingReftabRows: [missingSignal, unresolved, inactive],
    reportItems: [
      { assetTag: "matched-no-signal", ninjaDeviceId: "matched-no-signal", status: "No owner signal" },
      { assetTag: "no-signal-import", ninjaDeviceId: "no-signal-import", status: "Missing from Reftab" },
      { assetTag: "unresolved-import", ninjaDeviceId: "unresolved-import", status: "Missing from Reftab" },
      { assetTag: "inactive-import", ninjaDeviceId: "inactive-import", status: "Missing from Reftab" },
      { assetTag: "manual", ninjaDeviceId: "manual", status: "Owner mismatch" },
      { assetTag: "auto", ninjaDeviceId: "auto", status: "Owner mismatch" },
      { assetTag: "not-in-ninja", ninjaDeviceId: null, status: "Missing from Ninja" },
    ],
    summary: { missingNinjaOwnerCount: 2, missingReftabCount: 3, mismatchCount: 2 },
  } as OwnerReconciliationResult;
  const manual = scopeReconciliation(result, false);
  const automated = scopeReconciliation(result, true);
  const noSignal = scopeReconciliation(result, "no-owner-signal");
  assert.deepEqual(manual.missingReftabRows.map((row) => row.id), ["unresolved-import", "inactive-import"]);
  assert.equal(manual.summary.missingReftabCount, 2);
  assert.equal(manual.summary.missingNinjaOwnerCount, 0);
  assert.equal(automated.summary.missingNinjaOwnerCount, 0);
  assert.deepEqual(noSignal.reportItems.map((row) => row.ninjaDeviceId), ["matched-no-signal", "no-signal-import"]);
  assert.equal(noSignal.summary.missingNinjaOwnerCount, 2);
  assert.equal(noSignal.summary.missingReftabCount, 1);
  assert.equal(noSignal.rows.length, 0);
  assert.equal(manual.reportItems.length + automated.reportItems.length + noSignal.reportItems.length, result.reportItems.length);
  assert.equal(result.summary.missingReftabCount, 3, "full inventory totals remain intact for export");
});
