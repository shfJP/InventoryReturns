import { NextRequest, NextResponse } from "next/server";
import { requireCapability } from "@/lib/access-control";
import { getOrganizationReport, type OrganizationGroupBy } from "@/lib/organization-report";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireCapability(req, "canViewOrganizationAnalytics"))) {
    return NextResponse.json({ error: "Forbidden: executive reporting access is required" }, { status: 403 });
  }
  const requested = req.nextUrl.searchParams.get("groupBy");
  const groupBy: OrganizationGroupBy =
    requested === "department" || requested === "subdivision" ? requested : "division";
  return NextResponse.json(await getOrganizationReport(groupBy, {
    division: req.nextUrl.searchParams.get("division"),
    department: req.nextUrl.searchParams.get("department"),
    subdivision: req.nextUrl.searchParams.get("subdivision"),
  }));
}
