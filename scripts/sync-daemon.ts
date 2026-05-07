import { syncEntraToDb } from "../src/lib/entra";
import { syncReftabToDb } from "../src/lib/ref-tab";
import { getSyncSettings } from "../src/lib/sync-settings";
import { prisma } from "../src/lib/db";

let entraRunning = false;
let reftabRunning = false;
let lastEntraScheduledRunAt = 0;
let lastReftabScheduledRunAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runEntraSync(reason: string): Promise<void> {
  if (entraRunning) {
    console.info(`[sync] Skipping Entra ${reason}: sync already running.`);
    return;
  }

  entraRunning = true;
  console.info(`[sync] Starting Entra ${reason}.`);
  try {
    const result = await syncEntraToDb();
    console.info(`[sync] Entra complete: ${JSON.stringify(result)}.`);
  } catch (e) {
    console.warn(`[sync] Entra failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    entraRunning = false;
    console.info(`[sync] Finished Entra ${reason}.`);
  }
}

async function runReftabSync(reason: string): Promise<void> {
  if (reftabRunning) {
    console.info(`[sync] Skipping Reftab ${reason}: sync already running.`);
    return;
  }

  reftabRunning = true;
  console.info(`[sync] Starting Reftab ${reason}.`);
  try {
    const result = await syncReftabToDb();
    console.info(`[sync] Reftab complete: ${JSON.stringify(result)}.`);
  } catch (e) {
    console.warn(`[sync] Reftab failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    reftabRunning = false;
    console.info(`[sync] Finished Reftab ${reason}.`);
  }
}

async function main(): Promise<void> {
  console.info("[sync] Background sync worker started.");

  const initialSettings = await getSyncSettings();
  if (initialSettings.autoSyncOnStartup) {
    if (initialSettings.syncEntra) await runEntraSync("startup sync");
    if (initialSettings.syncReftab) await runReftabSync("startup sync");
    lastEntraScheduledRunAt = Date.now();
    lastReftabScheduledRunAt = Date.now();
  }

  while (true) {
    await sleep(60_000);
    const settings = await getSyncSettings();
    if (!settings.cronEnabled) continue;

    const now = Date.now();
    const entraIntervalMs = Math.max(settings.entraIntervalMinutes, 5) * 60_000;
    const reftabIntervalMs = Math.max(settings.reftabIntervalMinutes, 5) * 60_000;

    if (settings.syncEntra && now - lastEntraScheduledRunAt >= entraIntervalMs) {
      await runEntraSync(`scheduled sync every ${settings.entraIntervalMinutes} minute(s)`);
      lastEntraScheduledRunAt = Date.now();
    }

    if (settings.syncReftab && now - lastReftabScheduledRunAt >= reftabIntervalMs) {
      await runReftabSync(`scheduled sync every ${settings.reftabIntervalMinutes} minute(s)`);
      lastReftabScheduledRunAt = Date.now();
    }
  }
}

main()
  .catch((e) => {
    console.error(`[sync] Background sync worker crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
