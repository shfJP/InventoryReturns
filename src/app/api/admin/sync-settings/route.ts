import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { getSyncSettings, saveSyncSettings } from "@/lib/sync-settings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getSyncSettings());
}

export async function PUT(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const settings = await saveSyncSettings({
    autoSyncOnStartup: Boolean(body.autoSyncOnStartup),
    cronEnabled: Boolean(body.cronEnabled),
    intervalMinutes: Number(body.intervalMinutes),
    syncEntra: Boolean(body.syncEntra),
    syncReftab: Boolean(body.syncReftab),
  });

  return NextResponse.json(settings);
}
