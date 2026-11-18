import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildReconciliationWorkbook, summarizeReconciliation, type ReportCompletion } from "./reconciliation-report";
import type { ReconciliationReportItem } from "./owner-reconciliation";

const now = new Date("2026-11-18T15:00:00Z");
const items: ReconciliationReportItem[] = [
  { assetTag: "A", serial: "=not-a-formula", title: "Laptop", ninjaDeviceId: "1", status: "Aligned" },
  { assetTag: "B", serial: null, title: null, ninjaDeviceId: "2", status: "Owner mismatch" },
  { assetTag: "C", serial: null, title: null, ninjaDeviceId: null, status: "Missing from Ninja" },
  { assetTag: "D", serial: null, title: null, ninjaDeviceId: "4", status: "Missing from Reftab" },
];
function audit(device: string, date: string, action = "reassign-owner", status = "SUCCEEDED"): ReportCompletion {
  return { assetTag: device, ninjaDeviceId: device, action, status, completedAt: new Date(date), actorName: "IT" };
}
const audits = [
  audit("1", "2026-11-10T15:00:00Z"),
  audit("1", "2026-11-11T15:00:00Z"), // inclusive seven-day boundary, same device
  audit("2", "2026-11-18T15:00:00Z", "add-missing-asset"),
  audit("3", "2026-11-18T15:00:01Z"), // future
  audit("4", "2026-11-17T15:00:00Z", "record-decision"),
  audit("5", "2026-11-17T15:00:00Z", "reassign-owner", "FAILED"),
  audit("6", "2026-11-17T15:00:00Z", "decommission-missing-asset"),
  audit("7", "2026-11-17T15:00:00Z", "decommission-ninja-device"), // secondary action
  { ...audit("8", "2026-11-17T15:00:00Z"), completedAt: null },
  audit("9", "2026-11-11T14:59:59Z"), // just before the weekly boundary
];

test("counts current needs independently of unique successful historical completions", () => {
  const result = summarizeReconciliation(items, audits, now);
  assert.equal(result.outstanding, 3);
  assert.equal(result.aligned, 1);
  assert.equal(result.missingNinja, 1);
  assert.equal(result.missingReftab, 1);
  assert.equal(result.reconciledTotal, 4);
  assert.equal(result.reconciledWeek, 3);
  assert.equal(result.completions.length, 5);
  assert.equal(summarizeReconciliation([], [], now).reconciledWeek, 0);
});

test("builds a readable XLSX with numeric totals, evidence and literal source strings", async () => {
  const bytes = await buildReconciliationWorkbook({
    items, audits, generatedAt: now, reftabSyncedAt: null, ninjaSyncedAt: now,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Summary", "Current inventory", "Completed changes"]);
  assert.equal(workbook.getWorksheet("Summary")!.getCell("B6").value, 3);
  assert.equal(workbook.getWorksheet("Summary")!.getCell("B7").value, 4);
  assert.equal(workbook.getWorksheet("Current inventory")!.getCell("C2").value, "=not-a-formula");
  assert.equal(workbook.getWorksheet("Completed changes")!.rowCount, 6);
});
