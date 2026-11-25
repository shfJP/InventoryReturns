import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { isNinjaOneConfigured, syncNinjaOneToDb } from "@/lib/ninjaone";
import { markSyncFailed, markSyncFinished, markSyncStarted } from "@/lib/sync-status";
import { invalidateOwnerReconciliationCache } from "@/lib/owner-reconciliation-cache";
import { reconcileAutomaticOwnersAfterSync } from "@/lib/automatic-owner-reconciliation";
import { withMaintenanceLock } from "@/lib/maintenance-lock";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isNinjaOneConfigured()) {
    return NextResponse.json({ error: "NinjaOne is not configured. Set NINJAONE_CLIENT_ID and NINJAONE_CLIENT_SECRET." }, { status: 400 });
  }

  return withMaintenanceLock(async () => {
    try {
      await markSyncStarted("ninjaone");
      const result = await syncNinjaOneToDb();
      const ownerReconciliation = await reconcileAutomaticOwnersAfterSync();
      await invalidateOwnerReconciliationCache();
      await markSyncFinished("ninjaone", result);
      console.info(`[admin] NinjaOne sync requested; result=${JSON.stringify(result)}.`);
      return NextResponse.json({ ok: true, ...result, ownerReconciliation });
    } catch (e) {
      await markSyncFailed("ninjaone", e);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Sync failed" },
        { status: 500 }
      );
    }
  }, () => NextResponse.json({ error: "Scheduled maintenance or another sync is active. Try again after it finishes." }, { status: 409 }));
}
