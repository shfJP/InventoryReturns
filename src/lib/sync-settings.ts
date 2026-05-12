import { prisma } from "./db";

export type SyncSettings = {
  autoSyncOnStartup: boolean;
  cronEnabled: boolean;
  syncEntra: boolean;
  entraIntervalMinutes: number;
  syncReftab: boolean;
  reftabIntervalMinutes: number;
  syncNinjaOne: boolean;
  ninjaOneIntervalMinutes: number;
};

const SYNC_SETTINGS_KEY = "syncSettings";

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  autoSyncOnStartup: process.env.AUTO_SYNC_ON_STARTUP === "true",
  cronEnabled: process.env.SYNC_CRON_ENABLED === "true",
  syncEntra: process.env.SYNC_CRON_ENTRA !== "false",
  entraIntervalMinutes: Math.max(Number(process.env.SYNC_CRON_ENTRA_INTERVAL_MINUTES) || 720, 5),
  syncReftab: process.env.SYNC_CRON_REFTAB !== "false",
  reftabIntervalMinutes: Math.max(Number(process.env.SYNC_CRON_REFTAB_INTERVAL_MINUTES) || 10, 5),
  syncNinjaOne: process.env.SYNC_CRON_NINJAONE !== "false",
  ninjaOneIntervalMinutes: Math.max(Number(process.env.SYNC_CRON_NINJAONE_INTERVAL_MINUTES) || 10, 5),
};

function normalizeSyncSettings(value: Partial<SyncSettings> | null | undefined): SyncSettings {
  const legacyInterval = Number((value as Partial<SyncSettings> & { intervalMinutes?: number } | null | undefined)?.intervalMinutes);
  const entraInterval = value?.entraIntervalMinutes ?? (Number.isFinite(legacyInterval) && legacyInterval > 0
    ? legacyInterval
    : DEFAULT_SYNC_SETTINGS.entraIntervalMinutes);
  const reftabInterval = value?.reftabIntervalMinutes ?? (Number.isFinite(legacyInterval) && legacyInterval > 0
    ? legacyInterval
    : DEFAULT_SYNC_SETTINGS.reftabIntervalMinutes);
  const ninjaOneInterval = value?.ninjaOneIntervalMinutes ?? (Number.isFinite(legacyInterval) && legacyInterval > 0
    ? legacyInterval
    : DEFAULT_SYNC_SETTINGS.ninjaOneIntervalMinutes);
  return {
    autoSyncOnStartup: Boolean(value?.autoSyncOnStartup ?? DEFAULT_SYNC_SETTINGS.autoSyncOnStartup),
    cronEnabled: Boolean(value?.cronEnabled ?? DEFAULT_SYNC_SETTINGS.cronEnabled),
    syncEntra: Boolean(value?.syncEntra ?? DEFAULT_SYNC_SETTINGS.syncEntra),
    entraIntervalMinutes: Math.max(Number(entraInterval) || 720, 5),
    syncReftab: Boolean(value?.syncReftab ?? DEFAULT_SYNC_SETTINGS.syncReftab),
    reftabIntervalMinutes: Math.max(Number(reftabInterval) || 10, 5),
    syncNinjaOne: Boolean(value?.syncNinjaOne ?? DEFAULT_SYNC_SETTINGS.syncNinjaOne),
    ninjaOneIntervalMinutes: Math.max(Number(ninjaOneInterval) || 10, 5),
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
