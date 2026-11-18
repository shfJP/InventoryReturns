import { NextRequest, NextResponse } from "next/server";
import { getAccessProfile } from "@/lib/access-control";
import { prisma } from "@/lib/db";
import { getOwnerReconciliationResult } from "@/lib/owner-reconciliation";
import { buildReconciliationWorkbook, historicalOwnerChangeReason, mergeReconciliationCompletions } from "@/lib/reconciliation-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) {
    return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  }
  try {
    // Bypass the page cache and all search, pagination and decision suppression.
    const [result, audits, decisions, reftab, ninja] = await Promise.all([
      getOwnerReconciliationResult(),
      prisma.reconciliationAudit.findMany({
        where: { status: "SUCCEEDED", action: { in: ["reassign-owner", "add-missing-asset", "decommission-missing-asset"] } },
        select: { assetTag: true, ninjaDeviceId: true, action: true, status: true, completedAt: true, actorName: true, decisionId: true },
        orderBy: { completedAt: "desc" },
      }),
      prisma.reconciliationDecision.findMany({
        where: { decision: "YES", reason: historicalOwnerChangeReason },
        select: {
          id: true, assetTag: true, ninjaDeviceId: true, decision: true, reason: true,
          createdAt: true, decidedByName: true, decidedByEmployeeId: true,
        },
      }),
      prisma.equipmentAssignment.aggregate({ _max: { lastSyncedAt: true } }),
      prisma.ninjaOneDevice.aggregate({ _max: { lastSyncedAt: true } }),
    ]);
    const generatedAt = new Date();
    const buffer = await buildReconciliationWorkbook({
      items: result.reportItems, audits: mergeReconciliationCompletions(audits, decisions), generatedAt,
      reftabSyncedAt: reftab._max.lastSyncedAt, ninjaSyncedAt: ninja._max.lastSyncedAt,
    });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reconciliation-report-${generatedAt.toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[reconciliation-export] Failed", error);
    return NextResponse.json({ error: "Failed to generate reconciliation Excel report. Please try again." }, { status: 500 });
  }
}
