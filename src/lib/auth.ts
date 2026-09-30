import { getServerSession } from "next-auth";
import { authOptions, isSSOConfigured } from "./auth-options";
import { prisma } from "./db";

const MANAGER_IDS = (process.env.MANAGER_EMPLOYEE_IDS ?? "EMP001,EMP002").split(",").map((s) => s.trim());
const CURRENT_OVERRIDE = process.env.CURRENT_USER_EMPLOYEE_ID?.trim();

export type AuthUser = { employeeId: string; displayName: string; email: string; isManager: boolean };

/**
 * Resolve the current user.
 * SSO mode: read from next-auth session, match to local User row.
 * Pilot mode: read from CURRENT_USER_EMPLOYEE_ID or first MANAGER_EMPLOYEE_IDS.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isSSOConfigured()) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return null;

    const ssoUser = session.user as Record<string, unknown>;
    const employeeId =
      (ssoUser.employeeId as string) ??
      (ssoUser.upn as string) ??
      (ssoUser.email as string) ??
      null;
    if (!employeeId) return null;

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { employeeId: { equals: employeeId, mode: "insensitive" } },
          { upn: { equals: employeeId, mode: "insensitive" } },
          { email: { equals: employeeId, mode: "insensitive" } },
        ],
      },
      // Directory replication uses the lifecycle employee code as employeeId,
      // while older Entra-created rows used the UPN. During that migration both
      // rows can match the same SSO identity. Prefer the current directory row
      // so report traversal starts from the replicated manager hierarchy.
      orderBy: [
        { isActive: "desc" },
        { lastSyncedAt: "desc" },
        { updatedAt: "desc" },
      ],
      select: { employeeId: true, displayName: true, email: true, isManager: true },
    });
    if (!user) return null;
    return {
      employeeId: user.employeeId,
      displayName: user.displayName,
      email: user.email,
      isManager: user.isManager,
    };
  }

  // Pilot mode fallback
  const employeeId = CURRENT_OVERRIDE || MANAGER_IDS[0] || null;
  if (!employeeId) return null;
  const user = await prisma.user.findUnique({
    where: { employeeId },
    select: { employeeId: true, displayName: true, email: true, isManager: true },
  });
  if (!user) return null;
  return {
    employeeId: user.employeeId,
    displayName: user.displayName,
    email: user.email,
    isManager: user.isManager,
  };
}

/** Get employee ID of the authenticated user (for API routes). */
export async function getCurrentEmployeeId(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.employeeId ?? null;
}

/** Return all direct + indirect report employee IDs for a manager (closure). */
export async function getReportEmployeeIds(managerEmployeeId: string): Promise<string[]> {
  const manager = await prisma.user.findUnique({
    where: { employeeId: managerEmployeeId },
    select: { id: true },
  });
  if (!manager) return [];

  const visited = new Set<string>();
  const queue: string[] = (await prisma.user.findMany({
    where: { managerId: manager.id },
    select: { employeeId: true },
  })).map((r) => r.employeeId);

  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const nextManager = await prisma.user.findUnique({ where: { employeeId: current }, select: { id: true } });
    if (nextManager) {
      const reports = await prisma.user.findMany({
        where: { managerId: nextManager.id },
        select: { employeeId: true },
      });
      for (const r of reports) queue.push(r.employeeId);
    }
  }

  return Array.from(visited);
}
