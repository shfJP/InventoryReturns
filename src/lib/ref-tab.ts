import { createHash, createHmac } from "crypto";
import { prisma } from "./db";

/**
 * Reftab integration — see https://www.reftab.com/api-docs
 * Auth: HMAC-SHA256 with public + secret API keys (Settings → API Keys), not Bearer tokens.
 * Reference: https://www.reftab.com/faq/postman-reftab-api
 */

const REF_TAB_URL = process.env.REF_TAB_API_URL?.replace(/\/$/, "") ?? "https://www.reftab.com/api";
const REF_TAB_PUBLIC = (process.env.REF_TAB_API_PUBLIC_KEY ?? "").trim();
const REF_TAB_SECRET = (process.env.REF_TAB_API_SECRET_KEY ?? "").trim();
/** @deprecated Use REF_TAB_API_PUBLIC_KEY + REF_TAB_API_SECRET_KEY. For custom proxies only. */
const REF_TAB_LEGACY_KEY = (process.env.REF_TAB_API_KEY ?? "").trim();
const ASSETS_LIMIT = Math.min(Math.max(Number(process.env.REF_TAB_ASSETS_LIMIT) || 500, 1), 5000);
const ASSIGNEE_FIELD = (process.env.REF_TAB_ASSIGNEE_FIELD ?? "loanee").trim();
const ASSET_TAG_FIELD = (process.env.REF_TAB_ASSET_TAG_FIELD ?? "id").trim();
const SERIAL_FIELD = (process.env.REF_TAB_SERIAL_FIELD ?? "serial").trim();
const MODEL_FIELD = (process.env.REF_TAB_MODEL_FIELD ?? "title").trim();

export type RefTabAssignment = {
  asset_tag: string;
  serial?: string;
  model?: string;
  assigned_to_employee_id: string;
  status?: string;
};

/** Sign a Reftab API request (same rules as official ReftabNode). */
export function signReftabRequest(fullUrl: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: string): Headers {
  const now = new Date().toUTCString();
  let contentMD5 = "";
  let contentType = "";
  if (body !== undefined && body !== "") {
    contentMD5 = createHash("md5").update(body, "utf8").digest("hex");
    contentType = "application/json";
  }
  let signatureToSign = `${method}\n${contentMD5}\n${contentType}\n${now}\n${fullUrl}`;
  // Match Reftab’s signed string normalization (see ReftabNode / Postman examples)
  signatureToSign = unescape(encodeURIComponent(signatureToSign));
  const hmac = createHmac("sha256", REF_TAB_SECRET);
  hmac.update(signatureToSign);
  const token = Buffer.from(hmac.digest("hex"), "utf8").toString("base64");
  const authorization = `RT ${REF_TAB_PUBLIC}:${token}`;
  const headers = new Headers();
  headers.set("Authorization", authorization);
  headers.set("x-rt-date", now);
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function getNested(obj: unknown, path: string): unknown {
  if (!path || obj == null || typeof obj !== "object") return undefined;
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function assigneeToMatchString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.email === "string") return o.email.trim();
    if (typeof o.id === "string") return o.id.trim();
    if (typeof o.employeeId === "string") return o.employeeId.trim();
  }
  return null;
}

function stringifyField(asset: Record<string, unknown>, path: string): string | undefined {
  const v = getNested(asset, path);
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function idSetHas(idSet: Set<string>, match: string): boolean {
  if (idSet.has(match)) return true;
  const lower = match.toLowerCase();
  return Array.from(idSet).some((id) => id.toLowerCase() === lower);
}

/**
 * Fetch equipment for the given employee IDs from Reftab.
 * Uses GET /assets (see Reftab API docs), then filters by REF_TAB_ASSIGNEE_FIELD (dot-path supported).
 */
export async function fetchRefTabAssignments(employeeIds: string[]): Promise<RefTabAssignment[]> {
  if (employeeIds.length === 0) return [];

  if (REF_TAB_PUBLIC && REF_TAB_SECRET) {
    return fetchReftabNativeAssets(employeeIds);
  }

  if (REF_TAB_LEGACY_KEY && REF_TAB_URL) {
    return fetchRefTabLegacyAssignments(employeeIds);
  }

  return [];
}

async function fetchReftabNativeAssets(employeeIds: string[]): Promise<RefTabAssignment[]> {
  const idSet = new Set(employeeIds.map((s) => s.trim()).filter(Boolean));
  const limit = ASSETS_LIMIT;
  const allAssets: Record<string, unknown>[] = [];
  let page = 1;
  const maxPages = 50; // Safety limit

  while (page <= maxPages) {
    const fullUrl = `${REF_TAB_URL}/assets?limit=${limit}&page=${page}`;
    const headers = signReftabRequest(fullUrl, "GET");

    let res: Response;
    try {
      res = await fetch(fullUrl, { method: "GET", headers, cache: "no-store" });
    } catch {
      break;
    }
    if (!res.ok) break;

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      break;
    }

    const list: Record<string, unknown>[] = Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : (data as { data?: unknown }).data != null && Array.isArray((data as { data: unknown }).data)
        ? ((data as { data: Record<string, unknown>[] }).data)
        : [];

    if (list.length === 0) break;
    allAssets.push(...list);

    // If we received fewer than the limit, we've reached the last page
    if (list.length < limit) break;
    page++;
  }

  const out: RefTabAssignment[] = [];
  for (const asset of allAssets) {
    const assigneeRaw = getNested(asset, ASSIGNEE_FIELD);
    const match = assigneeToMatchString(assigneeRaw);
    if (!match || !idSetHas(idSet, match)) continue;

    const tag =
      stringifyField(asset, ASSET_TAG_FIELD) ??
      (typeof asset.id === "string" ? asset.id : undefined) ??
      (typeof asset.serial === "string" ? asset.serial : undefined);
    if (!tag) continue;

    const serial = stringifyField(asset, SERIAL_FIELD);
    const model = stringifyField(asset, MODEL_FIELD);
    const status = stringifyField(asset, "status");

    out.push({
      asset_tag: tag,
      serial: serial ?? undefined,
      model: model ?? undefined,
      assigned_to_employee_id: match,
      status: status ?? undefined,
    });
  }
  return out;
}

/** Fetch ALL assets from Reftab (no employee filter) with full pagination. */
async function fetchAllReftabAssets(): Promise<RefTabAssignment[]> {
  if (!REF_TAB_PUBLIC || !REF_TAB_SECRET) {
    console.warn("[reftab] Sync skipped: REF_TAB_API_PUBLIC_KEY or REF_TAB_API_SECRET_KEY is not configured.");
    return [];
  }
  const limit = ASSETS_LIMIT;
  const allAssets: Record<string, unknown>[] = [];
  let page = 1;
  const maxPages = 100;

  console.info(`[reftab] Starting asset fetch from ${REF_TAB_URL}/assets with limit=${limit}.`);

  while (page <= maxPages) {
    const fullUrl = `${REF_TAB_URL}/assets?limit=${limit}&page=${page}`;
    const headers = signReftabRequest(fullUrl, "GET");
    let res: Response;
    try {
      res = await fetch(fullUrl, { method: "GET", headers, cache: "no-store" });
    } catch (e) {
      console.warn(`[reftab] Page ${page} request failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    if (!res.ok) {
      console.warn(`[reftab] Page ${page} returned ${res.status}: ${await res.text()}`);
      break;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      console.warn(`[reftab] Page ${page} JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    const list: Record<string, unknown>[] = Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : (data as { data?: unknown }).data != null && Array.isArray((data as { data: unknown }).data)
        ? ((data as { data: Record<string, unknown>[] }).data)
        : [];
    console.info(`[reftab] Page ${page} returned ${list.length} asset(s).`);
    if (list.length === 0) break;
    allAssets.push(...list);
    if (list.length < limit) break;
    page++;
  }

  const out: RefTabAssignment[] = [];
  for (const asset of allAssets) {
    const assigneeRaw = getNested(asset, ASSIGNEE_FIELD);
    const match = assigneeToMatchString(assigneeRaw);
    if (!match) continue;

    const tag =
      stringifyField(asset, ASSET_TAG_FIELD) ??
      (typeof asset.id === "string" ? asset.id : undefined) ??
      (typeof asset.serial === "string" ? asset.serial : undefined);
    if (!tag) continue;

    out.push({
      asset_tag: tag,
      serial: stringifyField(asset, SERIAL_FIELD) ?? undefined,
      model: stringifyField(asset, MODEL_FIELD) ?? undefined,
      assigned_to_employee_id: match,
      status: stringifyField(asset, "status") ?? undefined,
    });
  }
  console.info(`[reftab] Fetched ${allAssets.length} raw asset(s); ${out.length} had a usable assignee and asset tag.`);
  return out;
}

export type ReftabSyncResult = { upserted: number; skippedCollected: number; total: number };

/**
 * Sync all Reftab assets into local EquipmentAssignment table.
 * Cross-references CollectionEvent to skip items already collected.
 */
export async function syncReftabToDb(): Promise<ReftabSyncResult> {
  const assets = await fetchAllReftabAssets();
  console.info(`[reftab] Starting database sync for ${assets.length} mapped asset(s).`);
  const now = new Date();
  let upserted = 0;
  let skippedCollected = 0;

  // Get all collected asset+employee combinations
  const collectedEvents = await prisma.collectionEvent.findMany({
    where: { status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] } },
    select: { assetTag: true, assignedToEmployeeId: true },
  });
  const collectedSet = new Set(
    collectedEvents.map((ce) => `${ce.assetTag}-${ce.assignedToEmployeeId}`)
  );

  for (const asset of assets) {
    const key = `${asset.asset_tag}-${asset.assigned_to_employee_id}`;
    if (collectedSet.has(key)) {
      skippedCollected++;
      continue;
    }

    await prisma.equipmentAssignment.upsert({
      where: {
        assetTag_assignedToEmployeeId: {
          assetTag: asset.asset_tag,
          assignedToEmployeeId: asset.assigned_to_employee_id,
        },
      },
      update: {
        serial: asset.serial ?? null,
        model: asset.model ?? null,
        lastSyncedAt: now,
      },
      create: {
        assetTag: asset.asset_tag,
        serial: asset.serial ?? null,
        model: asset.model ?? null,
        assignedToEmployeeId: asset.assigned_to_employee_id,
        source: "ref_tab",
        lastSyncedAt: now,
      },
    });
    upserted++;
  }

  const result = { upserted, skippedCollected, total: assets.length };
  console.info(`[reftab] Sync complete: total=${result.total}, upserted=${result.upserted}, skippedCollected=${result.skippedCollected}.`);
  return result;
}

/** Legacy: custom HTTPS proxy that accepts Bearer + /assignments?employee_id= */
async function fetchRefTabLegacyAssignments(employeeIds: string[]): Promise<RefTabAssignment[]> {
  const base = REF_TAB_URL;
  const results: RefTabAssignment[] = [];
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${REF_TAB_LEGACY_KEY}`,
  };
  for (const eid of employeeIds) {
    try {
      const res = await fetch(`${base}/assignments?employee_id=${encodeURIComponent(eid)}`, { headers });
      if (!res.ok) continue;
      const data = (await res.json()) as RefTabAssignment[] | { data?: RefTabAssignment[] };
      const list = Array.isArray(data) ? data : data.data ?? [];
      results.push(...list.filter((a) => a.assigned_to_employee_id === eid));
    } catch {
      // ignore per-employee errors
    }
  }
  return results;
}
