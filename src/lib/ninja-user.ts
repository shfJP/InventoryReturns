type NinjaDeviceNames = {
  displayName?: string | null;
  systemName?: string | null;
  dnsName?: string | null;
  netbiosName?: string | null;
};

function normalizeComputerName(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

export function isDeviceLocalWindowsAccount(
  value: string | null | undefined,
  device: NinjaDeviceNames,
): boolean {
  // MACHINE\user and .\user are local Windows identities, not directory
  // aliases that can safely be matched to the local part of an email address.
  const qualifiedUser = value?.trim();
  const separator = qualifiedUser?.indexOf("\\") ?? -1;
  if (!qualifiedUser || separator <= 0) return false;

  const qualifier = qualifiedUser.slice(0, separator).trim();
  if (qualifier === "." || qualifier.toLowerCase() === "localhost") return true;

  const normalizedQualifier = normalizeComputerName(qualifier);
  if (!normalizedQualifier) return false;

  return [
    device.displayName,
    device.systemName,
    device.dnsName,
    device.netbiosName,
  ].some((name) => {
    const normalizedName = normalizeComputerName(name);
    const normalizedHost = normalizeComputerName(name?.split(".")[0]);
    return normalizedQualifier === normalizedName || normalizedQualifier === normalizedHost;
  });
}
