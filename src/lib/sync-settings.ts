import { prisma } from "./db";

export type SyncSettings = {
  autoSyncOnStartup: boolean;
  cronEnabled: boolean;
  intervalMinutes: number;
  syncEntra: boolean;
  syncReftab: boolean;
};

const SYNC_SETTINGS_KEY = "syncSettings";

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  autoSyncOnStartup: process.env.AUTO_SYNC_ON_STARTUP === "true",
  cronEnabled: process.env.SYNC_CRON_ENABLED === "true",
  intervalMinutes: Math.max(Number(process.env.SYNC_CRON_INTERVAL_MINUTES) || 60, 5),
  syncEntra: process.env.SYNC_CRON_ENTRA !== "false",
  syncReftab: process.env.SYNC_CRON_REFTAB !== "false",
};

function normalizeSyncSettings(value: Partial<SyncSettings> | null | undefined): SyncSettings {
  return {
    autoSyncOnStartup: Boolean(value?.autoSyncOnStartup ?? DEFAULT_SYNC_SETTINGS.autoSyncOnStartup),
    cronEnabled: Boolean(value?.cronEnabled ?? DEFAULT_SYNC_SETTINGS.cronEnabled),
    intervalMinutes: Math.max(Number(value?.intervalMinutes ?? DEFAULT_SYNC_SETTINGS.intervalMinutes) || 60, 5),
    syncEntra: Boolean(value?.syncEntra ?? DEFAULT_SYNC_SETTINGS.syncEntra),
    syncReftab: Boolean(value?.syncReftab ?? DEFAULT_SYNC_SETTINGS.syncReftab),
  };
}

export async function getSyncSettings(): Promise<SyncSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SYNC_SETTINGS_KEY } });
  if (!row) return DEFAULT_SYNC_SETTINGS;

  try {
    return normalizeSyncSettings(JSON.parse(row.value) as Partial<SyncSettings>);
  } catch {
    return DEFAULT_SYNC_SETTINGS;
  }
}

export async function saveSyncSettings(settings: Partial<SyncSettings>): Promise<SyncSettings> {
  const normalized = normalizeSyncSettings(settings);
  await prisma.appSetting.upsert({
    where: { key: SYNC_SETTINGS_KEY },
    update: { value: JSON.stringify(normalized) },
    create: { key: SYNC_SETTINGS_KEY, value: JSON.stringify(normalized) },
  });
  return normalized;
}
