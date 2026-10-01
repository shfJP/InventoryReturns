import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getReturnWorkflowConfig } from "@/lib/return-workflow";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getReturnWorkflowConfig());
}
