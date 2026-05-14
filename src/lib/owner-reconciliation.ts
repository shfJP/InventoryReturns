import type { EquipmentAssignment, NinjaOneDevice, User } from "@prisma/client";
import { prisma } from "./db";

type EquipmentWithUser = EquipmentAssignment & {
  user: Pick<User, "employeeId" | "displayName" | "email" | "upn" | "isActive"> | null;
};

type UserSummary = {
  employeeId: string;
  displayName: string;
  email: string;
  upn: string | null;
  isActive: boolean;
};

type NinjaMatch = {
  device: NinjaOneDevice;
  score: number;
  matchReason: string;
};

type NinjaIdentity = {
  assetTag: string;
  serial: string | null;
  model: string | null;
  title: string | null;
};

type NinjaDeviceView = {
  id: string;
  displayName: string | null;
  systemName: string | null;
  dnsName: string | null;
  netbiosName: string | null;
  offline: boolean | null;
  lastContact: string | null;
  lastUpdate: string | null;
};

export type OwnerReconciliationRow = {
  id: string;
  assetTag: string;
  aid: string | null;
  serial: string | null;
  model: string | null;
  title: string | null;
  category: string | null;
  reftabOwner: UserSummary | null;
  reftabOwnerEmployeeId: string;
  ninjaOwner: UserSummary;
  ninjaOwnerRaw: string;
  ninjaDevice: NinjaDeviceView;
  matchReason: string;
  confidence: number;
};

export type MissingReftabAssetRow = {
  id: string;
  assetTag: string;
  serial: string | null;
  model: string | null;
  title: string | null;
  ninjaOwner: UserSummary;
  ninjaOwnerRaw: string;
  ninjaDevice: NinjaDeviceView;
  identityReason: string;
};

export type OwnerReconciliationSummary = {
  equipmentCount: number;
  ninjaDeviceCount: number;
  matchedDeviceCount: number;
  missingReftabCount: number;
  missingNinjaOwnerCount: number;
  unresolvedNinjaOwnerCount: number;
  inactiveNinjaOwnerCount: number;
  alreadyMatchedOwnerCount: number;
  mismatchCount: number;
};

export type OwnerReconciliationResult = {
  rows: OwnerReconciliationRow[];
  missingReftabRows: MissingReftabAssetRow[];
  summary: OwnerReconciliationSummary;
};

function normalizeText(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function normalizeAlias(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  const withoutDomain = text.includes("\\") ? text.split("\\").pop() ?? text : text;
  return withoutDomain || null;
}

function aliasLocalPart(value: string | null | undefined): string | null {
  const alias = normalizeAlias(value);
  if (!alias || !alias.includes("@")) return null;
  return alias.split("@")[0] || null;
}

function addAlias(map: Map<string, UserSummary>, value: string | null | undefined, user: UserSummary): void {
  const alias = normalizeAlias(value);
  if (!alias) return;
  const existing = map.get(alias);
  if (!existing || (!existing.isActive && user.isActive)) map.set(alias, user);

  const localPart = aliasLocalPart(alias);
  if (localPart) {
    const localExisting = map.get(localPart);
    if (!localExisting || (!localExisting.isActive && user.isActive)) map.set(localPart, user);
  }

  const compact = normalizeText(alias);
  if (compact) {
    const compactExisting = map.get(compact);
    if (!compactExisting || (!compactExisting.isActive && user.isActive)) map.set(compact, user);
  }
}

function buildUserAliasMap(users: UserSummary[]): Map<string, UserSummary> {
  const aliases = new Map<string, UserSummary>();
  for (const user of users) {
    addAlias(aliases, user.employeeId, user);
    addAlias(aliases, user.email, user);
    addAlias(aliases, user.upn, user);
    addAlias(aliases, user.displayName, user);
  }
  return aliases;
}

function resolveLikelyUser(rawLikelyUser: string | null, aliases: Map<string, UserSummary>): UserSummary | null {
  const direct = normalizeAlias(rawLikelyUser);
  if (!direct) return null;
  return aliases.get(direct) ?? aliases.get(aliasLocalPart(direct) ?? "") ?? aliases.get(normalizeText(direct)) ?? null;
}

function deviceSearchText(device: NinjaOneDevice): string {
  return [
    device.displayName,
    device.systemName,
    device.dnsName,
    device.netbiosName,
    device.detailsJson,
  ].map(normalizeText).join(" ");
}

function findBestNinjaMatch(item: EquipmentWithUser, devices: NinjaOneDevice[]): NinjaMatch | null {
  const candidates = [
    { label: "asset tag", value: item.assetTag, score: 100 },
    { label: "serial", value: item.serial, score: 90 },
    { label: "model/title", value: item.model ?? item.title, score: 30 },
  ]
    .map((candidate) => ({ ...candidate, normalized: normalizeText(candidate.value) }))
    .filter((candidate) => candidate.normalized.length >= 3);

  if (candidates.length === 0) return null;

  return devices
    .map((device) => {
      const haystack = deviceSearchText(device);
      const matches = candidates.filter((candidate) => haystack.includes(candidate.normalized));
      if (matches.length === 0) return null;
      return {
        device,
        score: matches.reduce((sum, match) => sum + match.score, 0),
        matchReason: matches.map((match) => match.label).join(", "),
      };
    })
    .filter((match): match is NinjaMatch => Boolean(match))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function equipmentSearchText(item: EquipmentWithUser): string {
  return [
    item.assetTag,
    item.aid,
    item.serial,
    item.model,
    item.title,
    item.detailsJson,
  ].map(normalizeText).join(" ");
}

function hasReftabMatchForDevice(identity: NinjaIdentity, equipment: EquipmentWithUser[]): boolean {
  const candidates = [
    identity.assetTag,
    identity.serial,
    identity.title,
  ]
    .map(normalizeText)
    .filter((value) => value.length >= 3);
  if (candidates.length === 0) return false;

  return equipment.some((item) => {
    const haystack = equipmentSearchText(item);
    return candidates.some((candidate) => haystack.includes(candidate));
  });
}

function parseDetailsJson(device: NinjaOneDevice): Record<string, unknown> {
  if (!device.detailsJson) return {};
  try {
    const parsed = JSON.parse(device.detailsJson);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function valueToString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["email", "mail", "userPrincipalName", "upn", "displayName", "name", "username", "userName", "id"]) {
      const nested = valueToString(record[key]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function getNested(obj: unknown, path: string): unknown {
  if (obj == null || typeof obj !== "object") return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function firstString(record: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = valueToString(getNested(record, path));
    if (value) return value;
  }
  return undefined;
}

function likelyOwnerFromDevice(device: NinjaOneDevice): string | null {
  if (device.likelyUser) return device.likelyUser;
  const details = parseDetailsJson(device);
  const direct = firstString(details, [
    "owner",
    "ownerName",
    "ownerUser",
    "ownerUsername",
    "ownerEmail",
    "assignedTo",
    "assignedUser",
    "assignedUserName",
    "assignedUsername",
    "assignedUserEmail",
    "assignedToUser",
    "assignedToUserName",
    "assignedToEmail",
    "primaryUser",
    "primaryUsername",
    "primaryUserEmail",
    "lastLoggedInUser",
    "lastLoggedInUsername",
    "loggedInUser",
    "loggedInUsername",
    "currentUser",
    "lastUser",
    "user",
    "userName",
    "username",
    "userData.owner",
    "userData.ownerEmail",
    "userData.assignedTo",
    "userData.assignedUser",
    "userData.primaryUser",
    "userData.lastLoggedInUser",
    "fields.owner",
    "fields.ownerEmail",
    "fields.assignedTo",
    "fields.assignedUser",
    "fields.primaryUser",
    "fields.lastLoggedInUser",
    "references.owner",
    "references.assignedUser",
    "references.primaryUser",
    "references.lastLoggedInUser",
  ]);
  if (direct) return direct;

  for (const sectionName of ["userData", "fields", "references"]) {
    const section = details[sectionName];
    if (section == null || typeof section !== "object") continue;
    for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.includes("owner") ||
        normalizedKey.includes("assign") ||
        normalizedKey.includes("primary") ||
        normalizedKey.includes("user") ||
        normalizedKey.includes("login")
      ) {
        const text = valueToString(value);
        if (text) return text;
      }
    }
  }

  return null;
}

function deviceView(device: NinjaOneDevice): NinjaDeviceView {
  return {
    id: device.id,
    displayName: device.displayName,
    systemName: device.systemName,
    dnsName: device.dnsName,
    netbiosName: device.netbiosName,
    offline: device.offline,
    lastContact: device.lastContact,
    lastUpdate: device.lastUpdate,
  };
}

function ninjaIdentityFromDevice(device: NinjaOneDevice): NinjaIdentity {
  const details = parseDetailsJson(device);
  const serial = firstString(details, [
    "serial",
    "serialNumber",
    "serial_number",
    "biosSerialNumber",
    "system.serialNumber",
    "hardware.serialNumber",
    "fields.serial",
    "fields.serialNumber",
  ]);
  const model = firstString(details, [
    "model",
    "deviceModel",
    "system.model",
    "hardware.model",
    "fields.model",
  ]);
  const title = device.displayName ?? device.systemName ?? device.dnsName ?? device.netbiosName ?? model ?? serial ?? device.id;
  return {
    assetTag: serial ?? device.systemName ?? device.displayName ?? device.id,
    serial: serial ?? null,
    model: model ?? null,
    title,
  };
}

function identityReason(identity: NinjaIdentity): string {
  if (identity.serial) return "serial";
  if (identity.assetTag === identity.title) return "device name";
  return "device id";
}

function summarizeUser(user: Pick<User, "employeeId" | "displayName" | "email" | "upn" | "isActive">): UserSummary {
  return {
    employeeId: user.employeeId,
    displayName: user.displayName,
    email: user.email,
    upn: user.upn,
    isActive: user.isActive,
  };
}

function toRow(item: EquipmentWithUser, match: NinjaMatch, ninjaOwner: UserSummary, ninjaOwnerRaw: string): OwnerReconciliationRow {
  return {
    id: `${item.assetTag}:${match.device.id}`,
    assetTag: item.assetTag,
    aid: item.aid,
    serial: item.serial,
    model: item.model,
    title: item.title,
    category: item.catName,
    reftabOwner: item.user ? summarizeUser(item.user) : null,
    reftabOwnerEmployeeId: item.assignedToEmployeeId,
    ninjaOwner,
    ninjaOwnerRaw,
    ninjaDevice: deviceView(match.device),
    matchReason: match.matchReason,
    confidence: Math.min(match.score, 100),
  };
}

function toMissingRow(device: NinjaOneDevice, identity: NinjaIdentity, ninjaOwner: UserSummary, ninjaOwnerRaw: string): MissingReftabAssetRow {
  return {
    id: device.id,
    assetTag: identity.assetTag,
    serial: identity.serial,
    model: identity.model,
    title: identity.title,
    ninjaOwner,
    ninjaOwnerRaw,
    ninjaDevice: deviceView(device),
    identityReason: identityReason(identity),
  };
}

export async function getOwnerReconciliationRows(): Promise<OwnerReconciliationRow[]> {
  return (await getOwnerReconciliationResult()).rows;
}

export async function getOwnerReconciliationResult(): Promise<OwnerReconciliationResult> {
  const [equipment, devices, users] = await Promise.all([
    prisma.equipmentAssignment.findMany({
      orderBy: [{ assetTag: "asc" }, { assignedToEmployeeId: "asc" }],
      include: {
        user: {
          select: {
            employeeId: true,
            displayName: true,
            email: true,
            upn: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.ninjaOneDevice.findMany(),
    prisma.user.findMany({
      select: {
        employeeId: true,
        displayName: true,
        email: true,
        upn: true,
        isActive: true,
      },
    }),
  ]);
  const aliases = buildUserAliasMap(users.map(summarizeUser));
  const summary: OwnerReconciliationSummary = {
    equipmentCount: equipment.length,
    ninjaDeviceCount: devices.length,
    matchedDeviceCount: 0,
    missingReftabCount: 0,
    missingNinjaOwnerCount: 0,
    unresolvedNinjaOwnerCount: 0,
    inactiveNinjaOwnerCount: 0,
    alreadyMatchedOwnerCount: 0,
    mismatchCount: 0,
  };
  const rows: OwnerReconciliationRow[] = [];
  const matchedDeviceIds = new Set<string>();

  for (const item of equipment) {
    const match = findBestNinjaMatch(item, devices);
    if (!match) continue;
    matchedDeviceIds.add(match.device.id);
    summary.matchedDeviceCount += 1;

    const ninjaOwnerRaw = likelyOwnerFromDevice(match.device);
    if (!ninjaOwnerRaw) {
      summary.missingNinjaOwnerCount += 1;
      continue;
    }

    const ninjaOwner = resolveLikelyUser(ninjaOwnerRaw, aliases);
    if (!ninjaOwner) {
      summary.unresolvedNinjaOwnerCount += 1;
      continue;
    }
    if (!ninjaOwner.isActive) {
      summary.inactiveNinjaOwnerCount += 1;
      continue;
    }
    if (ninjaOwner.employeeId === item.assignedToEmployeeId) {
      summary.alreadyMatchedOwnerCount += 1;
      continue;
    }
    rows.push(toRow(item, match, ninjaOwner, ninjaOwnerRaw));
  }

  const missingReftabRows: MissingReftabAssetRow[] = [];
  for (const device of devices) {
    if (matchedDeviceIds.has(device.id)) continue;
    const identity = ninjaIdentityFromDevice(device);
    if (hasReftabMatchForDevice(identity, equipment)) continue;

    const ninjaOwnerRaw = likelyOwnerFromDevice(device);
    if (!ninjaOwnerRaw) continue;
    const ninjaOwner = resolveLikelyUser(ninjaOwnerRaw, aliases);
    if (!ninjaOwner?.isActive) continue;
    missingReftabRows.push(toMissingRow(device, identity, ninjaOwner, ninjaOwnerRaw));
  }

  summary.mismatchCount = rows.length;
  summary.missingReftabCount = missingReftabRows.length;
  return { rows, missingReftabRows, summary };
}

export async function getOwnerReconciliationRow(assetTag: string, ninjaDeviceId: string): Promise<OwnerReconciliationRow | null> {
  const rows = await getOwnerReconciliationRows();
  return rows.find((row) => row.assetTag === assetTag && row.ninjaDevice.id === ninjaDeviceId) ?? null;
}

export async function getMissingReftabAssetRow(ninjaDeviceId: string): Promise<MissingReftabAssetRow | null> {
  const result = await getOwnerReconciliationResult();
  return result.missingReftabRows.find((row) => row.ninjaDevice.id === ninjaDeviceId) ?? null;
}
