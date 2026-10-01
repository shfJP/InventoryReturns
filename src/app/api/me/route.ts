import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAccessProfile } from "@/lib/access-control";

/** Avoid DB access during `next build` (Coolify/Nixpacks has no migrated schema yet). */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const access = await getAccessProfile(req);
  return NextResponse.json({
    ...user,
    isAdmin: access?.isAdmin ?? false,
    roles: access?.roles ?? [],
    modules: access?.modules ?? ["equipment"],
    permissions: {
      canCloseOut: access?.canCloseOut ?? false,
      canReconcile: access?.canReconcile ?? false,
      canViewOrganizationAnalytics: access?.canViewOrganizationAnalytics ?? false,
      canManageAccountRemediation: access?.canManageAccountRemediation ?? false,
    },
  });
}
