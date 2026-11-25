import type { OwnerReconciliationResult, OwnerReconciliationRow, MissingReftabAssetRow } from "./owner-reconciliation";
import { isHouseNinjaLogin } from "./missing-reftab-policy";
import { isAutomaticOwnerLaptop } from "./automatic-owner-policy";

export function automaticOwnerPolicy(row: Pick<OwnerReconciliationRow, "ninjaOwnerRaw" | "ninjaDevice">) {
  if (isHouseNinjaLogin(row.ninjaOwnerRaw)) return "House → IT Help";
  if (isAutomaticOwnerLaptop(row.ninjaDevice)) return "-LT → NinjaOne owner";
  return null;
}

export function automaticImportPolicy(row: Pick<MissingReftabAssetRow, "ninjaOwnerRaw">) {
  return isHouseNinjaLogin(row.ninjaOwnerRaw) ? "House → IT Help" : null;
}

// Keep the underlying snapshot complete: write validation and inventory exports
// need every queue. Partition only at the presentation boundary.
export function scopeReconciliation(result: OwnerReconciliationResult, view: boolean | "no-owner-signal") {
  const noOwnerIds = new Set([
    ...result.reportItems.filter((item) => item.status === "No owner signal").map((item) => item.ninjaDeviceId),
    ...result.missingReftabRows.filter((row) => row.ownerStatus === "missing").map((row) => row.ninjaDevice.id),
  ]);
  const automaticIds = new Set([
    ...result.rows.filter(automaticOwnerPolicy),
    ...result.missingReftabRows.filter(automaticImportPolicy),
  ].map((row) => row.ninjaDevice.id));
  const inScope = (id: string | null) => view === "no-owner-signal"
    ? id !== null && noOwnerIds.has(id)
    : !noOwnerIds.has(id) && automaticIds.has(id ?? "") === view;
  const rows = result.rows.filter((row) => inScope(row.ninjaDevice.id));
  const missingReftabRows = result.missingReftabRows.filter((row) => inScope(row.ninjaDevice.id));
  const reportItems = result.reportItems.filter((item) => inScope(item.ninjaDeviceId));
  return {
    ...result, rows, missingReftabRows, reportItems,
    summary: {
      ...result.summary,
      mismatchCount: rows.length,
      missingReftabCount: missingReftabRows.length,
      missingNinjaOwnerCount: view === "no-owner-signal" ? noOwnerIds.size : 0,
    },
  };
}
