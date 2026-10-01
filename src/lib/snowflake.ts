import snowflake, { type Binds, type Connection } from "snowflake-sdk";
import { prisma } from "./db";
import { getOrganizationReport } from "./organization-report";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Snowflake synchronization.`);
  return value;
}

function identifier(name: string, fallback: string): string {
  const value = (process.env[name] ?? fallback).trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_$]*$/.test(value)) throw new Error(`${name} must be a simple Snowflake identifier.`);
  return `"${value}"`;
}

export function isSnowflakeConfigured(): boolean {
  return Boolean(
    process.env.SNOWFLAKE_ACCOUNT?.trim() &&
    process.env.SNOWFLAKE_USERNAME?.trim() &&
    process.env.SNOWFLAKE_PASSWORD?.trim() &&
    process.env.SNOWFLAKE_WAREHOUSE?.trim() &&
    process.env.SNOWFLAKE_DATABASE?.trim() &&
    process.env.SNOWFLAKE_SCHEMA?.trim()
  );
}

function connect(): Promise<Connection> {
  const connection = snowflake.createConnection({
    account: required("SNOWFLAKE_ACCOUNT"),
    username: required("SNOWFLAKE_USERNAME"),
    password: required("SNOWFLAKE_PASSWORD"),
    warehouse: required("SNOWFLAKE_WAREHOUSE"),
    database: required("SNOWFLAKE_DATABASE"),
    schema: required("SNOWFLAKE_SCHEMA"),
    role: process.env.SNOWFLAKE_ROLE?.trim() || undefined,
    application: "inventory_returns_portal",
  });
  return new Promise((resolve, reject) => {
    connection.connect((error, connected) => error ? reject(error) : resolve(connected));
  });
}

function execute(connection: Connection, sqlText: string, binds?: Binds): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete(error, _statement, rows) {
        if (error) reject(error);
        else resolve(rows ?? []);
      },
    });
  });
}

function destroy(connection: Connection): Promise<void> {
  return new Promise((resolve) => connection.destroy(() => resolve()));
}

export async function syncOrganizationReportToSnowflake() {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake is not configured.");
  const table = identifier("SNOWFLAKE_INVENTORY_TABLE", "INVENTORY_ORGANIZATION_SNAPSHOT");
  const report = await getOrganizationReport("subdivision");
  const connection = await connect();
  try {
    await execute(connection, `
      CREATE TABLE IF NOT EXISTS ${table} (
        SNAPSHOT_AT TIMESTAMP_TZ NOT NULL,
        GROUPING_TYPE VARCHAR NOT NULL,
        ORGANIZATION VARCHAR NOT NULL,
        EMPLOYEE_COUNT NUMBER NOT NULL,
        ACTIVE_EMPLOYEE_COUNT NUMBER NOT NULL,
        INACTIVE_EMPLOYEE_COUNT NUMBER NOT NULL,
        ASSET_COUNT NUMBER NOT NULL,
        PURCHASE_VALUE_CENTS NUMBER NOT NULL,
        REPLACEMENT_VALUE_CENTS NUMBER NOT NULL,
        BOOK_VALUE_CENTS NUMBER NOT NULL,
        SOURCE VARCHAR NOT NULL
      )
    `);
    await execute(connection, `BEGIN`);
    await execute(connection, `DELETE FROM ${table} WHERE SOURCE = ?`, ["inventory-returns"]);
    if (report.rows.length > 0) {
      const binds = report.rows.map((row) => [
        report.generatedAt,
        report.groupBy,
        row.organization,
        row.employeeCount,
        row.activeEmployeeCount,
        row.inactiveEmployeeCount,
        row.assetCount,
        row.purchaseValueCents,
        row.replacementValueCents,
        row.bookValueCents,
        "inventory-returns",
      ]);
      await execute(connection, `
        INSERT INTO ${table} (
          SNAPSHOT_AT, GROUPING_TYPE, ORGANIZATION, EMPLOYEE_COUNT,
          ACTIVE_EMPLOYEE_COUNT, INACTIVE_EMPLOYEE_COUNT, ASSET_COUNT,
          PURCHASE_VALUE_CENTS, REPLACEMENT_VALUE_CENTS, BOOK_VALUE_CENTS, SOURCE
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, binds);
    }
    await execute(connection, `COMMIT`);
    const result = { rowsWritten: report.rows.length, snapshotAt: report.generatedAt, groupingType: report.groupBy };
    await prisma.appSetting.upsert({
      where: { key: "snowflake:lastSync" },
      create: { key: "snowflake:lastSync", value: JSON.stringify({ ...result, status: "success" }) },
      update: { value: JSON.stringify({ ...result, status: "success" }) },
    });
    return result;
  } catch (error) {
    await execute(connection, `ROLLBACK`).catch(() => []);
    await prisma.appSetting.upsert({
      where: { key: "snowflake:lastSync" },
      create: { key: "snowflake:lastSync", value: JSON.stringify({ status: "error", at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }) },
      update: { value: JSON.stringify({ status: "error", at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }) },
    });
    throw error;
  } finally {
    await destroy(connection);
  }
}
