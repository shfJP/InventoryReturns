import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { syncEntraToDb, isEntraConfigured } from "@/lib/entra";
import { markSyncFailed, markSyncFinished, markSyncStarted } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEntraConfigured()) {
    await markSyncFailed("entra", "Entra integration is not configured.");
    return NextResponse.json(
      { error: "Entra integration is not configured. Set AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, and AZURE_AD_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  try {
    await markSyncStarted("entra");
    const result = await syncEntraToDb();
    await markSyncFinished("entra", result);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await markSyncFailed("entra", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
