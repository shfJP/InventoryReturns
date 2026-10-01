import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { getReturnWorkflowConfig, saveReturnWorkflowConfig } from "@/lib/return-workflow";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getReturnWorkflowConfig());
}

export async function PUT(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await saveReturnWorkflowConfig(body));
}
