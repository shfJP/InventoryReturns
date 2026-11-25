import { prisma } from "./db";

// Hold a dedicated connection while other pooled connections perform the work.
// This also coordinates manual sync endpoints with Coolify scheduled commands.
export async function withMaintenanceLock<T>(action: () => Promise<T>, busy: () => T | Promise<T>): Promise<T> {
  return prisma.$transaction(async (lock) => {
    const [lease] = await lock.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('scheduled-maintenance'), 0) AS acquired
    `;
    return lease.acquired ? action() : busy();
  }, { timeout: 6 * 60 * 60_000, maxWait: 5_000 });
}
