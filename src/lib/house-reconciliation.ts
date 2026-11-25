import { reconcileAutomaticOwners, reconcileAutomaticOwnersAfterSync } from "./automatic-owner-reconciliation";

// Keep House-only entry points for callers that explicitly request that policy.
export async function reconcileHouseDevices() {
  return reconcileAutomaticOwners(false);
}

export async function reconcileHouseDevicesAfterSync() {
  return reconcileAutomaticOwnersAfterSync(false);
}
