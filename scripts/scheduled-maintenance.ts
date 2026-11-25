import { prisma } from "../src/lib/db";
import { configuredDirectorySource, syncDirectoryToDb } from "../src/lib/directory-sync";
import { syncReftabToDb } from "../src/lib/ref-tab";
import { syncNinjaOneToDb } from "../src/lib/ninjaone";
import { reconcileAutomaticOwners } from "../src/lib/automatic-owner-reconciliation";
import { markSyncStarted, markSyncFinished, markSyncFailed, type SyncSource } from "../src/lib/sync-status";
import { isSnowflakeConfigured, syncOrganizationReportToSnowflake } from "../src/lib/snowflake";
import { executeMaintenancePlan, maintenancePlan } from "../src/lib/maintenance-plan";
import { processNextReconciliationJob } from "../src/lib/reconciliation-jobs";
import { withMaintenanceLock } from "../src/lib/maintenance-lock";

const mode = process.argv[2] ?? "all";
const key = "scheduled-maintenance:last-run";

async function main() {
  maintenancePlan(mode);
  // The dedicated connection retains the lock for the entire run. A second
  // Coolify invocation exits without changing the active run's status.
  await withMaintenanceLock(async () => {
    const run = {
      mode, startedAt: new Date().toISOString(), finishedAt: null as string | null,
      state: "running", stage: "starting", error: null as string | null,
      reconciliation: null as { completed: number; skipped: number; failed: number } | null,
    };
    const save = () => prisma.appSetting.upsert({
      where: { key }, create: { key, value: JSON.stringify(run) },
      update: { value: JSON.stringify(run) },
    });
    const sync = async (source: SyncSource, action: () => Promise<unknown>) => {
      run.stage = source;
      await save();
      await markSyncStarted(source);
      console.info(`[maintenance] Starting ${source}`);
      try {
        const result = await action();
        await markSyncFinished(source, result);
        console.info(`[maintenance] ${source}: ${JSON.stringify(result)}`);
      } catch (error) {
        await markSyncFailed(source, error);
        throw error;
      }
    };
    await save();
    try {
      await executeMaintenancePlan(mode, {
        directory: async () => {
          if (configuredDirectorySource() !== "none") await sync("entra", syncDirectoryToDb);
          else if (mode === "directory") throw new Error("No directory sync source is configured.");
          else console.info("[maintenance] Directory source not configured; skipping.");
        },
        reftab: () => sync("reftab", syncReftabToDb),
        ninjaone: () => sync("ninjaone", syncNinjaOneToDb),
        owners: async () => {
          run.stage = "ownership";
          await save();
          run.reconciliation = await reconcileAutomaticOwners();
          if (run.reconciliation.failed) throw new Error(`${run.reconciliation.failed} automatic action(s) failed; see reconciliation audit.`);
        },
        snowflake: async () => {
          if (isSnowflakeConfigured() && (mode === "snowflake" || process.env.SNOWFLAKE_SYNC_ENABLED === "true")) {
            run.stage = "snowflake";
            await save();
            console.info("[maintenance] Snowflake", await syncOrganizationReportToSnowflake());
          } else if (mode === "snowflake") throw new Error("Snowflake is not configured.");
        },
      });
      run.state = "success";
    } catch (error) {
      run.state = "error";
      run.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      // Use refreshed inventory when sync succeeds, but keep saved decisions
      // moving even when a sync stage fails. Preserve the original sync error.
      if (["all", "inventory", "owners", "sync"].includes(mode)) {
        run.stage = "saved-actions";
        await save();
        try {
          for (let processed = 0; processed < 100; processed++) {
            if (!await processNextReconciliationJob()) break;
          }
        } catch (error) {
          console.error("[maintenance] Saved action processing failed", error);
          if (run.state !== "error") {
            run.state = "error";
            run.error = error instanceof Error ? error.message : String(error);
            process.exitCode = 1;
          }
        }
      }
      run.finishedAt = new Date().toISOString();
      await save();
      console.info("[maintenance]", JSON.stringify(run));
    }
  }, () => { console.info("[maintenance] Skipped: another scheduled run or manual sync is active."); });
}

main().catch((error) => {
  console.error("[maintenance] Failed", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
