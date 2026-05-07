import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { getCurrentUser } from "./auth";

function getConfiguredAdminGroupIds(): string[] {
  return (process.env.ADMIN_GROUP_IDS ?? "")
    .split(",")
    .map((groupId) => groupId.trim().toLowerCase())
    .filter(Boolean);
}

function getTokenGroups(token: Record<string, unknown> | null): string[] {
  const groups = token?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter((group): group is string => typeof group === "string").map((group) => group.toLowerCase());
}

export async function isCurrentUserAdmin(req: NextRequest): Promise<boolean> {
  const configuredAdminGroupIds = getConfiguredAdminGroupIds();
  const user = await getCurrentUser();
  if (!user) return false;

  if (configuredAdminGroupIds.length === 0) {
    return user.isManager;
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const userGroups = getTokenGroups(token as Record<string, unknown> | null);
  return configuredAdminGroupIds.some((groupId) => userGroups.includes(groupId));
}
