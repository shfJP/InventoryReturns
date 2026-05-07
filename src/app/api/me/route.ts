import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isCurrentUserAdmin } from "@/lib/admin-auth";

/** Avoid DB access during `next build` (Coolify/Nixpacks has no migrated schema yet). */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = await isCurrentUserAdmin(req);
  return NextResponse.json({ ...user, isAdmin });
}
