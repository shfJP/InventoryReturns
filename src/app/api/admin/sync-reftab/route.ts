import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { syncReftabToDb } from "@/lib/ref-tab";
import { markSyncFailed, markSyncFinished, markSyncStarted } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await markSyncStarted("reftab");
    const result = await syncReftabToDb();
    await markSyncFinished("reftab", result);
    console.info(`[admin] Reftab sync requested; result=${JSON.stringify(result)}.`);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await markSyncFailed("reftab", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
