import { syncEntraToDb } from "../src/lib/entra";
import { syncNinjaOneToDb } from "../src/lib/ninjaone";
import { syncReftabToDb } from "../src/lib/ref-tab";
import { getSyncSettings } from "../src/lib/sync-settings";
import { markSyncDaemonHeartbeat, markSyncFailed, markSyncFinished, markSyncStarted } from "../src/lib/sync-status";
import { prisma } from "../src/lib/db";

let entraRunning = false;
let reftabRunning = false;
let ninjaOneRunning = false;
let lastEntraScheduledRunAt = 0;
let lastReftabScheduledRunAt = 0;
let lastNinjaOneScheduledRunAt = 0;

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
    await markSyncStarted("entra");
    const result = await syncEntraToDb();
    await markSyncFinished("entra", result);
    console.info(`[sync] Entra complete: ${JSON.stringify(result)}.`);
  } catch (e) {
    await markSyncFailed("entra", e);
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
    await markSyncStarted("reftab");
    const result = await syncReftabToDb();
    await markSyncFinished("reftab", result);
    console.info(`[sync] Reftab complete: ${JSON.stringify(result)}.`);
  } catch (e) {
    await markSyncFailed("reftab", e);
    console.warn(`[sync] Reftab failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    reftabRunning = false;
    console.info(`[sync] Finished Reftab ${reason}.`);
  }
}

async function runNinjaOneSync(reason: string): Promise<void> {
  if (ninjaOneRunning) {
    console.info(`[sync] Skipping NinjaOne ${reason}: sync already running.`);
    return;
  }

  ninjaOneRunning = true;
  console.info(`[sync] Starting NinjaOne ${reason}.`);
  try {
    await markSyncStarted("ninjaone");
    const result = await syncNinjaOneToDb();
    await markSyncFinished("ninjaone", result);
    console.info(`[sync] NinjaOne complete: ${JSON.stringify(result)}.`);
  } catch (e) {
    await markSyncFailed("ninjaone", e);
    console.warn(`[sync] NinjaOne failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    ninjaOneRunning = false;
    console.info(`[sync] Finished NinjaOne ${reason}.`);
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.info("[sync] Background sync worker started.");
  await markSyncDaemonHeartbeat(startedAt);

  const initialSettings = await getSyncSettings();
  if (initialSettings.autoSyncOnStartup) {
    if (initialSettings.syncEntra) await runEntraSync("startup sync");
    if (initialSettings.syncReftab) await runReftabSync("startup sync");
    if (initialSettings.syncNinjaOne) await runNinjaOneSync("startup sync");
    lastEntraScheduledRunAt = Date.now();
    lastReftabScheduledRunAt = Date.now();
    lastNinjaOneScheduledRunAt = Date.now();
  }

  while (true) {
    await sleep(60_000);
    await markSyncDaemonHeartbeat(startedAt);
    const settings = await getSyncSettings();
    if (!settings.cronEnabled) continue;

    const now = Date.now();
    const entraIntervalMs = Math.max(settings.entraIntervalMinutes, 5) * 60_000;
    const reftabIntervalMs = Math.max(settings.reftabIntervalMinutes, 5) * 60_000;
    const ninjaOneIntervalMs = Math.max(settings.ninjaOneIntervalMinutes, 5) * 60_000;

    if (settings.syncEntra && now - lastEntraScheduledRunAt >= entraIntervalMs) {
      await runEntraSync(`scheduled sync every ${settings.entraIntervalMinutes} minute(s)`);
      lastEntraScheduledRunAt = Date.now();
    }

    if (settings.syncReftab && now - lastReftabScheduledRunAt >= reftabIntervalMs) {
      await runReftabSync(`scheduled sync every ${settings.reftabIntervalMinutes} minute(s)`);
      lastReftabScheduledRunAt = Date.now();
    }

    if (settings.syncNinjaOne && now - lastNinjaOneScheduledRunAt >= ninjaOneIntervalMs) {
      await runNinjaOneSync(`scheduled sync every ${settings.ninjaOneIntervalMinutes} minute(s)`);
      lastNinjaOneScheduledRunAt = Date.now();
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
