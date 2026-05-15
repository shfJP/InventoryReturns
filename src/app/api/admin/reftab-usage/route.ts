import { NextRequest, NextResponse } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type StaffUsageRow = {
  userId: string;
  employeeId: string;
  displayName: string;
  email: string;
  checkedInCount: number;
  managerCheckInCount: number;
  itCheckInCount: number;
  percentOfTotal: number;
};

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.collectionEvent.findMany({
    select: {
      collectedByRole: true,
      markedByManager: {
        select: {
          id: true,
          employeeId: true,
          displayName: true,
          email: true,
        },
      },
    },
  });

  const totalCheckedIn = events.length;
  const byUser = new Map<string, StaffUsageRow>();

  for (const event of events) {
    const user = event.markedByManager;
    const row = byUser.get(user.id) ?? {
      userId: user.id,
      employeeId: user.employeeId,
      displayName: user.displayName,
      email: user.email,
      checkedInCount: 0,
      managerCheckInCount: 0,
      itCheckInCount: 0,
      percentOfTotal: 0,
    };

    row.checkedInCount += 1;
    if (event.collectedByRole === "it") {
      row.itCheckInCount += 1;
    } else {
      row.managerCheckInCount += 1;
    }
    byUser.set(user.id, row);
  }

  const rows = Array.from(byUser.values())
    .map((row) => ({
      ...row,
      percentOfTotal: totalCheckedIn > 0 ? Number(((row.checkedInCount / totalCheckedIn) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.checkedInCount - a.checkedInCount || a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    rows,
    totals: {
      staffCount: rows.length,
      totalCheckedIn,
      managerCheckInCount: rows.reduce((sum, row) => sum + row.managerCheckInCount, 0),
      itCheckInCount: rows.reduce((sum, row) => sum + row.itCheckInCount, 0),
    },
  });
}
