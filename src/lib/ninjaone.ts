import { prisma } from "./db";
import { fetchWithTimeout } from "./fetch-timeout";

const NINJAONE_BASE_URL = (process.env.NINJAONE_BASE_URL ?? "https://app.ninjarmm.com").replace(/\/$/, "");
const NINJAONE_CLIENT_ID = (process.env.NINJAONE_CLIENT_ID ?? "").trim();
const NINJAONE_CLIENT_SECRET = (process.env.NINJAONE_CLIENT_SECRET ?? "").trim();
const NINJAONE_SCOPE = (process.env.NINJAONE_SCOPE ?? "monitoring").trim();
const NINJAONE_PAGE_SIZE = Math.min(Math.max(Number(process.env.NINJAONE_PAGE_SIZE) || 500, 1), 1000);
const NINJAONE_TIMEOUT_MS = Math.max(Number(process.env.NINJAONE_REQUEST_TIMEOUT_MS) || 30_000, 5_000);

type NinjaOneTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

type NinjaOneDeviceRecord = Record<string, unknown>;

type NormalizedNinjaOneDevice = {
  id: string;
  displayName?: string;
  systemName?: string;
  dnsName?: string;
  netbiosName?: string;
  organizationId?: string;
  locationId?: string;
  nodeClass?: string;
  approvalStatus?: string;
  offline?: boolean;
  lastContact?: string;
  lastUpdate?: string;
  likelyUser?: string;
  detailsJson: string;
};

export type NinjaOneSyncResult = {
  fetched: number;
  upserted: number;
  removed: number;
};

export function isNinjaOneConfigured(): boolean {
  return Boolean(NINJAONE_CLIENT_ID && NINJAONE_CLIENT_SECRET);
}

function valueToString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
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

function firstString(record: NinjaOneDeviceRecord, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = valueToString(getNested(record, path));
    if (value) return value;
  }
  return undefined;
}

function findLikelyUser(record: NinjaOneDeviceRecord): string | undefined {
  const direct = firstString(record, [
    "lastLoggedInUser",
    "lastLoggedInUsername",
    "loggedInUser",
    "loggedInUsername",
    "currentUser",
    "lastUser",
    "user",
    "userName",
    "username",
    "userData.lastLoggedInUser",
    "userData.lastLoggedInUsername",
    "userData.loggedInUser",
    "userData.loggedInUsername",
    "fields.lastLoggedInUser",
    "fields.lastLoggedInUsername",
    "fields.loggedInUser",
    "fields.loggedInUsername",
    "references.lastLoggedInUser",
    "references.loggedInUser",
  ]);
  if (direct) return direct;

  for (const sectionName of ["userData", "fields", "references"]) {
    const section = record[sectionName];
    if (section == null || typeof section !== "object") continue;
    for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.includes("user") || normalizedKey.includes("login")) {
        const text = valueToString(value);
        if (text) return text;
      }
    }
  }

  return undefined;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function getNinjaOneAccessToken(): Promise<string> {
  if (!isNinjaOneConfigured()) {
    throw new Error("NinjaOne is not configured. Set NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: NINJAONE_CLIENT_ID,
    client_secret: NINJAONE_CLIENT_SECRET,
    scope: NINJAONE_SCOPE,
  });
  const res = await fetchWithTimeout(
    `${NINJAONE_BASE_URL}/ws/oauth/token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    NINJAONE_TIMEOUT_MS,
    "NinjaOne OAuth token"
  );

  const data = (await res.json().catch(() => ({}))) as NinjaOneTokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`NinjaOne OAuth token failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

function listFromResponse(data: unknown): NinjaOneDeviceRecord[] {
  if (Array.isArray(data)) return data.filter((item): item is NinjaOneDeviceRecord => item != null && typeof item === "object");
  if (data != null && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["devices", "nodes", "results", "items", "data"]) {
      const list = record[key];
      if (Array.isArray(list)) return list.filter((item): item is NinjaOneDeviceRecord => item != null && typeof item === "object");
    }
  }
  return [];
}

async function fetchAllNinjaOneDevices(): Promise<NinjaOneDeviceRecord[]> {
  const token = await getNinjaOneAccessToken();
  const out: NinjaOneDeviceRecord[] = [];
  let after: string | undefined;

  while (true) {
    const url = new URL(`${NINJAONE_BASE_URL}/api/v2/devices`);
    url.searchParams.set("pageSize", String(NINJAONE_PAGE_SIZE));
    if (after) url.searchParams.set("after", after);

    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
      NINJAONE_TIMEOUT_MS,
      `NinjaOne devices after ${after ?? "start"}`
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`NinjaOne /api/v2/devices failed: ${res.status} ${JSON.stringify(data)}`);
    }

    const page = listFromResponse(data);
    out.push(...page);
    if (page.length < NINJAONE_PAGE_SIZE) break;

    const lastId = valueToString(page[page.length - 1]?.id);
    if (!lastId || lastId === after) break;
    after = lastId;
  }

  return out;
}

function normalizeDevice(record: NinjaOneDeviceRecord): NormalizedNinjaOneDevice | null {
  const id = valueToString(record.id);
  if (!id) return null;
  return {
    id,
    displayName: valueToString(record.displayName),
    systemName: valueToString(record.systemName),
    dnsName: valueToString(record.dnsName),
    netbiosName: valueToString(record.netbiosName),
    organizationId: valueToString(record.organizationId),
    locationId: valueToString(record.locationId),
    nodeClass: valueToString(record.nodeClass),
    approvalStatus: valueToString(record.approvalStatus),
    offline: typeof record.offline === "boolean" ? record.offline : undefined,
    lastContact: valueToString(record.lastContact),
    lastUpdate: valueToString(record.lastUpdate),
    likelyUser: findLikelyUser(record),
    detailsJson: JSON.stringify(record),
  };
}

export async function syncNinjaOneToDb(): Promise<NinjaOneSyncResult> {
  const fetchedDevices = await fetchAllNinjaOneDevices();
  const now = new Date();
  const normalized = fetchedDevices.map(normalizeDevice).filter((device): device is NormalizedNinjaOneDevice => Boolean(device));
  const syncedIds = new Set(normalized.map((device) => device.id));

  let upserted = 0;
  for (const device of normalized) {
    await prisma.ninjaOneDevice.upsert({
      where: { id: device.id },
      update: {
        displayName: device.displayName,
        systemName: device.systemName,
        dnsName: device.dnsName,
        netbiosName: device.netbiosName,
        organizationId: device.organizationId,
        locationId: device.locationId,
        nodeClass: device.nodeClass,
        approvalStatus: device.approvalStatus,
        offline: device.offline,
        lastContact: device.lastContact,
        lastUpdate: device.lastUpdate,
        likelyUser: device.likelyUser,
        detailsJson: device.detailsJson,
        lastSyncedAt: now,
      },
      create: {
        ...device,
        lastSyncedAt: now,
      },
    });
    upserted += 1;
  }

  const staleDevices = await prisma.ninjaOneDevice.findMany({
    select: { id: true },
  });
  const staleIds = staleDevices.map((device) => device.id).filter((id) => !syncedIds.has(id));
  let removed = 0;
  for (const staleChunk of chunks(staleIds, 500)) {
    removed += (await prisma.ninjaOneDevice.deleteMany({ where: { id: { in: staleChunk } } })).count;
  }

  console.info(`[ninjaone] Synced ${upserted} device(s); removed ${removed} stale device(s).`);
  return { fetched: fetchedDevices.length, upserted, removed };
}
