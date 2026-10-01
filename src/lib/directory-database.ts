import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { recordUnresolvedCollectionsForEmployees } from "./employee-deactivation";

const DIRECTORY_DATABASE_URL = (process.env.DIRECTORY_DATABASE_URL ?? "").trim();
const DIRECTORY_SCHEMA = (process.env.DIRECTORY_DATABASE_SCHEMA ?? "paycom").trim();
const DIRECTORY_EMPLOYEE_TABLE = (process.env.DIRECTORY_EMPLOYEE_STATE_TABLE ?? "paycom_employee_state").trim();
const DIRECTORY_SOURCE = (process.env.DIRECTORY_SOURCE_NAME ?? "paycom").trim() || "paycom";
const DIRECTORY_DIVISION_COLUMN = (process.env.DIRECTORY_DIVISION_COLUMN ?? "division_desc").trim();
const DIRECTORY_DEPARTMENT_COLUMN = (process.env.DIRECTORY_DEPARTMENT_COLUMN ?? "department_desc").trim();
const DIRECTORY_SUBDIVISION_COLUMN = (process.env.DIRECTORY_SUBDIVISION_COLUMN ?? "sub_division_desc").trim();
const MIN_EXPECTED_ROWS = Math.max(Number(process.env.DIRECTORY_SYNC_MIN_ROWS) || 100, 1);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.DIRECTORY_SYNC_BATCH_SIZE) || 500, 50), 1_000);
const SYNC_LOCK_NAME = "inventory_returns_directory_sync";

type SourceEmployeeState = {
  sourcePersonKey: string;
  employeeId: string;
  displayName: string;
  email: string | null;
  managerEmployeeId: string | null;
  employmentStatus: string;
  directoryState: string;
  isActive: boolean;
  division: string | null;
  department: string | null;
  subdivision: string | null;
  terminationDate: Date | null;
  sourceSyncedAt: Date | null;
};

export type DirectoryDatabaseSyncResult = {
  source: "directory_database";
  fetched: number;
  replicated: number;
  active: number;
  terminated: number;
  needsReview: number;
  staleSnapshotsRemoved: number;
  usersDeactivated: number;
  unresolvedCollectionsLogged: number;
  managersWithReports: number;
};

function quoteIdentifier(identifier: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`${label} must be a simple PostgreSQL identifier.`);
  }
  return `"${identifier}"`;
}

function optionalSourceText(column: string, envName: string, alias: string): string {
  if (!column) return `NULL::text AS "${alias}"`;
  return `NULLIF(btrim(${quoteIdentifier(column, envName)}::text), '') AS "${alias}"`;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function serializeRows(rows: SourceEmployeeState[], replicatedAt: Date) {
  return rows.map((row) => ({
    ...row,
    terminationDate: row.terminationDate?.toISOString() ?? null,
    sourceSyncedAt: row.sourceSyncedAt?.toISOString() ?? null,
    replicatedAt: replicatedAt.toISOString(),
  }));
}

export function isDirectoryDatabaseConfigured(): boolean {
  return DIRECTORY_DATABASE_URL.length > 0;
}

async function fetchCurrentEmployeeStates(): Promise<SourceEmployeeState[]> {
  const source = new PrismaClient({
    datasources: {
      db: { url: DIRECTORY_DATABASE_URL },
    },
  });
  const sourceTable = `${quoteIdentifier(DIRECTORY_SCHEMA, "DIRECTORY_DATABASE_SCHEMA")}.${quoteIdentifier(DIRECTORY_EMPLOYEE_TABLE, "DIRECTORY_EMPLOYEE_STATE_TABLE")}`;

  try {
    await source.$connect();
    return await source.$queryRawUnsafe<SourceEmployeeState[]>(`
      WITH ranked AS (
        SELECT
          source_person_key AS "sourcePersonKey",
          btrim(employee_code) AS "employeeId",
          COALESCE(NULLIF(btrim(employee_name), ''), btrim(employee_code)) AS "displayName",
          NULLIF(btrim(work_email), '') AS "email",
          NULLIF(btrim(supervisor_primary_code), '') AS "managerEmployeeId",
          COALESCE(NULLIF(btrim(employee_status), ''), 'UNKNOWN') AS "employmentStatus",
          COALESCE(NULLIF(btrim(state_status), ''), 'NEEDS_REVIEW') AS "directoryState",
          (btrim(employee_status) = 'A' AND btrim(state_status) = 'ACTIVE') AS "isActive",
          ${optionalSourceText(DIRECTORY_DIVISION_COLUMN, "DIRECTORY_DIVISION_COLUMN", "division")},
          ${optionalSourceText(DIRECTORY_DEPARTMENT_COLUMN, "DIRECTORY_DEPARTMENT_COLUMN", "department")},
          ${optionalSourceText(DIRECTORY_SUBDIVISION_COLUMN, "DIRECTORY_SUBDIVISION_COLUMN", "subdivision")},
          termination_date AS "terminationDate",
          last_paycom_sync_at AS "sourceSyncedAt",
          row_number() OVER (
            PARTITION BY btrim(employee_code)
            ORDER BY
              -- Duplicate lifecycle rows can disagree after an employee changes
              -- state. The newest source observation is authoritative; status is
              -- only a deterministic tie-breaker for observations at the same time.
              last_paycom_sync_at DESC NULLS LAST,
              CASE
                WHEN btrim(employee_status) = 'A' AND btrim(state_status) = 'ACTIVE' THEN 0
                WHEN btrim(employee_status) = 'T' AND btrim(state_status) = 'OFFBOARDING' THEN 1
                ELSE 2
              END,
              source_person_key
          ) AS canonical_rank
        FROM ${sourceTable}
        WHERE employee_code IS NOT NULL
          AND btrim(employee_code) <> ''
          AND COALESCE(btrim(state_status), '') <> 'MERGED_DUPLICATE'
      )
      SELECT
        "sourcePersonKey",
        "employeeId",
        "displayName",
        "email",
        CASE
          WHEN "managerEmployeeId" = "employeeId" THEN NULL
          ELSE "managerEmployeeId"
        END AS "managerEmployeeId",
        "employmentStatus",
        "directoryState",
        "isActive",
        "division",
        "department",
        "subdivision",
        "terminationDate",
        "sourceSyncedAt"
      FROM ranked
      WHERE canonical_rank = 1
      ORDER BY "employeeId"
    `);
  } finally {
    await source.$disconnect();
  }
}

async function replicateSnapshot(rows: SourceEmployeeState[], replicatedAt: Date): Promise<number> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "DirectoryEmployeeState" (
        "employeeId",
        "sourcePersonKey",
        "displayName",
        "email",
        "managerEmployeeId",
        "employmentStatus",
        "directoryState",
        "isActive",
        "division",
        "department",
        "subdivision",
        "terminationDate",
        "sourceSyncedAt",
        "replicatedAt"
      )
      SELECT
        x."employeeId",
        x."sourcePersonKey",
        x."displayName",
        x."email",
        x."managerEmployeeId",
        x."employmentStatus",
        x."directoryState",
        x."isActive",
        x."division",
        x."department",
        x."subdivision",
        x."terminationDate",
        x."sourceSyncedAt",
        x."replicatedAt"
      FROM jsonb_to_recordset($1::jsonb) AS x(
        "employeeId" text,
        "sourcePersonKey" text,
        "displayName" text,
        "email" text,
        "managerEmployeeId" text,
        "employmentStatus" text,
        "directoryState" text,
        "isActive" boolean,
        "division" text,
        "department" text,
        "subdivision" text,
        "terminationDate" timestamptz,
        "sourceSyncedAt" timestamptz,
        "replicatedAt" timestamptz
      )
      ON CONFLICT ("employeeId") DO UPDATE SET
        "sourcePersonKey" = EXCLUDED."sourcePersonKey",
        "displayName" = EXCLUDED."displayName",
        "email" = EXCLUDED."email",
        "managerEmployeeId" = EXCLUDED."managerEmployeeId",
        "employmentStatus" = EXCLUDED."employmentStatus",
        "directoryState" = EXCLUDED."directoryState",
        "isActive" = EXCLUDED."isActive",
        "division" = EXCLUDED."division",
        "department" = EXCLUDED."department",
        "subdivision" = EXCLUDED."subdivision",
        "terminationDate" = EXCLUDED."terminationDate",
        "sourceSyncedAt" = EXCLUDED."sourceSyncedAt",
        "replicatedAt" = EXCLUDED."replicatedAt"
    `, JSON.stringify(serializeRows(batch, replicatedAt)));
  }

  const deleted = await prisma.directoryEmployeeState.deleteMany({
    where: { replicatedAt: { lt: replicatedAt } },
  });
  return deleted.count;
}

async function findEmployeesTransitioningToInactive(): Promise<Array<{ employeeId: string; hasEquipment: boolean }>> {
  return prisma.$queryRawUnsafe<Array<{ employeeId: string; hasEquipment: boolean }>>(`
    SELECT
      u."employeeId",
      EXISTS (
        SELECT 1
        FROM "EquipmentAssignment" e
        WHERE e."assignedToEmployeeId" = u."employeeId"
      ) AS "hasEquipment"
    FROM "User" u
    LEFT JOIN "DirectoryEmployeeState" d
      ON d."employeeId" = u."employeeId"
    WHERE u."isActive" = true
      AND (
        d."isActive" = false
        OR (u."directorySource" = $1 AND d."employeeId" IS NULL)
      )
  `, DIRECTORY_SOURCE);
}

async function upsertUsers(rows: SourceEmployeeState[], syncedAt: Date): Promise<void> {
  for (const batch of chunks(rows, BATCH_SIZE)) {
    const payload = batch.map((row) => ({
      id: randomUUID(),
      employeeId: row.employeeId,
      displayName: row.displayName,
      email: row.email ?? row.employeeId,
      isActive: row.isActive,
      directorySource: DIRECTORY_SOURCE,
      directorySourcePersonKey: row.sourcePersonKey,
      employmentStatus: row.employmentStatus,
      directoryState: row.directoryState,
      division: row.division,
      department: row.department,
      subdivision: row.subdivision,
      terminationDate: row.terminationDate?.toISOString() ?? null,
      lastSyncedAt: syncedAt.toISOString(),
      createdAt: syncedAt.toISOString(),
      updatedAt: syncedAt.toISOString(),
    }));

    await prisma.$executeRawUnsafe(`
      INSERT INTO "User" (
        "id",
        "employeeId",
        "displayName",
        "email",
        "isManager",
        "isActive",
        "directorySource",
        "directorySourcePersonKey",
        "employmentStatus",
        "directoryState",
        "division",
        "department",
        "subdivision",
        "terminationDate",
        "lastSyncedAt",
        "createdAt",
        "updatedAt"
      )
      SELECT
        x."id",
        x."employeeId",
        x."displayName",
        x."email",
        false,
        x."isActive",
        x."directorySource",
        x."directorySourcePersonKey",
        x."employmentStatus",
        x."directoryState",
        x."division",
        x."department",
        x."subdivision",
        x."terminationDate",
        x."lastSyncedAt",
        x."createdAt",
        x."updatedAt"
      FROM jsonb_to_recordset($1::jsonb) AS x(
        "id" text,
        "employeeId" text,
        "displayName" text,
        "email" text,
        "isActive" boolean,
        "directorySource" text,
        "directorySourcePersonKey" text,
        "employmentStatus" text,
        "directoryState" text,
        "division" text,
        "department" text,
        "subdivision" text,
        "terminationDate" timestamptz,
        "lastSyncedAt" timestamptz,
        "createdAt" timestamptz,
        "updatedAt" timestamptz
      )
      ON CONFLICT ("employeeId") DO UPDATE SET
        "displayName" = EXCLUDED."displayName",
        -- Keep an existing Entra/SSO address when the source row has no work email.
        "email" = COALESCE(NULLIF(EXCLUDED."email", EXCLUDED."employeeId"), "User"."email"),
        "isActive" = EXCLUDED."isActive",
        "directorySource" = EXCLUDED."directorySource",
        "directorySourcePersonKey" = EXCLUDED."directorySourcePersonKey",
        "employmentStatus" = EXCLUDED."employmentStatus",
        "directoryState" = EXCLUDED."directoryState",
        "division" = EXCLUDED."division",
        "department" = EXCLUDED."department",
        "subdivision" = EXCLUDED."subdivision",
        "terminationDate" = EXCLUDED."terminationDate",
        "lastSyncedAt" = EXCLUDED."lastSyncedAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `, JSON.stringify(payload));
  }

  await prisma.user.updateMany({
    where: { directorySource: DIRECTORY_SOURCE },
    data: { isManager: false },
  });

  await prisma.$executeRawUnsafe(`
    UPDATE "User" u
    SET
      -- A null source manager must clear an old relationship rather than retain it.
      "managerId" = manager."id",
      "updatedAt" = $1::timestamptz
    FROM "DirectoryEmployeeState" d
    LEFT JOIN "User" manager
      ON manager."employeeId" = d."managerEmployeeId"
    WHERE u."employeeId" = d."employeeId"
  `, syncedAt.toISOString());

  await prisma.$executeRawUnsafe(`
    UPDATE "User" manager
    SET
      "isManager" = true,
      "updatedAt" = $1::timestamptz
    WHERE EXISTS (
      SELECT 1
      FROM "DirectoryEmployeeState" d
      WHERE d."managerEmployeeId" = manager."employeeId"
    )
  `, syncedAt.toISOString());

  await prisma.$executeRawUnsafe(`
    UPDATE "User" u
    SET
      "isActive" = false,
      "employmentStatus" = 'MISSING',
      "directoryState" = 'MISSING',
      "lastSyncedAt" = $1::timestamptz,
      "updatedAt" = $1::timestamptz
    WHERE u."directorySource" = $2
      AND NOT EXISTS (
        SELECT 1
        FROM "DirectoryEmployeeState" d
        WHERE d."employeeId" = u."employeeId"
      )
  `, syncedAt.toISOString(), DIRECTORY_SOURCE);
}

export async function syncDirectoryDatabaseToDb(): Promise<DirectoryDatabaseSyncResult> {
  if (!isDirectoryDatabaseConfigured()) {
    throw new Error("Directory database sync is not configured. Set DIRECTORY_DATABASE_URL.");
  }

  // Keep this lock on a dedicated connection. The target writes use the shared
  // Prisma client, but every directory sync contender must first own this same
  // session-level PostgreSQL advisory lock.
  const lockClient = new PrismaClient();
  await lockClient.$connect();
  let lockAcquired = false;

  try {
    const lockRows = await lockClient.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext(${SYNC_LOCK_NAME})) AS "acquired"
    `;
    lockAcquired = lockRows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error("A directory sync is already running.");
    }

    const rows = await fetchCurrentEmployeeStates();
    if (rows.length < MIN_EXPECTED_ROWS) {
      throw new Error(
        `Directory database returned ${rows.length} canonical employee row(s); refusing to replace the snapshot because DIRECTORY_SYNC_MIN_ROWS is ${MIN_EXPECTED_ROWS}.`,
      );
    }

    const replicatedAt = new Date();
    const staleSnapshotsRemoved = await replicateSnapshot(rows, replicatedAt);
    const transitioningEmployees = await findEmployeesTransitioningToInactive();
    const unresolvedCollectionsLogged = await recordUnresolvedCollectionsForEmployees(
      transitioningEmployees.filter((employee) => employee.hasEquipment).map((employee) => employee.employeeId),
      replicatedAt,
      "directory_sync",
    );
    await upsertUsers(rows, replicatedAt);

    const active = rows.filter((row) => row.isActive).length;
    const terminated = rows.filter(
      (row) => row.employmentStatus === "T" && row.directoryState === "OFFBOARDING",
    ).length;
    const needsReview = rows.filter((row) => row.directoryState === "NEEDS_REVIEW").length;
    const managersWithReports = new Set(
      rows.map((row) => row.managerEmployeeId).filter((value): value is string => Boolean(value)),
    ).size;

    const result: DirectoryDatabaseSyncResult = {
      source: "directory_database",
      fetched: rows.length,
      replicated: rows.length,
      active,
      terminated,
      needsReview,
      staleSnapshotsRemoved,
      usersDeactivated: transitioningEmployees.length,
      unresolvedCollectionsLogged,
      managersWithReports,
    };
    console.info(`[directory-db] Sync complete: ${JSON.stringify(result)}.`);
    return result;
  } finally {
    if (lockAcquired) {
      await lockClient.$queryRaw`SELECT pg_advisory_unlock(hashtext(${SYNC_LOCK_NAME}))`;
    }
    await lockClient.$disconnect();
  }
}
