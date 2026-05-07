import { syncEntraToDb } from "../src/lib/entra";
import { syncReftabToDb } from "../src/lib/ref-tab";
import { getSyncSettings } from "../src/lib/sync-settings";
import { prisma } from "../src/lib/db";

let running = false;
let lastScheduledRunAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runConfiguredSync(reason: string): Promise<void> {
  if (running) {
    console.info(`[sync] Skipping ${reason}: sync already running.`);
    return;
  }

  const settings = await getSyncSettings();
  if (!settings.syncEntra && !settings.syncReftab) {
    console.info(`[sync] Skipping ${reason}: no sync sources are enabled.`);
    return;
  }

  running = true;
  console.info(`[sync] Starting ${reason}.`);
  try {
    if (settings.syncEntra) {
      try {
        const result = await syncEntraToDb();
        console.info(`[sync] Entra complete: ${JSON.stringify(result)}.`);
      } catch (e) {
        console.warn(`[sync] Entra failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (settings.syncReftab) {
      try {
        const result = await syncReftabToDb();
        console.info(`[sync] Reftab complete: ${JSON.stringify(result)}.`);
      } catch (e) {
        console.warn(`[sync] Reftab failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    running = false;
    console.info(`[sync] Finished ${reason}.`);
  }
}

async function main(): Promise<void> {
  console.info("[sync] Background sync worker started.");

  const initialSettings = await getSyncSettings();
  if (initialSettings.autoSyncOnStartup) {
    await runConfiguredSync("startup sync");
    lastScheduledRunAt = Date.now();
  }

  while (true) {
    await sleep(60_000);
    const settings = await getSyncSettings();
    if (!settings.cronEnabled) continue;

    const intervalMs = Math.max(settings.intervalMinutes, 5) * 60_000;
    if (Date.now() - lastScheduledRunAt < intervalMs) continue;

    await runConfiguredSync(`scheduled sync every ${settings.intervalMinutes} minute(s)`);
    lastScheduledRunAt = Date.now();
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
