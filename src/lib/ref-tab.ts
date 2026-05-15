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
const REF_TAB_SYNC_SOURCE = (process.env.REF_TAB_SYNC_SOURCE ?? "loans").trim().toLowerCase();
const REF_TAB_CHECKIN_ENDPOINT_TEMPLATE = (process.env.REF_TAB_CHECKIN_ENDPOINT_TEMPLATE ?? "loans/{loanId}/checkin").trim();
const REF_TAB_CHECKOUT_ENDPOINT = (process.env.REF_TAB_CHECKOUT_ENDPOINT ?? "loans").trim();
const REF_TAB_CREATE_ASSET_ENDPOINT = (process.env.REF_TAB_CREATE_ASSET_ENDPOINT ?? "assets").trim();
const REF_TAB_CREATE_LOANEE_ENDPOINT = (process.env.REF_TAB_CREATE_LOANEE_ENDPOINT ?? "loanees").trim();
const REF_TAB_CREATE_MISSING_LOANEES = (process.env.REF_TAB_CREATE_MISSING_LOANEES ?? "false").trim().toLowerCase() === "true";
const REF_TAB_LOANEE_LOOKUP_ENDPOINTS = (process.env.REF_TAB_LOANEE_LOOKUP_ENDPOINTS ?? "loanees")
  .split(",")
  .map((endpoint) => endpoint.trim())
  .filter(Boolean);
const REF_TAB_CREATE_ASSET_CATEGORY_ID = (process.env.REF_TAB_CREATE_ASSET_CATEGORY_ID ?? "").trim();
const REF_TAB_CREATE_ASSET_DESKTOP_CATEGORY_ID = (process.env.REF_TAB_CREATE_ASSET_DESKTOP_CATEGORY_ID ?? "").trim();
const REF_TAB_CREATE_ASSET_LAPTOP_CATEGORY_ID = (process.env.REF_TAB_CREATE_ASSET_LAPTOP_CATEGORY_ID ?? "").trim();
const REF_TAB_CREATE_ASSET_TABLET_CATEGORY_ID = (process.env.REF_TAB_CREATE_ASSET_TABLET_CATEGORY_ID ?? "").trim();
const REF_TAB_CREATE_ASSET_LOCATION_ID = (process.env.REF_TAB_CREATE_ASSET_LOCATION_ID ?? "67497").trim();
const REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD = (process.env.REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD ?? "Service Tag").trim();

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
  managerEmployeeId?: string;
  managerName?: string;
  managerEmail?: string;
  status?: string;
};

type ReftabLoanee = {
  email?: string;
  uid?: string | number;
  lnid?: string | number;
  employeeId?: string | number;
  managerEmployeeId?: string;
  managerName?: string;
  managerEmail?: string;
};

type ReftabCheckoutRef = {
  field: "lnid" | "loan_uid";
  value: string;
};

type LoaneeMaps = {
  lnidToEmail: Map<string, string>;
  uidToEmail: Map<string, string>;
  lnidToLoanee: Map<string, ReftabLoanee>;
  uidToLoanee: Map<string, ReftabLoanee>;
};

type ReftabManagerInfo = {
  managerEmployeeId?: string;
  managerName?: string;
  managerEmail?: string;
};

type UserAlias = {
  id: string;
  employeeId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  managerId: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  managerEmail: string | null;
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

function getNestedLoose(obj: unknown, path: string): unknown {
  if (!path || obj == null || typeof obj !== "object") return undefined;
  let cur: unknown = obj;
  for (const p of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    const record = cur as Record<string, unknown>;
    if (p in record) {
      cur = record[p];
      continue;
    }
    const normalized = p.toLowerCase().replace(/[_-]/g, "");
    const key = Object.keys(record).find((candidate) => candidate.toLowerCase().replace(/[_-]/g, "") === normalized);
    if (!key) return undefined;
    cur = record[key];
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

function collectRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, out);
    return out;
  }
  if (typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  out.push(record);
  for (const nested of Object.values(record)) {
    if (nested != null && typeof nested === "object") collectRecords(nested, out);
  }
  return out;
}

function recordContainsNormalizedValue(record: Record<string, unknown>, target: string | null): boolean {
  if (!target) return false;
  return Object.values(record).some((value) => {
    if (typeof value === "string" || typeof value === "number") return normalizeKey(String(value)) === target;
    if (Array.isArray(value)) {
      return value.some((item) => (typeof item === "string" || typeof item === "number") && normalizeKey(String(item)) === target);
    }
    return false;
  });
}

function firstString(obj: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = valueToString(getNested(obj, path));
    if (value) return value;
  }
  return undefined;
}

function firstStringLoose(obj: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = valueToString(getNestedLoose(obj, path));
    if (value) return value;
  }
  return undefined;
}

function managerInfoFromRecord(record: Record<string, unknown>): ReftabManagerInfo {
  return {
    managerEmployeeId: firstString(record, [
      "managerEmployeeId",
      "manager.employeeId",
      "manager.uid",
      "manager.id",
      "managerUpn",
      "manager.upn",
      "assignedManager.employeeId",
      "assignedManager.uid",
      "assignedManager.id",
      "supervisor.employeeId",
      "supervisor.uid",
      "supervisor.id",
      "boss.employeeId",
      "boss.uid",
      "boss.id",
      "user.manager.employeeId",
      "user.manager.uid",
      "loanee.manager.employeeId",
      "loanee.manager.uid",
    ]),
    managerName: firstString(record, [
      "managerName",
      "manager.name",
      "manager.displayName",
      "manager.fullName",
      "manager",
      "assignedManager.name",
      "assignedManager.displayName",
      "supervisor.name",
      "supervisor.displayName",
      "boss.name",
      "boss.displayName",
      "user.manager.name",
      "user.manager.displayName",
      "loanee.manager.name",
      "loanee.manager.displayName",
    ]),
    managerEmail: firstString(record, [
      "managerEmail",
      "manager.email",
      "manager.mail",
      "manager.userPrincipalName",
      "manager.upn",
      "assignedManager.email",
      "assignedManager.mail",
      "assignedManager.upn",
      "supervisor.email",
      "supervisor.mail",
      "boss.email",
      "boss.mail",
      "user.manager.email",
      "user.manager.mail",
      "loanee.manager.email",
      "loanee.manager.mail",
    ]),
  };
}

function combineManagerInfo(...infos: Array<ReftabManagerInfo | undefined>): ReftabManagerInfo {
  const out: ReftabManagerInfo = {};
  for (const info of infos) {
    if (!info) continue;
    out.managerEmployeeId ??= info.managerEmployeeId;
    out.managerName ??= info.managerName;
    out.managerEmail ??= info.managerEmail;
  }
  return out;
}

function likelyCategoryFromFields(record: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(record)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("cat") ||
      normalized.includes("category") ||
      normalized === "type" ||
      normalized.includes("device")
    ) {
      const text = valueToString(value);
      if (text && !/^\d+$/.test(text)) return text;
    }
  }
  return undefined;
}

function compactDetails(details: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(details).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function normalizedStatusText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[_-]+/g, " ") ?? "";
}

function firstStatus(record: Record<string, unknown>, paths: string[]): string | undefined {
  return firstString(record, paths);
}

function hasReturnMarker(record: Record<string, unknown>): boolean {
  return Boolean(firstString(record, [
    "returnedAt",
    "returned_at",
    "returnDate",
    "return_date",
    "checkedInAt",
    "checked_in_at",
    "dateReturned",
    "date_returned",
    "loan.returnedAt",
    "loan.returnDate",
    "loan.checkedInAt",
  ]));
}

function isInactiveLoanStatus(status: string | undefined): boolean {
  const text = normalizedStatusText(status);
  if (!text) return false;
  return [
    "available",
    "checked in",
    "check in",
    "closed",
    "complete",
    "completed",
    "in stock",
    "returned",
    "return",
  ].some((value) => text === value || text.includes(value));
}

function isActiveLoanStatus(status: string | undefined): boolean {
  const text = normalizedStatusText(status);
  if (!text) return false;
  return [
    "assigned",
    "borrowed",
    "checked out",
    "check out",
    "loaned",
    "on loan",
    "out",
  ].some((value) => text === value || text.includes(value));
}

function isCurrentLoanRecord(record: Record<string, unknown>): boolean {
  if (hasReturnMarker(record)) return false;
  const status = firstStatus(record, ["status", "loan.status", "statusName", "loan.statusName"]);
  if (isInactiveLoanStatus(status)) return false;
  if (isActiveLoanStatus(status)) return true;
  return true;
}

function isCurrentLoanAsset(record: Record<string, unknown>): boolean {
  if (hasReturnMarker(record)) return false;
  const loanStatus = firstStatus(record, ["loan.status", "loan.statusName"]);
  if (isInactiveLoanStatus(loanStatus)) return false;
  if (isActiveLoanStatus(loanStatus)) return true;
  const assetStatus = firstStatus(record, ["statusName", "status.name", "status", "asset.statusName", "asset.status.name"]);
  if (isInactiveLoanStatus(assetStatus)) return false;
  return true;
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
  const catName = firstString(record, [
    "catName",
    "categoryName",
    "category.name",
    "category.title",
    "category.catName",
    "category",
    "cat.name",
    "cat.title",
    "cat.catName",
    "cat",
    "asset.catName",
    "asset.categoryName",
    "asset.category.name",
    "asset.category.title",
    "asset.cat.name",
    "asset.cat.title",
    "fields.catName",
    "fields.category",
    "fields.categoryName",
  ]) ?? likelyCategoryFromFields(record);
  const categoryId = firstString(record, ["cid", "categoryId", "catId", "category.id", "cat.id", "asset.cid", "asset.categoryId"]);
  const locationId = firstString(record, ["clid", "locationId", "locId", "location.id", "asset.clid", "asset.locationId", "asset.location.id"]);
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
      categoryId,
      locationId,
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
      return data
        .flatMap((group) => Array.isArray(group) ? group : [group])
        .filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
    }
    return data.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
  }
  if (data != null && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nestedItems = ["data", "items", "results", "loans", "assets", "loanees", "subusers", "subUsers", "users", "categories"]
      .flatMap((key) => {
        const value = record[key];
        return Array.isArray(value) ? value : [];
      })
      .filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item));
    if (nestedItems.length > 0) return nestedItems;

    for (const key of ["data", "items", "results", "loans", "assets", "loanees", "subusers", "subUsers", "users", "categories"]) {
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

async function fetchOptionalReftabJson(endpoint: string, label: string): Promise<unknown | null> {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const fullUrl = `${REF_TAB_URL}/${cleanEndpoint}`;
  const headers = signReftabRequest(fullUrl, "GET");
  const res = await fetchWithTimeout(
    fullUrl,
    { method: "GET", headers, cache: "no-store" },
    REF_TAB_TIMEOUT_MS,
    label
  );
  if (res.status === 400 || res.status === 404 || res.status === 405) {
    console.info(`[reftab] Optional lookup skipped: label="${label}" endpoint="${cleanEndpoint}" status=${res.status}.`);
    return null;
  }
  if (!res.ok) {
    throw new Error(`${label} returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function safeLogBody(body: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!body) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const normalized = key.toLowerCase();
    out[key] = normalized.includes("secret") || normalized.includes("token") || normalized.includes("password")
      ? "[redacted]"
      : value;
  }
  return out;
}

function truncateForLog(value: string, max = 2_000): string {
  return value.length > max ? `${value.slice(0, max)}... [truncated ${value.length - max} char(s)]` : value;
}

async function sendReftabJson(endpoint: string, method: "POST" | "PUT" | "DELETE", label: string, body?: Record<string, unknown>): Promise<unknown> {
  if (!REF_TAB_PUBLIC || !REF_TAB_SECRET) {
    throw new Error("Reftab is not configured. Set REF_TAB_API_PUBLIC_KEY and REF_TAB_API_SECRET_KEY.");
  }

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const fullUrl = `${REF_TAB_URL}/${cleanEndpoint}`;
  const bodyText = body ? JSON.stringify(body) : "";
  const headers = signReftabRequest(fullUrl, method, bodyText);
  const res = await fetchWithTimeout(
    fullUrl,
    { method, headers, body: bodyText || undefined, cache: "no-store" },
    REF_TAB_TIMEOUT_MS,
    label
  );
  const text = await res.text();
  if (!res.ok) {
    console.error("[reftab] Write request failed", {
      label,
      method,
      endpoint: cleanEndpoint,
      status: res.status,
      requestBody: safeLogBody(body),
      responseBody: truncateForLog(text),
    });
    throw new Error(`${label} returned ${res.status}: ${text}`);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
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

async function buildUserAliasMap(): Promise<Map<string, UserAlias>> {
  const users = await prisma.user.findMany({
    select: {
      employeeId: true,
      id: true,
      displayName: true,
      email: true,
      upn: true,
      isActive: true,
      managerId: true,
      manager: {
        select: {
          employeeId: true,
          displayName: true,
          email: true,
        },
      },
    },
  });
  const aliases = new Map<string, UserAlias>();
  for (const user of users) {
    const alias = {
      id: user.id,
      employeeId: user.employeeId,
      displayName: user.displayName,
      email: user.email,
      isActive: user.isActive,
      managerId: user.managerId,
      managerEmployeeId: user.manager?.employeeId ?? null,
      managerName: user.manager?.displayName ?? null,
      managerEmail: user.manager?.email ?? null,
    };
    for (const value of [user.employeeId, user.email, user.upn]) {
      const key = normalizeKey(value);
      if (!key) continue;
      const existing = aliases.get(key);
      if (!existing || (!existing.isActive && alias.isActive)) {
        aliases.set(key, alias);
      }
    }
  }
  return aliases;
}

function resolveAssigneeUser(rawAssignee: string, aliases: Map<string, UserAlias>): UserAlias | null {
  return aliases.get(normalizeKey(rawAssignee) ?? "") ?? null;
}

function resolveAssigneeEmployeeId(rawAssignee: string, aliases: Map<string, UserAlias>): string | null {
  return resolveAssigneeUser(rawAssignee, aliases)?.employeeId ?? null;
}

function unresolvedAssignmentKey(employeeId: string, assetTag: string): string {
  return `${employeeId}\u0000${assetTag}`;
}

function unresolvedEmployeeIdForReftabAssignment(asset: RefTabAssignment, matchedUser?: UserAlias | null): string {
  const rawAssignee = asset.assigned_to_employee_id.trim();
  return matchedUser?.employeeId ?? (rawAssignee || `unmatched:${asset.asset_tag}`);
}

async function logUnresolvedReftabAssignment(asset: RefTabAssignment, aliases: Map<string, UserAlias>, matchedUser?: UserAlias | null): Promise<string> {
  const rawAssignee = asset.assigned_to_employee_id.trim();
  const employeeId = unresolvedEmployeeIdForReftabAssignment(asset, matchedUser);
  const employeeEmail = matchedUser?.email ?? (rawAssignee.includes("@") ? rawAssignee : null);
  const managerUser = resolveAssigneeUser(asset.managerEmployeeId ?? "", aliases) ?? resolveAssigneeUser(asset.managerEmail ?? "", aliases);
  const activeManager = managerUser?.isActive ? managerUser : null;
  const data = {
    employeeName: matchedUser?.displayName ?? (rawAssignee || "Unknown Reftab assignee"),
    employeeEmail,
    assetTag: asset.asset_tag,
    catName: asset.catName ?? null,
    serial: asset.serial ?? null,
    model: asset.title ?? asset.model ?? null,
    managerId: matchedUser?.managerId ?? activeManager?.id ?? null,
    managerEmployeeId: matchedUser?.managerEmployeeId ?? activeManager?.employeeId ?? null,
    managerName: matchedUser?.managerName ?? activeManager?.displayName ?? asset.managerName ?? asset.managerEmployeeId ?? null,
    managerEmail: matchedUser?.managerEmail ?? activeManager?.email ?? asset.managerEmail ?? null,
    source: "reftab_unmatched_assignee",
  };
  const existing = await prisma.unresolvedCollection.findFirst({
    where: { employeeId, assetTag: asset.asset_tag, status: { not: "RESOLVED" } },
    select: { id: true },
  });
  if (existing) {
    await prisma.unresolvedCollection.update({ where: { id: existing.id }, data });
  } else {
    await prisma.unresolvedCollection.upsert({
      where: {
        employeeId_assetTag_status: {
          employeeId,
          assetTag: asset.asset_tag,
          status: "UNRESOLVED",
        },
      },
      update: data,
      create: {
        employeeId,
        status: "UNRESOLVED",
        ...data,
      },
    });
  }
  return unresolvedAssignmentKey(employeeId, asset.asset_tag);
}

function addLoaneeAlias(map: Map<string, string>, id: unknown, email: string | undefined): void {
  const idKey = valueToString(id);
  const emailKey = normalizeKey(email);
  if (idKey && emailKey) map.set(idKey, emailKey);
}

function addLoaneeRecord(map: Map<string, ReftabLoanee>, id: unknown, loanee: ReftabLoanee): void {
  const idKey = valueToString(id);
  if (idKey) map.set(idKey, loanee);
}

function buildLoaneeMaps(loanees: ReftabLoanee[]): LoaneeMaps {
  const lnidToEmail = new Map<string, string>();
  const uidToEmail = new Map<string, string>();
  const lnidToLoanee = new Map<string, ReftabLoanee>();
  const uidToLoanee = new Map<string, ReftabLoanee>();
  for (const loanee of loanees) {
    addLoaneeAlias(lnidToEmail, loanee.lnid, loanee.email);
    addLoaneeAlias(uidToEmail, loanee.uid, loanee.email);
    addLoaneeRecord(lnidToLoanee, loanee.lnid, loanee);
    addLoaneeRecord(uidToLoanee, loanee.uid, loanee);
  }
  return { lnidToEmail, uidToEmail, lnidToLoanee, uidToLoanee };
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
      out.push(loaneeFromApiRecord(item));
    }
    if (list.length < limit) break;
    offset += limit;
  }

  console.info(`[reftab] Fetched ${out.length} loanee/user record(s).`);
  return out;
}

function loaneeFromApiRecord(record: Record<string, unknown>): ReftabLoanee {
  const nested = ["loanee", "data", "result", "item"].find((key) => {
    const value = getNestedLoose(record, key);
    return value != null && typeof value === "object" && !Array.isArray(value);
  });
  if (nested) return loaneeFromApiRecord(getNestedLoose(record, nested) as Record<string, unknown>);

  return {
    email: firstStringLoose(record, [
      "email",
      "mail",
      "emailAddress",
      "email_address",
      "loaneeEmail",
      "loanee_email",
      "user.email",
      "user.mail",
      "user.emailAddress",
      "loanee.email",
      "loanee.mail",
      "loanee.emailAddress",
    ]),
    uid: firstStringLoose(record, ["uid", "user.uid", "loanee.uid", "subuser.uid", "subUser.uid"]),
    employeeId: firstStringLoose(record, [
      "employeeId",
      "employee_id",
      "employeeID",
      "details.EmployeeNumber",
      "details.employeeNumber",
      "details.EmployeeId",
      "user.employeeId",
      "user.employee_id",
      "loanee.employeeId",
      "loanee.employee_id",
    ]),
    lnid: firstStringLoose(record, [
      "lnid",
      "loaneeId",
      "loanee_id",
      "loaneeID",
      "id",
      "_id",
      "loanee.lnid",
      "loanee.loaneeId",
      "loanee.id",
    ]),
    ...managerInfoFromRecord(record),
  };
}

function getLoanAssignee(loan: Record<string, unknown>, loaneeMaps: LoaneeMaps): string | undefined {
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

function resolveReftabAssigneeFromRecord(record: Record<string, unknown>, loaneeMaps: LoaneeMaps): string | undefined {
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

function loaneeFromRecord(record: Record<string, unknown>, loaneeMaps: LoaneeMaps): ReftabLoanee | undefined {
  for (const lnid of [
    firstString(record, ["lnid", "loanee.lnid", "loan.lnid"]),
    assigneeToMatchString(getNested(record, ASSIGNEE_FIELD)),
  ]) {
    if (lnid && loaneeMaps.lnidToLoanee.has(lnid)) return loaneeMaps.lnidToLoanee.get(lnid);
  }

  for (const uid of [
    firstString(record, ["loan_uid", "uid", "loanee.uid", "loan.loan_uid", "loan.uid"]),
    assigneeToMatchString(getNested(record, ASSIGNEE_FIELD)),
  ]) {
    if (uid && loaneeMaps.uidToLoanee.has(uid)) return loaneeMaps.uidToLoanee.get(uid);
  }

  return undefined;
}

function managerInfoFromLoanee(loanee: ReftabLoanee | undefined): ReftabManagerInfo {
  if (!loanee) return {};
  return {
    managerEmployeeId: loanee.managerEmployeeId,
    managerName: loanee.managerName,
    managerEmail: loanee.managerEmail,
  };
}

function pushLoanAsset(out: RefTabAssignment[], asset: Record<string, unknown>, fallbackAssignee: string, managerInfo: ReftabManagerInfo = {}): void {
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
    ...combineManagerInfo(managerInfo, managerInfoFromRecord(asset)),
    status: "out",
  });
}

function assignmentsFromLoan(loan: Record<string, unknown>, assignee: string, managerInfo: ReftabManagerInfo): RefTabAssignment[] {
  const out: RefTabAssignment[] = [];
  for (const key of ["assets", "items"]) {
    const value = loan[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item != null && typeof item === "object" && !Array.isArray(item)) {
        pushLoanAsset(out, item as Record<string, unknown>, assignee, managerInfo);
      } else {
        const tag = valueToString(item);
        if (tag) out.push({ asset_tag: tag, aid: tag, assigned_to_employee_id: assignee, ...managerInfo, status: "out" });
      }
    }
  }

  const aids = loan.aids;
  if (Array.isArray(aids)) {
    for (const aid of aids) {
      const tag = valueToString(aid);
      if (tag) out.push({ asset_tag: tag, aid: tag, assigned_to_employee_id: assignee, ...managerInfo, status: "out" });
    }
  }

  if (out.length === 0) pushLoanAsset(out, loan, assignee, managerInfo);
  return out;
}

function loanIdFromRecord(loan: Record<string, unknown>): string | undefined {
  return firstString(loan, ["loanId", "loan_id", "lid", "id", "loan.id", "loan.lid", "_id"]);
}

function sameReftabAsset(asset: RefTabAssignment, target: { assetTag: string; aid?: string | null }): boolean {
  const assetTag = normalizeKey(asset.asset_tag);
  const aid = normalizeKey(asset.aid);
  const targetAssetTag = normalizeKey(target.assetTag);
  const targetAid = normalizeKey(target.aid);
  return Boolean(
    (targetAssetTag && assetTag === targetAssetTag) ||
    (targetAid && aid === targetAid) ||
    (targetAid && assetTag === targetAid) ||
    (targetAssetTag && aid === targetAssetTag)
  );
}

async function findCurrentLoanForAsset(target: { assetTag: string; aid?: string | null }): Promise<{ loanId: string; assignment: RefTabAssignment } | null> {
  const loaneeMaps = buildLoaneeMaps(await fetchAllReftabLoanees());
  const limit = ASSETS_LIMIT;
  let offset = 0;

  while (offset < 500_000) {
    const loans = listFromResponse(await fetchReftabJson(`loans?limit=${limit}&offset=${offset}&status=out`, `Reftab loans offset ${offset}`));
    if (loans.length === 0) break;

    for (const loan of loans) {
      if (!isCurrentLoanRecord(loan)) continue;
      const loanId = loanIdFromRecord(loan);
      const assignee = getLoanAssignee(loan, loaneeMaps);
      if (!loanId || !assignee) continue;
      const managerInfo = combineManagerInfo(
        managerInfoFromLoanee(loaneeFromRecord(loan, loaneeMaps)),
        managerInfoFromRecord(loan)
      );
      const assignment = assignmentsFromLoan(loan, assignee, managerInfo).find((item) => sameReftabAsset(item, target));
      if (assignment) return { loanId, assignment };
    }

    if (loans.length < limit) break;
    offset += limit;
  }

  return null;
}

function loaneeMatches(loanee: ReftabLoanee, user: { employeeId: string; email: string }): boolean {
  const email = normalizeKey(user.email);
  const employeeId = normalizeKey(user.employeeId);
  const loaneeEmail = normalizeKey(loanee.email);
  const loaneeEmployeeId = normalizeKey(valueToString(loanee.employeeId));
  if (email && loaneeEmail === email) return true;
  return Boolean(loaneeCheckoutRef(loanee) && employeeId && loaneeEmployeeId === employeeId);
}

function loaneeCheckoutRef(loanee: ReftabLoanee | null | undefined): ReftabCheckoutRef | undefined {
  const lnid = valueToString(loanee?.lnid);
  if (lnid) return { field: "lnid", value: lnid };
  const uid = valueToString(loanee?.uid);
  if (uid) return { field: "loan_uid", value: uid };
  return undefined;
}

function loaneeForLog(loanee: ReftabLoanee | null | undefined): Record<string, unknown> | null {
  if (!loanee) return null;
  const checkoutRef = loaneeCheckoutRef(loanee);
  return {
    email: loanee.email,
    employeeId: valueToString(loanee.employeeId),
    lnid: valueToString(loanee.lnid),
    uid: valueToString(loanee.uid),
    checkoutField: checkoutRef?.field,
    checkoutValue: checkoutRef?.value,
  };
}

function loaneeWithIdFromResponse(data: unknown, user: { employeeId: string; email: string }): ReftabLoanee | null {
  if (data == null) return null;
  const email = normalizeKey(user.email);
  const employeeId = normalizeKey(user.employeeId);
  const listedRecords = listFromResponse(data);
  const records = listedRecords.length > 0 ? listedRecords : collectRecords(data);
  const matchingRecords = records.filter((record) => recordContainsNormalizedValue(record, email) || recordContainsNormalizedValue(record, employeeId));
  const candidates = (matchingRecords.length > 0 ? matchingRecords : records).map(loaneeFromApiRecord);
  const match = candidates.find((loanee) => loaneeMatches(loanee, user) && loaneeCheckoutRef(loanee)) ?? null;
  console.info("[reftab] Optional loanee lookup scan", {
    email: user.email,
    employeeId: user.employeeId,
    listedRecordCount: listedRecords.length,
    scannedRecordCount: records.length,
    matchingRecordCount: matchingRecords.length,
    candidateCount: candidates.length,
    selected: loaneeForLog(match),
    sampleCandidates: candidates.slice(0, 3).map(loaneeForLog),
  });
  return match;
}

async function findLoaneeForUser(user: { employeeId: string; email: string }): Promise<ReftabLoanee | null> {
  const loanees = await fetchAllReftabLoanees();
  const matches = loanees.filter((loanee) => loaneeMatches(loanee, user));
  const selected = matches.find((loanee) => loaneeCheckoutRef(loanee)) ?? matches[0] ?? null;
  console.info("[reftab] /loanees match scan", {
    email: user.email,
    normalizedEmail: normalizeKey(user.email),
    employeeId: user.employeeId,
    fetchedCount: loanees.length,
    matchCount: matches.length,
    checkoutableMatchCount: matches.filter((loanee) => loaneeCheckoutRef(loanee)).length,
    selected: loaneeForLog(selected),
    sampleMatches: matches.slice(0, 5).map(loaneeForLog),
  });
  return selected;
}

async function lookupLoaneeForUser(user: { employeeId: string; email: string }): Promise<ReftabLoanee | null> {
  const email = encodeURIComponent(user.email);
  const employeeId = encodeURIComponent(user.employeeId);
  for (const template of REF_TAB_LOANEE_LOOKUP_ENDPOINTS) {
    const endpoint = template
      .replace(/\{email\}/g, email)
      .replace(/\{employeeId\}/g, employeeId)
      .replace(/\{uid\}/g, employeeId);
    const data = await fetchOptionalReftabJson(endpoint, `Reftab loanee lookup ${user.email || user.employeeId}`);
    const loanee = loaneeWithIdFromResponse(data, user);
    if (loanee) return loanee;
  }
  return null;
}

async function createReftabLoanee(user: { employeeId: string; email: string; displayName?: string }): Promise<ReftabLoanee> {
  const name = user.displayName?.trim() || user.email || user.employeeId;
  const created = await sendReftabJson(REF_TAB_CREATE_LOANEE_ENDPOINT, "POST", `Reftab create loanee ${user.email || user.employeeId}`, {
    title: name,
    name,
    email: user.email,
    uid: user.employeeId,
  });
  if (created != null && typeof created === "object" && !Array.isArray(created)) {
    return loaneeFromApiRecord(created as Record<string, unknown>);
  }
  return {};
}

async function checkoutRefForUser(user: { employeeId: string; email: string; displayName?: string }): Promise<ReftabCheckoutRef> {
  const existingLoanee = await findLoaneeForUser(user);
  const existingCheckoutRef = loaneeCheckoutRef(existingLoanee);
  if (existingCheckoutRef) {
    console.info("[reftab] Selected checkout ref from /loanees", {
      email: user.email,
      checkoutField: existingCheckoutRef.field,
      checkoutValue: existingCheckoutRef.value,
      loanee: loaneeForLog(existingLoanee),
    });
    return existingCheckoutRef;
  }

  const lookedUpLoanee = await lookupLoaneeForUser(user);
  const lookedUpCheckoutRef = loaneeCheckoutRef(lookedUpLoanee);
  if (lookedUpCheckoutRef) {
    console.info("[reftab] Selected checkout ref from optional lookup", {
      email: user.email,
      checkoutField: lookedUpCheckoutRef.field,
      checkoutValue: lookedUpCheckoutRef.value,
      loanee: loaneeForLog(lookedUpLoanee),
    });
    return lookedUpCheckoutRef;
  }

  if (!REF_TAB_CREATE_MISSING_LOANEES) {
    throw new Error(
      `Could not find a Reftab checkout id (lnid or subuser loan_uid) for ${user.email || user.employeeId}. Verify the user's email exists in the /loanees response.`
    );
  }

  const createdLoanee = await createReftabLoanee(user);
  const createdCheckoutRef = loaneeCheckoutRef(createdLoanee);
  if (createdCheckoutRef) {
    console.info("[reftab] Selected checkout ref from created loanee", {
      email: user.email,
      checkoutField: createdCheckoutRef.field,
      checkoutValue: createdCheckoutRef.value,
      loanee: loaneeForLog(createdLoanee),
    });
    return createdCheckoutRef;
  }

  const refreshedLoanee = await findLoaneeForUser(user);
  const refreshedCheckoutRef = loaneeCheckoutRef(refreshedLoanee);
  if (refreshedCheckoutRef) {
    console.info("[reftab] Selected checkout ref after loanee refresh", {
      email: user.email,
      checkoutField: refreshedCheckoutRef.field,
      checkoutValue: refreshedCheckoutRef.value,
      loanee: loaneeForLog(refreshedLoanee),
    });
    return refreshedCheckoutRef;
  }

  throw new Error(`Could not find or create a Reftab checkout id (lnid or subuser loan_uid) for ${user.email || user.employeeId}.`);
}

function checkoutBody(ref: ReftabCheckoutRef, aid: string, note: string): Record<string, unknown> {
  return {
    [ref.field]: numericRequiredId(ref.value, `Reftab checkout ${ref.field}`),
    aids: [aid],
    notes: note,
  };
}

async function checkoutReftabAsset(assetTag: string, aid: string, checkoutRef: ReftabCheckoutRef, note: string): Promise<void> {
  const body = checkoutBody(checkoutRef, aid, note);
  console.info("[reftab] Checking out asset", {
    assetTag,
    aid,
    checkoutField: checkoutRef.field,
    checkoutValue: checkoutRef.value,
    requestBody: safeLogBody(body),
  });
  await sendReftabJson(REF_TAB_CHECKOUT_ENDPOINT, "POST", `Reftab check-out asset ${assetTag}`, body);
}

function checkinEndpoint(loanId: string): string {
  return REF_TAB_CHECKIN_ENDPOINT_TEMPLATE
    .replace(/\{loanId\}/g, encodeURIComponent(loanId))
    .replace(/\{id\}/g, encodeURIComponent(loanId));
}

export type ReftabOwnerReconciliationInput = {
  assetTag: string;
  aid?: string | null;
  newOwnerEmployeeId: string;
  newOwnerEmail: string;
  newOwnerName?: string;
  note?: string;
};

function createdAssetIdFromResponse(data: unknown): string | undefined {
  if (data == null || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const asset = data != null && typeof record.asset === "object" && !Array.isArray(record.asset)
    ? record.asset as Record<string, unknown>
    : record;
  return firstString(asset, ["aid", "id", "assetId", "asset_id", "asset.aid", "asset.id"]);
}

export async function reconcileReftabAssetOwner(input: ReftabOwnerReconciliationInput): Promise<{ loanId: string; loaneeId: string }> {
  const currentLoan = await findCurrentLoanForAsset({ assetTag: input.assetTag, aid: input.aid });
  if (!currentLoan) {
    throw new Error(`Could not find an active Reftab loan for asset ${input.assetTag}. Run Reftab sync and try again.`);
  }

  const checkoutRef = await checkoutRefForUser({ employeeId: input.newOwnerEmployeeId, email: input.newOwnerEmail, displayName: input.newOwnerName });

  const aid = input.aid ?? currentLoan.assignment.aid ?? input.assetTag;
  const note = input.note ?? `Owner reconciliation approved from NinjaOne for ${input.assetTag}.`;
  await sendReftabJson(checkinEndpoint(currentLoan.loanId), "POST", `Reftab check-in loan ${currentLoan.loanId}`, {
    aids: [aid],
    notes: note,
  });
  await checkoutReftabAsset(input.assetTag, aid, checkoutRef, note);

  return { loanId: currentLoan.loanId, loaneeId: checkoutRef.value };
}

export type ReftabCreateAndAssignInput = {
  assetTag: string;
  serial?: string | null;
  title?: string | null;
  model?: string | null;
  categoryId?: string | null;
  newOwnerEmployeeId: string;
  newOwnerEmail: string;
  newOwnerName?: string;
  note?: string;
};

function parseDetailsJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function categoryIdFromDetailsJson(value: string | null | undefined): string | undefined {
  const details = parseDetailsJson(value);
  return firstString(details, ["categoryId", "cid", "catId", "category.id", "cat.id"]);
}

function locationIdFromDetailsJson(value: string | null | undefined): string | undefined {
  const details = parseDetailsJson(value);
  return firstString(details, ["locationId", "clid", "clId", "locId", "location.id", "asset.locationId", "asset.clid"]);
}

function tokenSet(value: string | null | undefined): Set<string> {
  const tokens = new Set<string>();
  for (const token of value?.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (["the", "and", "for", "with", "asset", "device"].includes(token)) continue;
    if (token.length >= 3 || ["dt", "lt", "pc", "tb"].includes(token)) tokens.add(token);
    if (token.length > 4 && token.endsWith("s")) tokens.add(token.slice(0, -1));
    if (token === "dt" || token === "pc") tokens.add("desktop");
    if (token === "lt" || token === "ltp") tokens.add("laptop");
    if (token === "tb") tokens.add("tablet");
  }
  return tokens;
}

function tokenOverlapScore(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const token of a) {
    if (b.has(token)) score += 1;
  }
  return score;
}

function numericId(value: string | undefined): number | string | undefined {
  if (!value) return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}

function numericRequiredId(value: string | undefined, label: string): number {
  if (!value) throw new Error(`${label} is missing.`);
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be numeric.`);
  return Number(value);
}

function addServiceTagField(body: Record<string, unknown>, input: ReftabCreateAndAssignInput): void {
  const serviceTag = input.serial ?? input.assetTag;
  if (!serviceTag || !REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD) return;
  body[REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD] = serviceTag;
  body.fields = {
    ...(body.fields != null && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields as Record<string, unknown> : {}),
    [REF_TAB_CREATE_ASSET_SERVICE_TAG_FIELD]: serviceTag,
  };
}

function explicitCreateAssetCategoryId(input: ReftabCreateAndAssignInput): string | undefined {
  const tokens = tokenSet([input.title, input.model, input.assetTag, input.serial].filter(Boolean).join(" "));
  if ((tokens.has("tb") || tokens.has("tablet")) && REF_TAB_CREATE_ASSET_TABLET_CATEGORY_ID) {
    return REF_TAB_CREATE_ASSET_TABLET_CATEGORY_ID;
  }
  if ((tokens.has("lt") || tokens.has("ltp") || tokens.has("laptop")) && REF_TAB_CREATE_ASSET_LAPTOP_CATEGORY_ID) {
    return REF_TAB_CREATE_ASSET_LAPTOP_CATEGORY_ID;
  }
  if ((tokens.has("pc") || tokens.has("dt") || tokens.has("desktop")) && REF_TAB_CREATE_ASSET_DESKTOP_CATEGORY_ID) {
    return REF_TAB_CREATE_ASSET_DESKTOP_CATEGORY_ID;
  }
  return undefined;
}

function categoryFromRecord(record: Record<string, unknown>): { categoryId: string; name: string } | null {
  const categoryId = firstString(record, ["cid", "id", "categoryId", "catId", "category.id", "cat.id"]);
  const name = firstString(record, ["name", "title", "catName", "categoryName", "category.name", "cat.name"]) ?? categoryId;
  if (!categoryId || !name) return null;
  return { categoryId, name };
}

export async function fetchReftabCategories(): Promise<Array<{ categoryId: string; name: string }>> {
  const limit = 500;
  let offset = 0;
  const categories: Array<{ categoryId: string; name: string }> = [];

  while (offset < 50_000) {
    let list: Record<string, unknown>[];
    try {
      list = listFromResponse(await fetchReftabJson(`categories?limit=${limit}&offset=${offset}`, `Reftab categories offset ${offset}`));
    } catch (e) {
      console.warn(`[reftab] Category fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    if (list.length === 0) break;
    for (const item of list) {
      const category = categoryFromRecord(item);
      if (category) categories.push(category);
    }
    if (list.length < limit) break;
    offset += limit;
  }

  return categories;
}

async function inferCreateAssetCategoryIdFromReftab(input: ReftabCreateAndAssignInput): Promise<string | undefined> {
  const inputTokens = tokenSet([input.title, input.model, input.assetTag, input.serial].filter(Boolean).join(" "));
  const ranked = (await fetchReftabCategories())
    .map((category) => ({
      ...category,
      score: tokenOverlapScore(inputTokens, tokenSet(category.name)),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked.find((category) => category.score > 0)?.categoryId;
}

async function inferCreateAssetCategoryId(input: ReftabCreateAndAssignInput): Promise<string | undefined> {
  if (input.categoryId) return input.categoryId;

  const explicitCategoryId = explicitCreateAssetCategoryId(input);
  if (explicitCategoryId) return explicitCategoryId;

  const rows = await prisma.equipmentAssignment.findMany({
    select: {
      catName: true,
      title: true,
      model: true,
      assetTag: true,
      detailsJson: true,
    },
  });
  const inputTokens = tokenSet([input.title, input.model, input.assetTag, input.serial].filter(Boolean).join(" "));
  const categoryScores = new Map<string, { categoryId: string; catName: string | null; count: number; score: number }>();

  for (const row of rows) {
    const categoryId = categoryIdFromDetailsJson(row.detailsJson);
    if (!categoryId) continue;

    const existing = categoryScores.get(categoryId) ?? { categoryId, catName: row.catName, count: 0, score: 0 };
    existing.count += 1;
    const rowTokens = tokenSet([row.title, row.model, row.assetTag, row.catName].filter(Boolean).join(" "));
    existing.score += tokenOverlapScore(inputTokens, rowTokens);

    const categoryTokens = tokenSet(row.catName);
    existing.score += tokenOverlapScore(inputTokens, categoryTokens) * 2;
    categoryScores.set(categoryId, existing);
  }

  const ranked = Array.from(categoryScores.values()).sort((a, b) => b.score - a.score || b.count - a.count);
  const syncedCategoryId = ranked[0]?.categoryId;
  if (syncedCategoryId) return syncedCategoryId;

  const liveCategoryId = await inferCreateAssetCategoryIdFromReftab(input);
  return liveCategoryId ?? (REF_TAB_CREATE_ASSET_CATEGORY_ID || undefined);
}

async function inferCreateAssetLocationId(input: ReftabCreateAndAssignInput): Promise<string | undefined> {
  const rows = await prisma.equipmentAssignment.findMany({
    select: {
      locationName: true,
      title: true,
      model: true,
      assetTag: true,
      detailsJson: true,
    },
  });
  const inputTokens = tokenSet([input.title, input.model, input.assetTag, input.serial].filter(Boolean).join(" "));
  const locationScores = new Map<string, { locationId: string; locationName: string | null; count: number; score: number }>();

  for (const row of rows) {
    const locationId = locationIdFromDetailsJson(row.detailsJson);
    if (!locationId) continue;

    const existing = locationScores.get(locationId) ?? { locationId, locationName: row.locationName, count: 0, score: 0 };
    existing.count += 1;
    const rowTokens = tokenSet([row.title, row.model, row.assetTag, row.locationName].filter(Boolean).join(" "));
    existing.score += tokenOverlapScore(inputTokens, rowTokens);

    const locationTokens = tokenSet(row.locationName);
    existing.score += tokenOverlapScore(inputTokens, locationTokens) * 2;
    locationScores.set(locationId, existing);
  }

  const ranked = Array.from(locationScores.values()).sort((a, b) => b.score - a.score || b.count - a.count);
  return REF_TAB_CREATE_ASSET_LOCATION_ID || ranked[0]?.locationId;
}

export async function createAndAssignReftabAsset(input: ReftabCreateAndAssignInput): Promise<{ aid: string; loaneeId: string }> {
  const checkoutRef = await checkoutRefForUser({ employeeId: input.newOwnerEmployeeId, email: input.newOwnerEmail, displayName: input.newOwnerName });

  const note = input.note ?? `Created from NinjaOne reconciliation for ${input.assetTag}.`;
  const createBody: Record<string, unknown> = {
    id: input.assetTag,
    title: input.title ?? input.model ?? input.serial ?? input.assetTag,
    serial: input.serial ?? undefined,
    notes: note,
  };
  addServiceTagField(createBody, input);
  if (input.model) createBody.model = input.model;
  const categoryId = await inferCreateAssetCategoryId(input);
  const numericCategoryId = numericId(categoryId);
  if (numericCategoryId === undefined) {
    throw new Error(
      "Could not determine a Reftab category id for this new asset. Set REF_TAB_CREATE_ASSET_DESKTOP_CATEGORY_ID, REF_TAB_CREATE_ASSET_LAPTOP_CATEGORY_ID, REF_TAB_CREATE_ASSET_TABLET_CATEGORY_ID, or REF_TAB_CREATE_ASSET_CATEGORY_ID."
    );
  }
  if (numericCategoryId !== undefined) createBody.cid = numericCategoryId;
  const locationId = await inferCreateAssetLocationId(input);
  const numericLocationId = numericId(locationId);
  if (numericLocationId !== undefined) createBody.clid = numericLocationId;

  const created = await sendReftabJson(REF_TAB_CREATE_ASSET_ENDPOINT, "POST", `Reftab create asset ${input.assetTag}`, createBody);
  const aid = createdAssetIdFromResponse(created) ?? input.assetTag;
  await checkoutReftabAsset(input.assetTag, aid, checkoutRef, note);

  return { aid, loaneeId: checkoutRef.value };
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
    const managerInfo = combineManagerInfo(
      managerInfoFromLoanee(loaneeFromRecord(asset, loaneeMaps)),
      managerInfoFromRecord(asset)
    );

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
      ...managerInfo,
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
  let skippedInactive = 0;
  const out: RefTabAssignment[] = [];
  for (const loan of allLoans) {
    if (!isCurrentLoanRecord(loan)) {
      skippedInactive++;
      continue;
    }
    const assignee = getLoanAssignee(loan, loaneeMaps);
    if (!assignee) {
      skippedMissingAssignee++;
      continue;
    }
    const managerInfo = combineManagerInfo(
      managerInfoFromLoanee(loaneeFromRecord(loan, loaneeMaps)),
      managerInfoFromRecord(loan)
    );
    const before = out.length;
    out.push(...assignmentsFromLoan(loan, assignee, managerInfo));
    if (out.length === before) skippedMissingAsset++;
  }

  console.info(`[reftab] Fetched ${allLoans.length} loan(s); mapped ${out.length} checked-out asset assignment(s); skippedInactive=${skippedInactive}; skippedMissingAssignee=${skippedMissingAssignee}; skippedMissingAsset=${skippedMissingAsset}.`);
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
  let skippedInactive = 0;
  const out: RefTabAssignment[] = [];
  for (const asset of allAssets) {
    if (!isCurrentLoanAsset(asset)) {
      skippedInactive++;
      continue;
    }
    const match = resolveReftabAssigneeFromRecord(asset, loaneeMaps);
    if (!match) {
      skippedMissingAssignee++;
      continue;
    }
    const managerInfo = combineManagerInfo(
      managerInfoFromLoanee(loaneeFromRecord(asset, loaneeMaps)),
      managerInfoFromRecord(asset)
    );

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
      ...managerInfo,
      status: details.statusName,
    });
  }
  console.info(`[reftab] Fetched ${allAssets.length} checked-out asset(s); ${out.length} had a usable asset tag and loanee; skippedInactive=${skippedInactive}; skippedMissingAssignee=${skippedMissingAssignee}.`);
  return out;
}

export type ReftabSyncResult = {
  upserted: number;
  skippedCollected: number;
  skippedUnmatchedAssignee: number;
  unmatchedLogged: number;
  staleAssignmentsRemoved: number;
  staleUnresolvedResolved: number;
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
  let unmatchedLogged = 0;
  let staleAssignmentsRemoved = 0;
  let staleUnresolvedResolved = 0;
  const currentUnresolvedKeys = new Set<string>();

  // Get all collected asset+employee combinations
  const collectedEvents = await prisma.collectionEvent.findMany({
    where: { status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] } },
    select: { assetTag: true, assignedToEmployeeId: true },
  });
  const collectedSet = new Set(
    collectedEvents.map((ce) => `${ce.assetTag}-${ce.assignedToEmployeeId}`)
  );
  const collectedAssetTags = Array.from(new Set(collectedEvents.map((ce) => ce.assetTag)));
  for (let i = 0; i < collectedAssetTags.length; i += 500) {
    await prisma.unresolvedCollection.updateMany({
      where: {
        status: "UNRESOLVED",
        assetTag: { in: collectedAssetTags.slice(i, i + 500) },
      },
      data: {
        status: "RESOLVED",
        resolvedAt: now,
      },
    });
  }

  const currentAssetTags = Array.from(new Set(assets.map((asset) => asset.asset_tag).filter(Boolean)));
  const currentAssignmentKeys = new Set<string>();

  for (const asset of assets) {
    const resolvedUser = resolveAssigneeUser(asset.assigned_to_employee_id, userAliases);
    const resolvedEmployeeId = resolvedUser?.employeeId ?? null;
    if (resolvedEmployeeId && resolvedUser?.isActive) currentAssignmentKeys.add(`${asset.asset_tag}-${resolvedEmployeeId}`);

    if (collectedAssetTags.includes(asset.asset_tag)) {
      skippedCollected++;
      continue;
    }

    if (!resolvedUser || !resolvedUser.isActive) {
      skippedUnmatchedAssignee++;
      currentUnresolvedKeys.add(await logUnresolvedReftabAssignment(asset, userAliases, resolvedUser));
      unmatchedLogged++;
      console.warn(`[reftab] Logging asset ${asset.asset_tag} as unresolved: assignee "${asset.assigned_to_employee_id}" does not match an active Entra user.`);
      continue;
    }

    const activeEmployeeId = resolvedUser.employeeId;
    const key = `${asset.asset_tag}-${activeEmployeeId}`;
    if (collectedSet.has(key)) {
      skippedCollected++;
      continue;
    }

    await prisma.equipmentAssignment.upsert({
      where: {
        assetTag_assignedToEmployeeId: {
          assetTag: asset.asset_tag,
          assignedToEmployeeId: activeEmployeeId,
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
        assignedToEmployeeId: activeEmployeeId,
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
        assignedToEmployeeId: activeEmployeeId,
        source: "ref_tab",
        lastSyncedAt: now,
      },
    });
    upserted++;
  }

  if (currentAssetTags.length > 0) {
    const staleAssignments = await prisma.equipmentAssignment.findMany({
      where: { source: "ref_tab" },
      select: { id: true, assetTag: true, assignedToEmployeeId: true },
    });
    const staleAssignmentIds = staleAssignments
      .filter((assignment) => !currentAssignmentKeys.has(`${assignment.assetTag}-${assignment.assignedToEmployeeId}`))
      .map((assignment) => assignment.id);
    for (let i = 0; i < staleAssignmentIds.length; i += 500) {
      const result = await prisma.equipmentAssignment.deleteMany({
        where: { id: { in: staleAssignmentIds.slice(i, i + 500) } },
      });
      staleAssignmentsRemoved += result.count;
    }

    const staleUnresolved = await prisma.unresolvedCollection.findMany({
      where: {
        status: { not: "RESOLVED" },
      },
      select: { id: true, employeeId: true, assetTag: true },
    });
    const staleUnresolvedIds = staleUnresolved
      .filter((item) => !currentUnresolvedKeys.has(unresolvedAssignmentKey(item.employeeId, item.assetTag)))
      .map((item) => item.id);
    for (let i = 0; i < staleUnresolvedIds.length; i += 500) {
      const ids = staleUnresolvedIds.slice(i, i + 500);
      const result = await prisma.unresolvedCollection.updateMany({
        where: { id: { in: ids } },
        data: { status: "RESOLVED", resolvedAt: now },
      });
      staleUnresolvedResolved += result.count;
      await prisma.unresolvedCollectionAudit.createMany({
        data: ids.map((id) => ({
          unresolvedCollectionId: id,
          action: "AUTO_RESOLVED_REFTAB_SYNC",
          newStatus: "RESOLVED",
          note: "Resolved automatically because the asset no longer appears as a current Reftab loan assigned to a disabled or missing Entra user.",
        })),
      });
    }
  }

  const result = { upserted, skippedCollected, skippedUnmatchedAssignee, unmatchedLogged, staleAssignmentsRemoved, staleUnresolvedResolved, total: assets.length };
  console.info(`[reftab] Sync complete: total=${result.total}, upserted=${result.upserted}, skippedCollected=${result.skippedCollected}, skippedUnmatchedAssignee=${result.skippedUnmatchedAssignee}, unmatchedLogged=${result.unmatchedLogged}, staleAssignmentsRemoved=${result.staleAssignmentsRemoved}, staleUnresolvedResolved=${result.staleUnresolvedResolved}.`);
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
