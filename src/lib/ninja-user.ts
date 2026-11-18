type NinjaDeviceNames = {
  displayName?: string | null;
  systemName?: string | null;
  dnsName?: string | null;
  netbiosName?: string | null;
};

export type NinjaDirectoryUser = {
  employeeId: string;
  displayName: string;
  email: string;
  upn: string | null;
  isActive: boolean;
};

function aliasKeys(value: string): string[] {
  const alias = value.trim().toLowerCase().split("\\").pop() ?? "";
  return [...new Set([alias, alias.includes("@") ? alias.split("@")[0] : "", alias.replace(/[^a-z0-9]+/g, "")])].filter(Boolean);
}

export function buildNinjaUserAliases(users: NinjaDirectoryUser[]): Map<string, NinjaDirectoryUser | null> {
  const candidates = new Map<string, Map<string, NinjaDirectoryUser>>();
  for (const user of users) {
    for (const value of [user.employeeId, user.email, user.upn, user.displayName]) {
      for (const key of aliasKeys(value ?? "")) {
        const matches = candidates.get(key) ?? new Map();
        matches.set(user.employeeId, user);
        candidates.set(key, matches);
      }
    }
  }
  return new Map([...candidates].map(([key, matches]) => {
    const active = [...matches.values()].filter((user) => user.isActive);
    const eligible = active.length ? active : [...matches.values()];
    return [key, eligible.length === 1 ? eligible[0] : null];
  }));
}

export function resolveNinjaDirectoryUser(
  value: string | null,
  aliases: Map<string, NinjaDirectoryUser | null>,
  device: NinjaDeviceNames,
): NinjaDirectoryUser | null {
  if (!value || isDeviceLocalWindowsAccount(value, device)) return null;
  for (const key of aliasKeys(value)) {
    // Ambiguous identities stay unresolved rather than counting as owner use.
    if (aliases.has(key)) return aliases.get(key) ?? null;
  }
  return null;
}

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
