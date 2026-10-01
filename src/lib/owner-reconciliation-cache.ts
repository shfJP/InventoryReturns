import { prisma } from "./db";
import { getOwnerReconciliationResult, type OwnerReconciliationResult } from "./owner-reconciliation";

const KEY = "cache:ownerReconciliation:v2";

type CachedResult = {
  generatedAt: string;
  expiresAt: string;
  result: OwnerReconciliationResult;
};

function ttlMilliseconds(): number {
  const minutes = Math.max(Number(process.env.OWNER_RECONCILIATION_CACHE_MINUTES) || 240, 5);
  return minutes * 60_000;
}

export async function invalidateOwnerReconciliationCache(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: KEY } });
}

export async function getCachedOwnerReconciliationResult(force = false): Promise<CachedResult & { cacheHit: boolean }> {
  if (!force) {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    if (row) {
      try {
        const cached = JSON.parse(row.value) as CachedResult;
        if (cached.result && new Date(cached.expiresAt).getTime() > Date.now()) {
          return { ...cached, cacheHit: true };
        }
      } catch {
        // Replace invalid/legacy cache below.
      }
    }
  }

  const result = await getOwnerReconciliationResult();
  const generatedAt = new Date();
  const payload: CachedResult = {
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(generatedAt.getTime() + ttlMilliseconds()).toISOString(),
    result,
  };
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(payload) },
    update: { value: JSON.stringify(payload) },
  });
  return { ...payload, cacheHit: false };
}
