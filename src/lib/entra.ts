/**
 * Microsoft Entra ID (Azure AD) integration via Microsoft Graph API.
 * Uses client credentials flow (application permissions).
 * Required permissions: User.Read.All, Directory.Read.All
 */

import { prisma } from "./db";
import { fetchWithTimeout } from "./fetch-timeout";

const TENANT_ID = (process.env.AZURE_AD_TENANT_ID ?? "").trim();
const CLIENT_ID = (process.env.AZURE_AD_CLIENT_ID ?? "").trim();
const CLIENT_SECRET = (process.env.AZURE_AD_CLIENT_SECRET ?? "").trim();
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_TIMEOUT_MS = Math.max(Number(process.env.GRAPH_REQUEST_TIMEOUT_MS) || 30_000, 5_000);

type GraphUser = {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  employeeId: string | null;
  accountEnabled: boolean;
  manager?: { id?: string } | null;
};

type GraphResponse<T> = {
  value: T[];
  "@odata.nextLink"?: string;
};

/** Acquire a token using the client credentials flow. */
async function getAccessToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, GRAPH_TIMEOUT_MS, "Graph token request");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to acquire token: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/** Fetch all users and their manager links from Microsoft Graph with pagination. */
async function fetchAllGraphUsers(token: string): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let url: string | null =
    `${GRAPH_BASE}/users?$select=id,displayName,mail,userPrincipalName,employeeId,accountEnabled&$expand=manager($select=id)&$top=100`;

  while (url) {
    const res: Response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}` },
    }, GRAPH_TIMEOUT_MS, "Graph /users request");
    if (!res.ok) {
      throw new Error(`Graph /users failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GraphResponse<GraphUser>;
    users.push(...data.value);
    url = data["@odata.nextLink"] ?? null;
  }
  return users;
}

export type SyncResult = {
  created: number;
  updated: number;
  deactivated: number;
  managersWithReports: number;
  reportLinksUpdated: number;
  directReportFetchFailures: number;
  total: number;
};

/** Check if Entra integration is configured. */
export function isEntraConfigured(): boolean {
  return !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET);
}

/**
 * Full sync: pull all users from Entra, upsert into local User table,
 * then resolve manager relationships from the expanded Graph manager link.
 */
export async function syncEntraToDb(): Promise<SyncResult> {
  if (!isEntraConfigured()) {
    throw new Error("Entra is not configured. Set AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET.");
  }

  const token = await getAccessToken();
  const graphUsers = await fetchAllGraphUsers(token);
  const now = new Date();

  let created = 0;
  let updated = 0;
  let deactivated = 0;
  let managersWithReports = 0;
  let reportLinksUpdated = 0;
  let directReportFetchFailures = 0;

  // Map Graph id → employeeId for manager relationship resolution.
  const graphIdToEmployeeId = new Map<string, string>();
  for (const gu of graphUsers) {
    const empId = gu.employeeId || gu.userPrincipalName;
    graphIdToEmployeeId.set(gu.id, empId);
  }

  // 1) Upsert all users (without manager for now)
  for (const gu of graphUsers) {
    const empId = gu.employeeId || gu.userPrincipalName;
    const existing = await prisma.user.findUnique({ where: { employeeId: empId } });
    if (existing) {
      await prisma.user.update({
        where: { employeeId: empId },
        data: {
          displayName: gu.displayName,
          email: gu.mail ?? gu.userPrincipalName,
          upn: gu.userPrincipalName,
          isActive: gu.accountEnabled,
          isManager: false,
          managerId: null,
          lastSyncedAt: now,
        },
      });
      if (!gu.accountEnabled) deactivated++;
      updated++;
    } else {
      await prisma.user.create({
        data: {
          employeeId: empId,
          displayName: gu.displayName,
          email: gu.mail ?? gu.userPrincipalName,
          upn: gu.userPrincipalName,
          isActive: gu.accountEnabled,
          lastSyncedAt: now,
        },
      });
      created++;
    }
  }

  // 2) Resolve manager relationships from each user's expanded manager link.
  const managerIdsWithReports = new Set<string>();
  for (const gu of graphUsers) {
    const managerGraphId = gu.manager?.id;
    if (!managerGraphId) continue;
    const reportEmpId = gu.employeeId || gu.userPrincipalName;
    const managerEmpId = graphIdToEmployeeId.get(managerGraphId);
    if (!managerEmpId || managerEmpId === reportEmpId) continue;

    const manager = await prisma.user.findUnique({
      where: { employeeId: managerEmpId },
      select: { id: true },
    });
    if (!manager) continue;

    // Mark this user as a manager
    await prisma.user.update({
      where: { employeeId: managerEmpId },
      data: { isManager: true },
    });
    managerIdsWithReports.add(managerEmpId);

    const result = await prisma.user.updateMany({
      where: { employeeId: reportEmpId },
      data: { managerId: manager.id },
    });
    reportLinksUpdated += result.count;
  }
  managersWithReports = managerIdsWithReports.size;

  const result = { created, updated, deactivated, managersWithReports, reportLinksUpdated, directReportFetchFailures, total: graphUsers.length };
  console.info(`[entra] Sync complete: ${JSON.stringify(result)}.`);
  return result;
}
