import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { fetchReftabCheckInUsage } from "@/lib/ref-tab";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await fetchReftabCheckInUsage());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load Reftab usage" }, { status: 500 });
  }
}
