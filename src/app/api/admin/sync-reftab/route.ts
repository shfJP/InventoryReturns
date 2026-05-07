import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { syncReftabToDb } from "@/lib/ref-tab";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncReftabToDb();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
