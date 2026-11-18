import { parseContactTimestamp } from "./date-time";

export const DECOMMISSION_REASON = "This device has not been online in over 1 year";

export function decommissionEligibility(
  device: { offline: boolean | null | undefined; lastContact: string | null | undefined },
  now = new Date(),
): { eligible: boolean; reason: string; lastContact: Date | null } {
  const lastContact = parseContactTimestamp(device.lastContact);
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  if (device.offline !== true) return { eligible: false, reason: "Device must be confirmed offline in NinjaOne.", lastContact };
  if (!lastContact || lastContact.getTime() <= 0 || lastContact > now) {
    return { eligible: false, reason: "A valid NinjaOne last-contact date is required.", lastContact: null };
  }
  return {
    eligible: lastContact < cutoff,
    reason: lastContact < cutoff ? DECOMMISSION_REASON : "Device has been online within the last year.",
    lastContact,
  };
}

export function decommissionAssetNotes(input: {
  id: string; ninjaDeviceId: string; lastContact: Date; at: Date;
  actorName: string; actorEmployeeId: string; actorEmail: string | null;
}): string {
  return [
    `Decommissioned from Inventory Returns on ${input.at.toISOString()} (UTC) by ${input.actorName} (${input.actorEmployeeId}${input.actorEmail ? `; ${input.actorEmail}` : ""}).`,
    DECOMMISSION_REASON,
    `NinjaOne device: ${input.ninjaDeviceId}. Last online: ${input.lastContact.toISOString()}.`,
    `Decommission reference: ${input.id}`,
  ].join("\n");
}
