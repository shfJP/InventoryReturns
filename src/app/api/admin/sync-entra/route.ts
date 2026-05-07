import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { syncEntraToDb, isEntraConfigured } from "@/lib/entra";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isEntraConfigured()) {
    return NextResponse.json(
      { error: "Entra integration is not configured. Set AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, and AZURE_AD_CLIENT_SECRET." },
      { status: 503 }
    );
  }

  try {
    const result = await syncEntraToDb();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
