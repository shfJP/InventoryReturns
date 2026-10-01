import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { isSnowflakeConfigured, syncOrganizationReportToSnowflake } from "@/lib/snowflake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isSnowflakeConfigured()) return NextResponse.json({ error: "Snowflake is not configured" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await syncOrganizationReportToSnowflake()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Snowflake synchronization failed" }, { status: 500 });
  }
}
