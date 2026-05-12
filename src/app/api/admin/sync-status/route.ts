import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAllSyncRunStatuses, getSyncDaemonStatus } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const [latestEquipment, latestUser, latestNinjaOneDevice, runStatus, daemon] = await Promise.all([
    prisma.equipmentAssignment.findFirst({
      where: { lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    prisma.user.findFirst({
      where: { lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    prisma.ninjaOneDevice.findFirst({
      where: { lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    getAllSyncRunStatuses(),
    getSyncDaemonStatus(),
  ]);

  const reftabSyncedAt = latestEquipment?.lastSyncedAt?.toISOString() ?? null;
  const entraSyncedAt = latestUser?.lastSyncedAt?.toISOString() ?? null;
  const ninjaOneSyncedAt = latestNinjaOneDevice?.lastSyncedAt?.toISOString() ?? null;

  // Backward-compatible: lastSyncedAt is the most recent of the two
  const times = [reftabSyncedAt, entraSyncedAt, ninjaOneSyncedAt].filter(Boolean) as string[];
  const lastSyncedAt = times.length > 0
    ? times.sort().reverse()[0]
    : null;

  return NextResponse.json({
    lastSyncedAt,
    reftabSyncedAt,
    entraSyncedAt,
    ninjaOneSyncedAt,
    entra: runStatus.entra,
    reftab: runStatus.reftab,
    ninjaone: runStatus.ninjaone,
    daemon,
  });
}
