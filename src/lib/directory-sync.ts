import { isDirectoryDatabaseConfigured, syncDirectoryDatabaseToDb } from "./directory-database";
import { isEntraConfigured, syncEntraToDb } from "./entra";

export function isDirectorySyncConfigured(): boolean {
  return isDirectoryDatabaseConfigured() || isEntraConfigured();
}

export function configuredDirectorySource(): "database" | "entra" | "none" {
  if (isDirectoryDatabaseConfigured()) return "database";
  if (isEntraConfigured()) return "entra";
  return "none";
}

/**
 * The HR/directory PostgreSQL snapshot is authoritative when configured.
 * Microsoft Graph remains the backward-compatible fallback.
 */
export async function syncDirectoryToDb() {
  if (isDirectoryDatabaseConfigured()) return syncDirectoryDatabaseToDb();
  return syncEntraToDb();
}
