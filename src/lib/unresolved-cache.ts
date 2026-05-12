import { prisma } from "./db";

const UNRESOLVED_COLLECTIONS_CACHE_KEY = "cache:unresolvedCollections:v1";

type DbUnresolvedCollection = Awaited<ReturnType<typeof fetchUnresolvedCollectionsFromDb>>[number];
type DbNinjaOneDevice = Awaited<ReturnType<typeof fetchNinjaOneDevicesFromDb>>[number];

export type CachedUnresolvedCollection = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  assetTag: string;
  catName: string | null;
  serial: string | null;
  model: string | null;
  source: string;
  investigationNotes: string | null;
  auditEvents: Array<{
    id: string;
    action: string;
    oldStatus: string | null;
    newStatus: string | null;
    note: string | null;
    actorEmployeeId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    createdAt: string;
  }>;
  ninjaOneMatches: Array<{
    id: string;
    displayName: string | null;
    systemName: string | null;
    dnsName: string | null;
    netbiosName: string | null;
    likelyUser: string | null;
    offline: boolean | null;
    lastContact: string | null;
    lastUpdate: string | null;
    matchReason: string;
  }>;
  detectedAt: string;
  status: string;
};

type CachePayload = {
  createdAt: string;
  items: CachedUnresolvedCollection[];
};

function normalizeMatchText(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function ninjaDeviceSearchText(device: {
  displayName: string | null;
  systemName: string | null;
  dnsName: string | null;
  netbiosName: string | null;
  likelyUser: string | null;
  detailsJson: string | null;
}): string {
  return [
    device.displayName,
    device.systemName,
    device.dnsName,
    device.netbiosName,
    device.likelyUser,
    device.detailsJson,
  ].map(normalizeMatchText).join(" ");
}

function ninjaMatchesForItem(item: { assetTag: string; serial: string | null; model: string | null }, devices: DbNinjaOneDevice[]): CachedUnresolvedCollection["ninjaOneMatches"] {
  const candidates = [
    { label: "asset tag", value: item.assetTag, score: 100 },
    { label: "serial", value: item.serial, score: 90 },
    { label: "model/title", value: item.model, score: 30 },
  ]
    .map((candidate) => ({ ...candidate, normalized: normalizeMatchText(candidate.value) }))
    .filter((candidate) => candidate.normalized.length >= 3);

  return devices
    .map((device) => {
      const haystack = ninjaDeviceSearchText(device);
      const matches = candidates.filter((candidate) => haystack.includes(candidate.normalized));
      if (matches.length === 0) return null;
      return {
        device,
        score: matches.reduce((sum, match) => sum + match.score, 0),
        matchReason: matches.map((match) => match.label).join(", "),
      };
    })
    .filter((match): match is { device: DbNinjaOneDevice; score: number; matchReason: string } => Boolean(match))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ device, matchReason }) => ({
      id: device.id,
      displayName: device.displayName,
      systemName: device.systemName,
      dnsName: device.dnsName,
      netbiosName: device.netbiosName,
      likelyUser: device.likelyUser,
      offline: device.offline,
      lastContact: device.lastContact,
      lastUpdate: device.lastUpdate,
      matchReason,
    }));
}

function fetchUnresolvedCollectionsFromDb() {
  return prisma.unresolvedCollection.findMany({
    where: { status: { not: "RESOLVED" } },
    orderBy: [{ detectedAt: "desc" }, { employeeName: "asc" }, { assetTag: "asc" }],
    include: {
      auditEvents: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

function fetchNinjaOneDevicesFromDb() {
  return prisma.ninjaOneDevice.findMany();
}

function mapUnresolvedCollection(entry: DbUnresolvedCollection, ninjaDevices: DbNinjaOneDevice[]): CachedUnresolvedCollection {
  return {
    id: entry.id,
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    employeeEmail: entry.employeeEmail,
    managerEmployeeId: entry.managerEmployeeId,
    managerName: entry.managerName,
    managerEmail: entry.managerEmail,
    assetTag: entry.assetTag,
    catName: entry.catName,
    serial: entry.serial,
    model: entry.model,
    source: entry.source,
    investigationNotes: entry.investigationNotes,
    auditEvents: entry.auditEvents.map((event) => ({
      id: event.id,
      action: event.action,
      oldStatus: event.oldStatus,
      newStatus: event.newStatus,
      note: event.note,
      actorEmployeeId: event.actorEmployeeId,
      actorName: event.actorName,
      actorEmail: event.actorEmail,
      createdAt: event.createdAt.toISOString(),
    })),
    ninjaOneMatches: ninjaMatchesForItem(entry, ninjaDevices),
    detectedAt: entry.detectedAt.toISOString(),
    status: entry.status,
  };
}

async function readUnresolvedCollectionsCache(): Promise<CachePayload | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: UNRESOLVED_COLLECTIONS_CACHE_KEY } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<CachePayload>;
    if (!parsed.createdAt || !Array.isArray(parsed.items)) return null;
    return { createdAt: parsed.createdAt, items: parsed.items as CachedUnresolvedCollection[] };
  } catch {
    return null;
  }
}

async function writeUnresolvedCollectionsCache(items: CachedUnresolvedCollection[]): Promise<CachePayload> {
  const payload = { createdAt: new Date().toISOString(), items };
  await prisma.appSetting.upsert({
    where: { key: UNRESOLVED_COLLECTIONS_CACHE_KEY },
    update: { value: JSON.stringify(payload) },
    create: { key: UNRESOLVED_COLLECTIONS_CACHE_KEY, value: JSON.stringify(payload) },
  });
  return payload;
}

export async function invalidateUnresolvedCollectionsCache(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: UNRESOLVED_COLLECTIONS_CACHE_KEY } });
}

export async function getCachedUnresolvedCollections(): Promise<CachePayload> {
  const cached = await readUnresolvedCollectionsCache();
  if (cached) return cached;

  const [unresolved, ninjaDevices] = await Promise.all([
    fetchUnresolvedCollectionsFromDb(),
    fetchNinjaOneDevicesFromDb(),
  ]);
  const items = unresolved.map((entry) => mapUnresolvedCollection(entry, ninjaDevices));
  return writeUnresolvedCollectionsCache(items);
}
