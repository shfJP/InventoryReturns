import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getUserPreferences,
  saveUserPreferences,
} from "@/lib/user-preferences";
import { isDashboardView } from "@/lib/dashboard-view";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getUserPreferences(user.employeeId));
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !isDashboardView(body.dashboardView)) {
    return NextResponse.json({ error: "Invalid dashboard view" }, { status: 400 });
  }

  return NextResponse.json(
    await saveUserPreferences(user.employeeId, {
      dashboardView: body.dashboardView,
    }),
  );
}
