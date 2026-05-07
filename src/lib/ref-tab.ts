import { createHash, createHmac } from "crypto";
import { prisma } from "./db";
import { fetchWithTimeout } from "./fetch-timeout";

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
const REF_TAB_TIMEOUT_MS = Math.max(Number(process.env.REF_TAB_REQUEST_TIMEOUT_MS) || 30_000, 5_000);
const REF_TAB_SYNC_SOURCE = (process.env.REF_TAB_SYNC_SOURCE ?? "assets").trim().toLowerCase();

export type RefTabAssignment = {
  asset_tag: string;
  aid?: string;
  serial?: string;
  model?: string;
  title?: string;
  catName?: string;
  locationName?: string;
  statusName?: string;
  details?: Record<string, string>;
  assigned_to_employee_id: string;
  status?: string;
};

type ReftabLoanee = {
  email?: string;
  uid?: string | number;
  lnid?: string | number;
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

function valueToString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function firstString(obj: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = valueToString(getNested(obj, path));
    if (value) return value;
  }
  return undefined;
}

function compactDetails(details: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function assetDetails(record: Record<string, unknown>): {
  aid?: string;
  assetTag?: string;
  serial?: string;
  model?: string;
  title?: string;
  catName?: string;
  locationName?: string;
  statusName?: string;
  details: Record<string, string>;
} {
  const aid = firstString(record, ["aid", "asset.aid"]);
  const assetTag = firstString(record, ["assetTag", "asset_tag", "assetId", "asset_id", "id", "asset.id", "aid", "asset.aid"]);
  const serial = firstString(record, ["serial", "serialNumber", "serial_number", "asset.serial", "asset.serialNumber"]);
  const title = firstString(record, ["title", "name", "asset.title", "asset.name"]);
  const model = firstString(record, [MODEL_FIELD, "model", "asset.model", "asset.title", "title", "name"]);
  const catName = firstString(record, ["catName", "categoryName", "category.name", "category", "asset.catName", "asset.categoryName", "asset.category.name"]);
  const locationName = firstString(record, ["locationName", "location.name", "location", "clName", "asset.locationName", "asset.location.name"]);
  const statusName = firstString(record, ["statusName", "status.name", "status", "asset.statusName", "asset.status.name", "loan.status"]);
  return {
    aid,
    assetTag,
    serial,
    model,
    title,
    catName,
    locationName,
    statusName,
    details: compactDetails({
      aid,
      assetTag,
      serial,
      model,
      title,
      catName,
      locationName,
      statusName,
      manufacturer: firstString(record, ["manufacturer", "make", "asset.manufacturer", "asset.make"]),
      location: locationName,
      status: statusName,
    }),
  };
}

function listFromResponse(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    if (data.length > 0 && Array.isArray(data[0])) {
      return (data[0] as unknown[]).filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
    }
    return data.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
  }
  if (data != null && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["data", "items", "results", "loans", "assets", "loanees"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
      }
    }
  }
  return [];
}

async function fetchReftabJson(endpoint: string, label: string): Promise<unknown> {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const fullUrl = `${REF_TAB_URL}/${cleanEndpoint}`;
  const headers = signReftabRequest(fullUrl, "GET");
  const res = await fetchWithTimeout(
    fullUrl,
    { method: "GET", headers, cache: "no-store" },
    REF_TAB_TIMEOUT_MS,
    label
  );
  if (!res.ok) {
    throw new Error(`${label} returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function idSetHas(idSet: Set<string>, match: string): boolean {
  if (idSet.has(match)) return true;
  const lower = match.toLowerCase();
  return Array.from(idSet).some((id) => id.toLowerCase() === lower);
}

function normalizeKey(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

async function buildUserAliasMap(): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    select: { employeeId: true, email: true, upn: true },
  });
  const aliases = new Map<string, string>();
  for (const user of users) {
    for (const value of [user.employeeId, user.email, user.upn]) {
      const key = normalizeKey(value);
      if (key) aliases.set(key, user.employeeId);
    }
  }
  return aliases;
}

function resolveAssigneeEmployeeId(rawAssignee: string, aliases: Map<string, string>): string | null {
  return aliases.get(normalizeKey(rawAssignee) ?? "") ?? null;
}

function addLoaneeAlias(map: Map<string, string>, id: unknown, email: string | undefined): void {
  const idKey = valueToString(id);
  const emailKey = normalizeKey(email);
  if (idKey && emailKey) map.set(idKey, emailKey);
}

function buildLoaneeMaps(loanees: ReftabLoanee[]): { lnidToEmail: Map<string, string>; uidToEmail: Map<string, string> } {
  const lnidToEmail = new Map<string, string>();
  const uidToEmail = new Map<string, string>();
  for (const loanee of loanees) {
    addLoaneeAlias(lnidToEmail, loanee.lnid, loanee.email);
    addLoaneeAlias(uidToEmail, loanee.uid, loanee.email);
  }
  return { lnidToEmail, uidToEmail };
}

async function fetchAllReftabLoanees(): Promise<ReftabLoanee[]> {
  const limit = 500;
  let offset = 0;
  const out: ReftabLoanee[] = [];

  while (offset < 50_000) {
    const data = await fetchReftabJson(`loanees?limit=${limit}&offset=${offset}`, `Reftab loanees offset ${offset}`);
    const list = listFromResponse(data);
    if (list.length === 0) break;
    for (const item of list) {
      out.push({
        email: firstString(item, ["email", "mail", "user.email", "loanee.email"]),
        uid: firstString(item, ["uid", "id", "user.uid"]),
        lnid: firstString(item, ["lnid", "loaneeId", "loanee.lnid"]),
      });
    }
    if (list.length < limit) break;
    offset += limit;
  }

  console.info(`[reftab] Fetched ${out.length} loanee/user record(s).`);
  return out;
}

function getLoanAssignee(loan: Record<string, unknown>, loaneeMaps: { lnidToEmail: Map<string, string>; uidToEmail: Map<string, string> }): string | undefined {
  const directEmail = firstString(loan, [
    "loanee.email",
    "loaneeEmail",
    "loanee_email",
    "email",
    "user.email",
  ]);
  if (directEmail) return directEmail;

  const lnid = firstString(loan, ["lnid", "loanee.lnid"]);
  if (lnid && loaneeMaps.lnidToEmail.has(lnid)) return loaneeMaps.lnidToEmail.get(lnid);

  const loanUid = firstString(loan, ["loan_uid", "uid", "user.uid"]);
  if (loanUid && loaneeMaps.uidToEmail.has(loanUid)) return loaneeMaps.uidToEmail.get(loanUid);

  return firstString(loan, ["loanee", "assigned_to", "assignedTo", "borrower"]);
}

function resolveReftabAssigneeFromRecord(record: Record<string, unknown>, loaneeMaps: { lnidToEmail: Map<string, string>; uidToEmail: Map<string, string> }): string | undefined {
  const directValues = [
    assigneeToMatchString(getNested(record, ASSIGNEE_FIELD)),
    firstString(record, [
      "loanee.email",
      "loaneeEmail",
      "loanee_email",
      "checkedOutTo.email",
      "loan.loanee.email",
      "loan.email",
    ]),
  ].filter((value): value is string => Boolean(value));

  for (const value of directValues) {
    const normalized = normalizeKey(value);
    if (!normalized) continue;
    if (loaneeMaps.lnidToEmail.has(value)) return loaneeMaps.lnidToEmail.get(value);
    if (loaneeMaps.uidToEmail.has(value)) return loaneeMaps.uidToEmail.get(value);
    return value;
  }

  const lnid = firstString(record, ["lnid", "loanee.lnid", "loan.lnid"]);
  if (lnid && loaneeMaps.lnidToEmail.has(lnid)) return loaneeMaps.lnidToEmail.get(lnid);

  const loanUid = firstString(record, ["loan_uid", "uid", "loanee.uid", "loan.loan_uid", "loan.uid"]);
  if (loanUid && loaneeMaps.uidToEmail.has(loanUid)) return loaneeMaps.uidToEmail.get(loanUid);

  return undefined;
}

function pushLoanAsset(out: RefTabAssignment[], asset: Record<string, unknown>, fallbackAssignee: string): void {
  const details = assetDetails(asset);
  const tag = details.assetTag;
  if (!tag) return;
  out.push({
    asset_tag: tag,
    aid: details.aid,
    serial: details.serial,
    model: details.model,
    title: details.title,
    catName: details.catName,
    locationName: details.locationName,
    statusName: details.statusName,
    details: details.details,
    assigned_to_employee_id: fallbackAssignee,
    status: "out",
  });
}

function assignmentsFromLoan(loan: Record<string, unknown>, assignee: string): RefTabAssignment[] {
  const out: RefTabAssignment[] = [];
  for (const key of ["assets", "items"]) {
    const value = loan[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item != null && typeof item === "object" && !Array.isArray(item)) {
        pushLoanAsset(out, item as Record<string, unknown>, assignee);
      } else {
        const tag = valueToString(item);
        if (tag) out.push({ asset_tag: tag, aid: tag, assigned_to_employee_id: assignee, status: "out" });
      }
    }
  }

  const aids = loan.aids;
  if (Array.isArray(aids)) {
    for (const aid of aids) {
      const tag = valueToString(aid);
      if (tag) out.push({ asset_tag: tag, aid: tag, assigned_to_employee_id: assignee, status: "out" });
    }
  }

  if (out.length === 0) pushLoanAsset(out, loan, assignee);
  return out;
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
  let offset = 0;
  const loaneeMaps = buildLoaneeMaps(await fetchAllReftabLoanees());

  while (offset < 500_000) {
    const fullUrl = `${REF_TAB_URL}/assets?limit=${limit}&offset=${offset}&loan=out`;
    const headers = signReftabRequest(fullUrl, "GET");

    let res: Response;
    try {
      res = await fetchWithTimeout(
        fullUrl,
        { method: "GET", headers, cache: "no-store" },
        REF_TAB_TIMEOUT_MS,
        `Reftab checked-out assets offset ${offset}`
      );
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

    const list = listFromResponse(data);

    if (list.length === 0) break;
    allAssets.push(...list);

    // If we received fewer than the limit, we've reached the last page
    if (list.length < limit) break;
    offset += limit;
  }

  const out: RefTabAssignment[] = [];
  for (const asset of allAssets) {
    const match = resolveReftabAssigneeFromRecord(asset, loaneeMaps);
    if (!match || !idSetHas(idSet, match)) continue;

    const details = assetDetails(asset);
    const tag =
      stringifyField(asset, ASSET_TAG_FIELD) ??
      details.assetTag ??
      details.serial;
    if (!tag) continue;

    out.push({
      asset_tag: tag,
      aid: details.aid,
      serial: stringifyField(asset, SERIAL_FIELD) ?? details.serial,
      model: stringifyField(asset, MODEL_FIELD) ?? details.model,
      title: details.title,
      catName: details.catName,
      locationName: details.locationName,
      statusName: details.statusName,
      details: details.details,
      assigned_to_employee_id: match,
      status: details.statusName,
    });
  }
  return out;
}

/** Fetch current checked-out loans from Reftab and map them to asset+loanee assignments. */
async function fetchAllReftabLoans(): Promise<RefTabAssignment[]> {
  if (!REF_TAB_PUBLIC || !REF_TAB_SECRET) {
    console.warn("[reftab] Loan sync skipped: REF_TAB_API_PUBLIC_KEY or REF_TAB_API_SECRET_KEY is not configured.");
    return [];
  }

  const limit = ASSETS_LIMIT;
  let offset = 0;
  const allLoans: Record<string, unknown>[] = [];
  const loanees = await fetchAllReftabLoanees();
  const loaneeMaps = buildLoaneeMaps(loanees);

  console.info(`[reftab] Starting checked-out loan fetch from ${REF_TAB_URL}/loans with limit=${limit}.`);

  while (offset < 500_000) {
    const query = `loans?limit=${limit}&offset=${offset}&status=out`;
    let list: Record<string, unknown>[];
    try {
      list = listFromResponse(await fetchReftabJson(query, `Reftab loans offset ${offset}`));
    } catch (e) {
      console.warn(`[reftab] Loan request offset ${offset} failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    console.info(`[reftab] Loan offset ${offset} returned ${list.length} loan(s).`);
    if (list.length === 0) break;
    allLoans.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }

  let skippedMissingAssignee = 0;
  let skippedMissingAsset = 0;
  const out: RefTabAssignment[] = [];
  for (const loan of allLoans) {
    const assignee = getLoanAssignee(loan, loaneeMaps);
    if (!assignee) {
      skippedMissingAssignee++;
      continue;
    }
    const before = out.length;
    out.push(...assignmentsFromLoan(loan, assignee));
    if (out.length === before) skippedMissingAsset++;
  }

  console.info(`[reftab] Fetched ${allLoans.length} loan(s); mapped ${out.length} checked-out asset assignment(s); skippedMissingAssignee=${skippedMissingAssignee}; skippedMissingAsset=${skippedMissingAsset}.`);
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
  let offset = 0;
  const loaneeMaps = buildLoaneeMaps(await fetchAllReftabLoanees());

  console.info(`[reftab] Starting checked-out asset fetch from ${REF_TAB_URL}/assets with limit=${limit}.`);

  while (offset < 500_000) {
    const fullUrl = `${REF_TAB_URL}/assets?limit=${limit}&offset=${offset}&loan=out`;
    const headers = signReftabRequest(fullUrl, "GET");
    let res: Response;
    try {
      res = await fetchWithTimeout(
        fullUrl,
        { method: "GET", headers, cache: "no-store" },
        REF_TAB_TIMEOUT_MS,
        `Reftab checked-out assets offset ${offset}`
      );
    } catch (e) {
      console.warn(`[reftab] Asset offset ${offset} request failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    if (!res.ok) {
      console.warn(`[reftab] Asset offset ${offset} returned ${res.status}: ${await res.text()}`);
      break;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      console.warn(`[reftab] Asset offset ${offset} JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    const list = listFromResponse(data);
    console.info(`[reftab] Asset offset ${offset} returned ${list.length} checked-out asset(s).`);
    if (list.length === 0) break;
    allAssets.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }

  let skippedMissingAssignee = 0;
  const out: RefTabAssignment[] = [];
  for (const asset of allAssets) {
    const match = resolveReftabAssigneeFromRecord(asset, loaneeMaps);
    if (!match) {
      skippedMissingAssignee++;
      continue;
    }

    const details = assetDetails(asset);
    const tag =
      stringifyField(asset, ASSET_TAG_FIELD) ??
      details.assetTag ??
      details.serial;
    if (!tag) continue;

    out.push({
      asset_tag: tag,
      aid: details.aid,
      serial: stringifyField(asset, SERIAL_FIELD) ?? details.serial,
      model: stringifyField(asset, MODEL_FIELD) ?? details.model,
      title: details.title,
      catName: details.catName,
      locationName: details.locationName,
      statusName: details.statusName,
      details: details.details,
      assigned_to_employee_id: match,
      status: details.statusName,
    });
  }
  console.info(`[reftab] Fetched ${allAssets.length} checked-out asset(s); ${out.length} had a usable asset tag and loanee; skippedMissingAssignee=${skippedMissingAssignee}.`);
  return out;
}

export type ReftabSyncResult = {
  upserted: number;
  skippedCollected: number;
  skippedUnmatchedAssignee: number;
  total: number;
};

/**
 * Sync all Reftab assets into local EquipmentAssignment table.
 * Cross-references CollectionEvent to skip items already collected.
 */
export async function syncReftabToDb(): Promise<ReftabSyncResult> {
  let assets = REF_TAB_SYNC_SOURCE === "loans" ? await fetchAllReftabLoans() : await fetchAllReftabAssets();
  if (assets.length === 0 && REF_TAB_SYNC_SOURCE !== "loans") {
    console.warn("[reftab] Asset sync produced zero mapped assignments; falling back to /loans for compatibility.");
    assets = await fetchAllReftabLoans();
  }
  console.info(`[reftab] Starting database sync for ${assets.length} mapped asset(s).`);
  const now = new Date();
  const userAliases = await buildUserAliasMap();
  let upserted = 0;
  let skippedCollected = 0;
  let skippedUnmatchedAssignee = 0;

  // Get all collected asset+employee combinations
  const collectedEvents = await prisma.collectionEvent.findMany({
    where: { status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] } },
    select: { assetTag: true, assignedToEmployeeId: true },
  });
  const collectedSet = new Set(
    collectedEvents.map((ce) => `${ce.assetTag}-${ce.assignedToEmployeeId}`)
  );

  for (const asset of assets) {
    const resolvedEmployeeId = resolveAssigneeEmployeeId(asset.assigned_to_employee_id, userAliases);
    if (!resolvedEmployeeId) {
      skippedUnmatchedAssignee++;
      console.warn(`[reftab] Skipping asset ${asset.asset_tag}: assignee "${asset.assigned_to_employee_id}" does not match any local user employeeId, email, or UPN.`);
      continue;
    }

    const key = `${asset.asset_tag}-${resolvedEmployeeId}`;
    if (collectedSet.has(key)) {
      skippedCollected++;
      continue;
    }

    await prisma.equipmentAssignment.upsert({
      where: {
        assetTag_assignedToEmployeeId: {
          assetTag: asset.asset_tag,
          assignedToEmployeeId: resolvedEmployeeId,
        },
      },
      update: {
        aid: asset.aid ?? null,
        serial: asset.serial ?? null,
        model: asset.model ?? null,
        title: asset.title ?? null,
        catName: asset.catName ?? null,
        locationName: asset.locationName ?? null,
        statusName: asset.statusName ?? asset.status ?? null,
        detailsJson: asset.details ? JSON.stringify(asset.details) : null,
        assignedToEmployeeId: resolvedEmployeeId,
        lastSyncedAt: now,
      },
      create: {
        assetTag: asset.asset_tag,
        aid: asset.aid ?? null,
        serial: asset.serial ?? null,
        model: asset.model ?? null,
        title: asset.title ?? null,
        catName: asset.catName ?? null,
        locationName: asset.locationName ?? null,
        statusName: asset.statusName ?? asset.status ?? null,
        detailsJson: asset.details ? JSON.stringify(asset.details) : null,
        assignedToEmployeeId: resolvedEmployeeId,
        source: "ref_tab",
        lastSyncedAt: now,
      },
    });
    upserted++;
  }

  const result = { upserted, skippedCollected, skippedUnmatchedAssignee, total: assets.length };
  console.info(`[reftab] Sync complete: total=${result.total}, upserted=${result.upserted}, skippedCollected=${result.skippedCollected}, skippedUnmatchedAssignee=${result.skippedUnmatchedAssignee}.`);
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
      const res = await fetchWithTimeout(
        `${base}/assignments?employee_id=${encodeURIComponent(eid)}`,
        { headers },
        REF_TAB_TIMEOUT_MS,
        `Reftab assignments for ${eid}`
      );
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
