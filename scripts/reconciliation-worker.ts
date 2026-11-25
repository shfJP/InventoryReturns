import { prisma } from "../src/lib/db";
import { processNextReconciliationJob, RECONCILIATION_WORKER_KEY } from "../src/lib/reconciliation-jobs";

async function heartbeat() {
  const value = String(Date.now());
  await prisma.appSetting.upsert({
    where: { key: RECONCILIATION_WORKER_KEY }, create: { key: RECONCILIATION_WORKER_KEY, value }, update: { value },
  });
}

async function main() {
  await heartbeat();
  const timer = setInterval(() => {
    void heartbeat().catch((error) => console.error("[reconciliation-worker] Heartbeat failed", error));
  }, 10_000);
  console.info("[reconciliation-worker] Started.");
  try {
    while (true) {
      try { await processNextReconciliationJob(); }
      catch (error) { console.error("[reconciliation-worker] Job processing failed", error); }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  } finally { clearInterval(timer); }
}

main().catch((error) => {
  console.error("[reconciliation-worker] Stopped", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
