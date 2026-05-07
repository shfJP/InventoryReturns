import { prisma } from "./db";

export type SyncSource = "entra" | "reftab";
export type SyncRunState = "idle" | "running" | "success" | "error";

export type SyncRunStatus = {
  source: SyncSource;
  state: SyncRunState;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastResult: unknown | null;
};

const SYNC_STATUS_PREFIX = "syncStatus:";

function statusKey(source: SyncSource): string {
  return `${SYNC_STATUS_PREFIX}${source}`;
}

function defaultStatus(source: SyncSource): SyncRunStatus {
  return {
    source,
    state: "idle",
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastResult: null,
  };
}

function parseStatus(source: SyncSource, value: string | null | undefined): SyncRunStatus {
  if (!value) return defaultStatus(source);
  try {
    const parsed = JSON.parse(value) as Partial<SyncRunStatus>;
    return {
      ...defaultStatus(source),
      ...parsed,
      source,
    };
  } catch {
    return defaultStatus(source);
  }
}

async function saveStatus(source: SyncSource, status: SyncRunStatus): Promise<SyncRunStatus> {
  await prisma.appSetting.upsert({
    where: { key: statusKey(source) },
    update: { value: JSON.stringify(status) },
    create: { key: statusKey(source), value: JSON.stringify(status) },
  });
  return status;
}

export async function getSyncRunStatus(source: SyncSource): Promise<SyncRunStatus> {
  const row = await prisma.appSetting.findUnique({ where: { key: statusKey(source) } });
  return parseStatus(source, row?.value);
}

export async function getAllSyncRunStatuses(): Promise<Record<SyncSource, SyncRunStatus>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [statusKey("entra"), statusKey("reftab")] } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    entra: parseStatus("entra", byKey.get(statusKey("entra"))),
    reftab: parseStatus("reftab", byKey.get(statusKey("reftab"))),
  };
}

export async function markSyncStarted(source: SyncSource): Promise<SyncRunStatus> {
  const current = await getSyncRunStatus(source);
  return saveStatus(source, {
    ...current,
    state: "running",
    lastStartedAt: new Date().toISOString(),
    lastError: null,
  });
}

export async function markSyncFinished(source: SyncSource, result: unknown): Promise<SyncRunStatus> {
  const current = await getSyncRunStatus(source);
  return saveStatus(source, {
    ...current,
    state: "success",
    lastFinishedAt: new Date().toISOString(),
    lastError: null,
    lastResult: result,
  });
}

export async function markSyncFailed(source: SyncSource, error: unknown): Promise<SyncRunStatus> {
  const current = await getSyncRunStatus(source);
  return saveStatus(source, {
    ...current,
    state: "error",
    lastFinishedAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
  });
}
