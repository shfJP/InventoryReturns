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
