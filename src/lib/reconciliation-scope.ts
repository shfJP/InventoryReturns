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

export function excludeReservedReconciliation(result: OwnerReconciliationResult, deviceIds: Set<string>, assetTags = new Set<string>()) {
  const reserved = (id: string | null, tag: string) => Boolean(id && deviceIds.has(id)) || assetTags.has(tag);
  const rows = result.rows.filter((row) => !reserved(row.ninjaDevice.id, row.assetTag));
  const missingReftabRows = result.missingReftabRows.filter((row) => !reserved(row.ninjaDevice.id, row.assetTag));
  const reportItems = result.reportItems.filter((row) => !reserved(row.ninjaDeviceId, row.assetTag));
  const countOwners = (status: MissingReftabAssetRow["ownerStatus"], reportStatus: string) => new Set([
    ...reportItems.filter((item) => item.status === reportStatus).map((item) => item.ninjaDeviceId),
    ...missingReftabRows.filter((row) => row.ownerStatus === status).map((row) => row.ninjaDevice.id),
  ]).size;
  return { ...result, rows, missingReftabRows, reportItems, summary: {
    ...result.summary, mismatchCount: rows.length, missingReftabCount: missingReftabRows.length,
    missingNinjaOwnerCount: countOwners("missing", "No owner signal"),
    unresolvedNinjaOwnerCount: countOwners("unresolved", "Owner not in directory"),
    inactiveNinjaOwnerCount: countOwners("inactive", "Inactive owner"),
  } };
}
