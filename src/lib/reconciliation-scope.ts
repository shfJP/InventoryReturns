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
// need both queues. Partition only at the presentation boundary.
export function scopeReconciliation(result: OwnerReconciliationResult, automated: boolean) {
  const rows = result.rows.filter((row) => Boolean(automaticOwnerPolicy(row)) === automated);
  const missingReftabRows = result.missingReftabRows.filter((row) => Boolean(automaticImportPolicy(row)) === automated);
  const automaticIds = new Set([
    ...result.rows.filter(automaticOwnerPolicy),
    ...result.missingReftabRows.filter(automaticImportPolicy),
  ].map((row) => row.ninjaDevice.id));
  const reportItems = result.reportItems.filter((item) => automaticIds.has(item.ninjaDeviceId ?? "") === automated);
  return {
    ...result, rows, missingReftabRows, reportItems,
    summary: {
      ...result.summary,
      mismatchCount: rows.length,
      missingReftabCount: missingReftabRows.length,
    },
  };
}
