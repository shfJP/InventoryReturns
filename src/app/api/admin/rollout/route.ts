import { NextRequest, NextResponse } from "next/server";
import { getAccessProfile } from "@/lib/access-control";
import { getRolloutReadiness, saveRolloutChecklist } from "@/lib/rollout-readiness";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await getRolloutReadiness());
}

export async function PUT(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const checklist = await saveRolloutChecklist(await req.json().catch(() => ({})), access.user.employeeId);
  return NextResponse.json(checklist);
}
