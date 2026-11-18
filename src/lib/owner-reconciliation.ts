import type { EquipmentAssignment, NinjaOneDevice, User } from "@prisma/client";
import { prisma } from "./db";
import { buildNinjaUserAliases, resolveNinjaDirectoryUser } from "./ninja-user";
import { buildOwnerLoginEvidence, loginFromSnapshot, LOGIN_WINDOW_DAYS, type OwnerLoginEvidence } from "./ninja-login-evidence";

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

type IndexedNinjaDevice = {
  device: NinjaOneDevice;
  identity: NinjaIdentity;
  ownerRaw: string | null;
};

type NinjaDeviceIndex = {
  devices: IndexedNinjaDevice[];
  byIdentifier: Map<string, IndexedNinjaDevice[]>;
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
  ownerEvidence: OwnerLoginEvidence;
};

export type MissingReftabAssetRow = {
  id: string;
  assetTag: string;
  serial: string | null;
  model: string | null;
  title: string | null;
  ninjaOwner: UserSummary | null;
  ninjaOwnerRaw: string | null;
  ownerStatus: "active" | "missing" | "unresolved" | "inactive";
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
  reportItems: ReconciliationReportItem[];
  summary: OwnerReconciliationSummary;
};

export type ReconciliationReportItem = {
  assetTag: string;
  serial: string | null;
  title: string | null;
  ninjaDeviceId: string | null;
  status: "Aligned" | "Owner mismatch" | "No owner signal" | "Owner not in directory" | "Inactive owner" | "Missing from Ninja" | "Missing from Reftab";
};

function normalizeText(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
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

function addIdentifier(index: Map<string, IndexedNinjaDevice[]>, value: string | null | undefined, device: IndexedNinjaDevice): void {
  const normalized = normalizeText(value);
  if (normalized.length < 3) return;
  const existing = index.get(normalized);
  if (existing) {
    existing.push(device);
  } else {
    index.set(normalized, [device]);
  }
}

function buildNinjaDeviceIndex(devices: NinjaOneDevice[]): NinjaDeviceIndex {
  const indexed = devices.map((device) => ({
    device,
    identity: ninjaIdentityFromDevice(device),
    ownerRaw: likelyOwnerFromDevice(device),
  }));
  const byIdentifier = new Map<string, IndexedNinjaDevice[]>();
  for (const item of indexed) {
    addIdentifier(byIdentifier, item.device.id, item);
    addIdentifier(byIdentifier, item.device.displayName, item);
    addIdentifier(byIdentifier, item.device.systemName, item);
    addIdentifier(byIdentifier, item.device.dnsName, item);
    addIdentifier(byIdentifier, item.device.netbiosName, item);
    addIdentifier(byIdentifier, item.identity.assetTag, item);
    addIdentifier(byIdentifier, item.identity.serial, item);
  }
  return { devices: indexed, byIdentifier };
}

function findBestNinjaMatch(item: EquipmentWithUser, index: NinjaDeviceIndex): NinjaMatch | null {
  const candidates = [
    { label: "asset tag", value: item.assetTag, score: 100, allowFuzzy: true },
    { label: "asset id", value: item.aid, score: 95, allowFuzzy: true },
    { label: "serial", value: item.serial, score: 90, allowFuzzy: true },
    { label: "asset title", value: item.title, score: 85, allowFuzzy: false },
  ]
    .map((candidate) => ({ ...candidate, normalized: normalizeText(candidate.value) }))
    .filter((candidate) => candidate.normalized.length >= 3);

  if (candidates.length === 0) return null;

  const matchesByDevice = new Map<string, NinjaMatch>();
  for (const candidate of candidates) {
    for (const indexedDevice of index.byIdentifier.get(candidate.normalized) ?? []) {
      const existing = matchesByDevice.get(indexedDevice.device.id);
      if (existing) {
        existing.score += candidate.score;
        existing.matchReason = `${existing.matchReason}, ${candidate.label}`;
      } else {
        matchesByDevice.set(indexedDevice.device.id, {
          device: indexedDevice.device,
          score: candidate.score,
          matchReason: candidate.label,
        });
      }
    }
  }

  if (matchesByDevice.size > 0) {
    return Array.from(matchesByDevice.values()).sort((a, b) => b.score - a.score)[0] ?? null;
  }

  return index.devices
    .map(({ device }) => {
      const haystack = deviceSearchText(device);
      const fuzzyMatches = candidates.filter((candidate) => candidate.allowFuzzy && candidate.normalized.length >= 5 && haystack.includes(candidate.normalized));
      if (fuzzyMatches.length === 0) return null;
      return {
        device,
        score: fuzzyMatches.reduce((sum, match) => sum + match.score, 0),
        matchReason: fuzzyMatches.map((match) => match.label).join(", "),
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

function buildEquipmentIdentifierSet(equipment: EquipmentWithUser[]): Set<string> {
  const identifiers = new Set<string>();
  for (const item of equipment) {
    for (const value of [item.assetTag, item.aid, item.serial, item.title]) {
      const normalized = normalizeText(value);
      if (normalized.length >= 3) identifiers.add(normalized);
    }
  }
  return identifiers;
}

function hasReftabMatchForDevice(identity: NinjaIdentity, equipmentIdentifiers: Set<string>, equipment: EquipmentWithUser[]): boolean {
  const candidates = [
    identity.assetTag,
    identity.serial,
    identity.title,
  ]
    .map(normalizeText)
    .filter((value) => value.length >= 3);
  if (candidates.length === 0) return false;

  if (candidates.some((candidate) => equipmentIdentifiers.has(candidate))) return true;

  return equipment.some((item) => {
    const haystack = equipmentSearchText(item);
    return candidates.some((candidate) => candidate.length >= 5 && haystack.includes(candidate));
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

function osSignalFromDevice(device: NinjaOneDevice): string {
  const details = parseDetailsJson(device);
  const values = [
    device.nodeClass,
    firstString(details, [
      "nodeClass",
      "os",
      "osName",
      "osType",
      "operatingSystem",
      "operatingSystemName",
      "platform",
      "system.os",
      "system.osName",
      "system.operatingSystem",
      "hardware.os",
      "hardware.operatingSystem",
      "device.os",
      "device.operatingSystem",
      "fields.os",
      "fields.operatingSystem",
      "customFields.os",
      "customFields.operatingSystem",
    ]),
  ];

  for (const [key, value] of Object.entries(details)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("nodeclass") ||
      normalizedKey === "os" ||
      normalizedKey.includes("osname") ||
      normalizedKey.includes("ostype") ||
      normalizedKey.includes("operatingsystem") ||
      normalizedKey.includes("platform")
    ) {
      values.push(valueToString(value));
    }
  }

  return values.filter(Boolean).join(" ").toLowerCase();
}

function isExcludedNinjaDevice(device: NinjaOneDevice): boolean {
  const signal = osSignalFromDevice(device);
  return signal.includes("windows server") || /\blinux\b/.test(signal);
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
    "customFields.owner",
    "customFields.ownerEmail",
    "customFields.assignedTo",
    "customFields.assignedUser",
    "customFields.primaryUser",
    "references.owner",
    "references.assignedUser",
    "references.primaryUser",
    "references.lastLoggedInUser",
    "lastLoggedOnUser.userName",
    "lastLoggedOnUser.username",
  ]);
  if (direct) return direct;

  for (const sectionName of ["userData", "fields", "references", "customFields"]) {
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
    "itamAssetSerialNumber",
    "assetSerialNumber",
    "customFields.itamAssetSerialNumber",
    "customFields.assetSerialNumber",
    "serial",
    "serialNumber",
    "serial_number",
    "biosSerialNumber",
    "system.serialNumber",
    "hardware.serialNumber",
    "fields.serial",
    "fields.serialNumber",
  ]);
  const assetId = firstString(details, [
    "itamAssetId",
    "itamAssetID",
    "assetId",
    "assetID",
    "customFields.itamAssetId",
    "customFields.itamAssetID",
    "customFields.assetId",
    "customFields.assetID",
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
    assetTag: assetId ?? serial ?? device.systemName ?? device.displayName ?? device.id,
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

function toRow(item: EquipmentWithUser, match: NinjaMatch, ninjaOwner: UserSummary, ninjaOwnerRaw: string, ownerEvidence: OwnerLoginEvidence): OwnerReconciliationRow {
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
    ownerEvidence,
  };
}

function missingOwnerStatus(ownerRaw: string | null, ninjaOwner: UserSummary | null): MissingReftabAssetRow["ownerStatus"] {
  if (!ownerRaw) return "missing";
  if (!ninjaOwner) return "unresolved";
  return ninjaOwner.isActive ? "active" : "inactive";
}

function toMissingRow(device: NinjaOneDevice, identity: NinjaIdentity, ninjaOwner: UserSummary | null, ninjaOwnerRaw: string | null): MissingReftabAssetRow {
  return {
    id: device.id,
    assetTag: identity.assetTag,
    serial: identity.serial,
    model: identity.model,
    title: identity.title,
    ninjaOwner,
    ninjaOwnerRaw,
    ownerStatus: missingOwnerStatus(ninjaOwnerRaw, ninjaOwner),
    ninjaDevice: deviceView(device),
    identityReason: identityReason(identity),
  };
}

export async function getOwnerReconciliationRows(): Promise<OwnerReconciliationRow[]> {
  return (await getOwnerReconciliationResult()).rows;
}

export async function getOwnerReconciliationResult(): Promise<OwnerReconciliationResult> {
  const now = new Date();
  const [equipment, devices, users, decommissions, unresolvedAssets] = await Promise.all([
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
    prisma.ninjaOneDevice.findMany({
      include: { loginObservations: {
        where: { loggedOnAt: { gte: new Date(now.getTime() - LOGIN_WINDOW_DAYS * 86_400_000) } },
        select: { username: true, loggedOnAt: true },
      } },
    }),
    prisma.user.findMany({
      select: {
        employeeId: true,
        displayName: true,
        email: true,
        upn: true,
        isActive: true,
      },
    }),
    prisma.hardwareDecommission.findMany({
      where: { status: { not: "FAILED" } }, select: { ninjaDeviceId: true },
    }),
    prisma.unresolvedCollection.findMany({
      where: { source: "reftab_unmatched_assignee", status: { not: "RESOLVED" } },
      select: { assetTag: true, serial: true },
    }),
  ]);
  const decommissionedIds = new Set(decommissions.map((record) => record.ninjaDeviceId));
  const eligibleDevices = devices.filter((device) => !isExcludedNinjaDevice(device) && !decommissionedIds.has(device.id));
  const aliases = buildNinjaUserAliases(users.map(summarizeUser));
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const ninjaIndex = buildNinjaDeviceIndex(eligibleDevices);
  const equipmentIdentifiers = buildEquipmentIdentifierSet(equipment);
  for (const asset of unresolvedAssets) {
    for (const value of [asset.assetTag, asset.serial]) {
      const normalized = normalizeText(value);
      if (normalized.length >= 3) equipmentIdentifiers.add(normalized);
    }
  }
  const summary: OwnerReconciliationSummary = {
    equipmentCount: equipment.length,
    ninjaDeviceCount: eligibleDevices.length,
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
  const reportItems = new Map<string, ReconciliationReportItem>();

  for (const item of equipment) {
    const match = findBestNinjaMatch(item, ninjaIndex);
    if (!match) {
      reportItems.set(`reftab:${item.assetTag}`, {
        assetTag: item.assetTag, serial: item.serial, title: item.title,
        ninjaDeviceId: null, status: "Missing from Ninja",
      });
      continue;
    }
    matchedDeviceIds.add(match.device.id);
    summary.matchedDeviceCount += 1;

    const ninjaOwnerRaw = ninjaIndex.devices.find((indexed) => indexed.device.id === match.device.id)?.ownerRaw;
    const reportItem: ReconciliationReportItem = {
      assetTag: item.assetTag, serial: item.serial, title: item.title,
      ninjaDeviceId: match.device.id, status: "No owner signal",
    };
    // One physical Ninja device counts once, even with multiple assignment rows.
    const previousReportItem = reportItems.get(`ninja:${match.device.id}`);
    reportItems.set(`ninja:${match.device.id}`, reportItem);
    if (!ninjaOwnerRaw) {
      summary.missingNinjaOwnerCount += 1;
      continue;
    }

    const ninjaOwner = resolveNinjaDirectoryUser(ninjaOwnerRaw, aliases, match.device);
    if (!ninjaOwner) {
      reportItem.status = "Owner not in directory";
      summary.unresolvedNinjaOwnerCount += 1;
      continue;
    }
    if (!ninjaOwner.isActive) {
      reportItem.status = "Inactive owner";
      summary.inactiveNinjaOwnerCount += 1;
      continue;
    }
    if (ninjaOwner.employeeId === item.assignedToEmployeeId) {
      reportItem.status = previousReportItem && previousReportItem.status !== "Aligned" ? previousReportItem.status : "Aligned";
      summary.alreadyMatchedOwnerCount += 1;
      continue;
    }
    reportItem.status = "Owner mismatch";
    const device = devicesById.get(match.device.id)!;
    const snapshot = loginFromSnapshot(parseDetailsJson(device).lastLoggedOnUser, now);
    const evidence = buildOwnerLoginEvidence({
      observations: [...device.loginObservations, ...(snapshot ? [snapshot] : [])],
      proposedOwnerEmployeeId: ninjaOwner.employeeId,
      currentOwnerEmployeeId: item.assignedToEmployeeId,
      resolveUser: (username) => resolveNinjaDirectoryUser(username, aliases, device),
      collectionStartedAt: device.loginHistoryStartedAt ?? (snapshot ? device.lastSyncedAt : null),
      lastCheckedAt: device.loginHistoryCheckedAt ?? (snapshot ? device.lastSyncedAt : null),
      now,
    });
    rows.push(toRow(item, match, ninjaOwner, ninjaOwnerRaw, evidence));
  }

  const missingReftabRows: MissingReftabAssetRow[] = [];
  for (const { device, identity, ownerRaw } of ninjaIndex.devices) {
    if (matchedDeviceIds.has(device.id)) continue;
    if (hasReftabMatchForDevice(identity, equipmentIdentifiers, equipment)) continue;

    const ninjaOwnerRaw = ownerRaw;
    const ninjaOwner = ninjaOwnerRaw ? resolveNinjaDirectoryUser(ninjaOwnerRaw, aliases, device) : null;
    if (!ninjaOwnerRaw) {
      summary.missingNinjaOwnerCount += 1;
    } else if (!ninjaOwner) {
      summary.unresolvedNinjaOwnerCount += 1;
    } else if (!ninjaOwner.isActive) {
      summary.inactiveNinjaOwnerCount += 1;
    }
    missingReftabRows.push(toMissingRow(device, identity, ninjaOwner, ninjaOwnerRaw));
    reportItems.set(`ninja:${device.id}`, {
      assetTag: identity.assetTag, serial: identity.serial, title: identity.title,
      ninjaDeviceId: device.id, status: "Missing from Reftab",
    });
  }

  summary.mismatchCount = rows.length;
  summary.missingReftabCount = missingReftabRows.length;
  return { rows, missingReftabRows, summary, reportItems: [...reportItems.values()] };
}

export async function getOwnerReconciliationRow(assetTag: string, ninjaDeviceId: string): Promise<OwnerReconciliationRow | null> {
  const rows = await getOwnerReconciliationRows();
  return rows.find((row) => row.assetTag === assetTag && row.ninjaDevice.id === ninjaDeviceId) ?? null;
}

export async function getMissingReftabAssetRow(ninjaDeviceId: string): Promise<MissingReftabAssetRow | null> {
  const result = await getOwnerReconciliationResult();
  return result.missingReftabRows.find((row) => row.ninjaDevice.id === ninjaDeviceId) ?? null;
}
