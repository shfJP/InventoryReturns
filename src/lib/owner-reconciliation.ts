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
  ninjaDevice: {
    id: string;
    displayName: string | null;
    systemName: string | null;
    dnsName: string | null;
    netbiosName: string | null;
    offline: boolean | null;
    lastContact: string | null;
    lastUpdate: string | null;
  };
  matchReason: string;
  confidence: number;
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
}

function buildUserAliasMap(users: UserSummary[]): Map<string, UserSummary> {
  const aliases = new Map<string, UserSummary>();
  for (const user of users) {
    addAlias(aliases, user.employeeId, user);
    addAlias(aliases, user.email, user);
    addAlias(aliases, user.upn, user);
  }
  return aliases;
}

function resolveLikelyUser(rawLikelyUser: string | null, aliases: Map<string, UserSummary>): UserSummary | null {
  const direct = normalizeAlias(rawLikelyUser);
  if (!direct) return null;
  return aliases.get(direct) ?? aliases.get(aliasLocalPart(direct) ?? "") ?? null;
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

function summarizeUser(user: Pick<User, "employeeId" | "displayName" | "email" | "upn" | "isActive">): UserSummary {
  return {
    employeeId: user.employeeId,
    displayName: user.displayName,
    email: user.email,
    upn: user.upn,
    isActive: user.isActive,
  };
}

function toRow(item: EquipmentWithUser, match: NinjaMatch, ninjaOwner: UserSummary): OwnerReconciliationRow {
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
    ninjaOwnerRaw: match.device.likelyUser ?? "",
    ninjaDevice: {
      id: match.device.id,
      displayName: match.device.displayName,
      systemName: match.device.systemName,
      dnsName: match.device.dnsName,
      netbiosName: match.device.netbiosName,
      offline: match.device.offline,
      lastContact: match.device.lastContact,
      lastUpdate: match.device.lastUpdate,
    },
    matchReason: match.matchReason,
    confidence: Math.min(match.score, 100),
  };
}

export async function getOwnerReconciliationRows(): Promise<OwnerReconciliationRow[]> {
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

  return equipment
    .map((item) => {
      const match = findBestNinjaMatch(item, devices);
      if (!match || !match.device.likelyUser) return null;
      const ninjaOwner = resolveLikelyUser(match.device.likelyUser, aliases);
      if (!ninjaOwner?.isActive) return null;
      if (ninjaOwner.employeeId === item.assignedToEmployeeId) return null;
      return toRow(item, match, ninjaOwner);
    })
    .filter((row): row is OwnerReconciliationRow => Boolean(row));
}

export async function getOwnerReconciliationRow(assetTag: string, ninjaDeviceId: string): Promise<OwnerReconciliationRow | null> {
  const rows = await getOwnerReconciliationRows();
  return rows.find((row) => row.assetTag === assetTag && row.ninjaDevice.id === ninjaDeviceId) ?? null;
}
