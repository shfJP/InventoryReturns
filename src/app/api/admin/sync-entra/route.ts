import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import {
  configuredDirectorySource,
  isDirectorySyncConfigured,
  syncDirectoryToDb,
} from "@/lib/directory-sync";
import { markSyncFailed, markSyncFinished, markSyncStarted } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDirectorySyncConfigured()) {
    await markSyncFailed("entra", "Directory sync is not configured.");
    return NextResponse.json(
      {
        error:
          "Directory sync is not configured. Set DIRECTORY_DATABASE_URL or the Microsoft Entra application credentials.",
      },
      { status: 503 }
    );
  }

  try {
    await markSyncStarted("entra");
    const result = await syncDirectoryToDb();
    await markSyncFinished("entra", result);
    return NextResponse.json({
      ok: true,
      configuredSource: configuredDirectorySource(),
      ...result,
    });
  } catch (e) {
    await markSyncFailed("entra", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
