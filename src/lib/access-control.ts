import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getCurrentUser, type AuthUser } from "./auth";
import { configuredFlag, configuredIds } from "./access-config";
import { isSSOConfigured } from "./auth-options";

export type PortalRole =
  | "manager"
  | "admin"
  | "it"
  | "reconciler"
  | "executive"
  | "account-support";

export type PortalModule =
  | "equipment"
  | "reconciliation"
  | "organization-analytics"
  | "account-remediation";

export type AccessProfile = {
  user: AuthUser;
  roles: PortalRole[];
  modules: PortalModule[];
  isAdmin: boolean;
  canCloseOut: boolean;
  canReconcile: boolean;
  canViewOrganizationAnalytics: boolean;
  canManageAccountRemediation: boolean;
};

function intersects(values: string[], configured: string[]): boolean {
  if (configured.length === 0) return false;
  const normalized = new Set(values.map((value) => value.toLowerCase()));
  return configured.some((value) => normalized.has(value));
}

function employeeMatches(employeeId: string, envName: string): boolean {
  return configuredIds(envName).includes(employeeId.toLowerCase());
}

async function requestGroups(req?: NextRequest): Promise<string[]> {
  if (!req || !isSSOConfigured()) return [];
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const groups = (token as Record<string, unknown> | null)?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter((group): group is string => typeof group === "string").map((group) => group.toLowerCase());
}

export async function getAccessProfile(req?: NextRequest): Promise<AccessProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const groups = await requestGroups(req);
  const developmentManagerFallback =
    process.env.NODE_ENV !== "production" &&
    configuredFlag("ALLOW_MANAGER_ADMIN_FALLBACK", true);

  const isAdmin =
    employeeMatches(user.employeeId, "ADMIN_EMPLOYEE_IDS") ||
    intersects(groups, configuredIds("ADMIN_GROUP_IDS")) ||
    (developmentManagerFallback && user.isManager);
  const isIt =
    isAdmin ||
    employeeMatches(user.employeeId, "IT_EMPLOYEE_IDS") ||
    intersects(groups, configuredIds("IT_GROUP_IDS"));
  const canReconcile =
    isIt ||
    employeeMatches(user.employeeId, "RECONCILIATION_EMPLOYEE_IDS") ||
    intersects(groups, configuredIds("RECONCILIATION_GROUP_IDS"));
  const canViewOrganizationAnalytics =
    isAdmin ||
    employeeMatches(user.employeeId, "EXECUTIVE_EMPLOYEE_IDS") ||
    intersects(groups, configuredIds("EXECUTIVE_GROUP_IDS"));
  const canManageAccountRemediation =
    isIt ||
    employeeMatches(user.employeeId, "ACCOUNT_SUPPORT_EMPLOYEE_IDS") ||
    intersects(groups, configuredIds("ACCOUNT_SUPPORT_GROUP_IDS"));

  const roles = new Set<PortalRole>();
  if (user.isManager) roles.add("manager");
  if (isAdmin) roles.add("admin");
  if (isIt) roles.add("it");
  if (canReconcile) roles.add("reconciler");
  if (canViewOrganizationAnalytics) roles.add("executive");
  if (canManageAccountRemediation) roles.add("account-support");

  const modules = new Set<PortalModule>(["equipment", "account-remediation"]);
  if (canReconcile) modules.add("reconciliation");
  if (canViewOrganizationAnalytics) modules.add("organization-analytics");

  return {
    user,
    roles: Array.from(roles),
    modules: Array.from(modules),
    isAdmin,
    canCloseOut: isIt,
    canReconcile,
    canViewOrganizationAnalytics,
    canManageAccountRemediation,
  };
}

export async function requireCapability(
  req: NextRequest,
  capability: keyof Pick<
    AccessProfile,
    "isAdmin" | "canCloseOut" | "canReconcile" | "canViewOrganizationAnalytics" | "canManageAccountRemediation"
  >,
): Promise<AccessProfile | null> {
  const access = await getAccessProfile(req);
  return access?.[capability] ? access : null;
}
