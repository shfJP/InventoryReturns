import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getOwnerReconciliationRow } from "@/lib/owner-reconciliation";
import { fetchReftabCategories } from "@/lib/ref-tab";
import { getCachedOwnerReconciliationResult, invalidateOwnerReconciliationCache } from "@/lib/owner-reconciliation-cache";
import { getAccessProfile } from "@/lib/access-control";
import { enqueueReconciliation, outstandingJobStatuses } from "@/lib/reconciliation-jobs";
import { scopeReconciliation, excludeReservedReconciliation } from "@/lib/reconciliation-scope";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const approveSchema = z.object({
  action: z.enum(["reassign-owner", "add-missing-asset", "decommission-missing-asset", "record-decision"]).default("reassign-owner"),
  assetTag: z.string().min(1),
  ninjaDeviceId: z.string().min(1),
  serial: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  categoryId: z.string().min(1).optional(),
  ownerEmployeeId: z.string().min(1).optional(),
  ownerEmail: z.string().email().optional(),
  decision: z.enum(["YES", "NO", "UNSURE", "DEFER"]).optional(),
  reason: z.string().max(500).optional(),
  notes: z.string().max(2_000).optional(),
});

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) {
    return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  }

  try {
    const jobId = req.nextUrl.searchParams.get("job");
    if (jobId) {
      const job = await prisma.reconciliationJob.findUnique({ where: { id: jobId } });
      if (!job) return NextResponse.json({ error: "Reconciliation job not found" }, { status: 404 });
      return NextResponse.json({ jobId: job.id, status: job.status,
        ...(job.resultJson ? { result: JSON.parse(job.resultJson) } : {}),
        error: job.error }, { headers: { "Cache-Control": "no-store" } });
    }
    if (req.nextUrl.searchParams.get("jobs") === "1") {
      const page = Math.max(1, Math.min(10_000, Number(req.nextUrl.searchParams.get("page")) || 1));
      if (!Number.isInteger(page)) return NextResponse.json({ error: "Invalid page" }, { status: 400 });
      const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
      const where = q ? { OR: ["assetTag", "ninjaDeviceId", "actorName", "recipientEmail"].map((field) =>
        ({ [field]: { contains: q, mode: "insensitive" as const } })) } : {};
      const [jobs, total, heartbeat] = await Promise.all([
        prisma.reconciliationJob.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 25 }),
        prisma.reconciliationJob.count({ where }),
        prisma.appSetting.findUnique({ where: { key: "reconciliation-worker-heartbeat" } }),
      ]);
      return NextResponse.json({ jobs, total, workerOnline: Boolean(heartbeat && Date.now() - Number(heartbeat.value) < 60_000) },
        { headers: { "Cache-Control": "no-store" } });
    }
    if (req.nextUrl.searchParams.get("audit") === "1") {
      const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
      if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
        return NextResponse.json({ error: "Invalid audit page" }, { status: 400 });
      }
      const query = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
      const searchWhere = query ? {
        OR: [
          "assetTag", "ninjaDeviceId", "actorName", "actorEmployeeId",
          "previousOwnerName", "previousOwnerEmployeeId", "proposedOwnerName", "proposedOwnerEmployeeId",
        ].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } }))
      } : {};
      const where = {
        ...searchWhere,
        ...(req.nextUrl.searchParams.get("jobId") ? { jobId: req.nextUrl.searchParams.get("jobId")! } : {}),
        ...(req.nextUrl.searchParams.get("view") === "automated"
          ? { actorEmployeeId: { startsWith: "system:" } } : {}),
      };
      const [total, rows] = await prisma.$transaction([
        prisma.reconciliationAudit.count({ where }),
        prisma.reconciliationAudit.findMany({
          where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 25,
        }),
      ]);
      return NextResponse.json({ rows, total, page, pageSize: 25 });
    }
    if (req.nextUrl.searchParams.get("categories") === "1") {
      const categories = await fetchReftabCategories();
      return NextResponse.json({ categories });
    }

    const cached = await getCachedOwnerReconciliationResult(req.nextUrl.searchParams.get("refresh") === "1");
    const automated = req.nextUrl.searchParams.get("view") === "automated";
    const reservations = await prisma.reconciliationJob.findMany({ where: { OR: [
      { status: { in: outstandingJobStatuses } },
      { status: "SUCCEEDED", completedAt: { gte: new Date(cached.generatedAt) } },
    ] }, select: { ninjaDeviceId: true } });
    const decommissions = await prisma.hardwareDecommission.findMany({ where: { status: { not: "FAILED" } }, select: { ninjaDeviceId: true } });
    const scoped = excludeReservedReconciliation(
      scopeReconciliation(cached.result, req.nextUrl.searchParams.get("view") === "no-owner-signal" ? "no-owner-signal" : automated),
      new Set([...reservations, ...decommissions].map((item) => item.ninjaDeviceId)));
    const automationRun = automated ? await prisma.appSetting.findUnique({ where: { key: "scheduled-maintenance:last-run" } }) : null;
    const decisions = await prisma.reconciliationDecision.findMany({
      orderBy: { createdAt: "desc" },
      select: { assetTag: true, ninjaDeviceId: true, decision: true, createdAt: true, reason: true },
    });
    const latestDecisionByKey = new Map<string, typeof decisions[number]>();
    for (const decision of decisions) {
      const key = `${decision.assetTag}\u0000${decision.ninjaDeviceId}`;
      if (!latestDecisionByKey.has(key)) latestDecisionByKey.set(key, decision);
    }
    const deferHours = Math.max(Number(process.env.RECONCILIATION_DEFER_HOURS) || 24, 1);
    const deferCutoff = Date.now() - deferHours * 60 * 60 * 1_000;
    const suppressesRow = (decision: typeof decisions[number] | undefined) =>
      Boolean(
        decision &&
        (["NO", "UNSURE"].includes(decision.decision) || (decision.decision === "DEFER" && decision.createdAt.getTime() > deferCutoff)),
      );
    const includeDecided = req.nextUrl.searchParams.get("includeDecided") === "1";
    const rows = includeDecided
      ? scoped.rows
      : scoped.rows.filter((row) => automated || !suppressesRow(latestDecisionByKey.get(`${row.assetTag}\u0000${row.ninjaDevice.id}`)));
    return NextResponse.json({
      ...scoped,
      automationRun: automationRun ? JSON.parse(automationRun.value) : null,
      rows,
      summary: { ...scoped.summary, mismatchCount: rows.length },
      count: rows.length,
      decisionCount: latestDecisionByKey.size,
      deferHours,
      cache: { generatedAt: cached.generatedAt, expiresAt: cached.expiresAt, hit: cached.cacheHit },
    });
  } catch (e) {
    console.error("[owner-reconciliation] GET failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load owner reconciliation" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) {
    return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  }

  const actor = {
    actorEmployeeId: access.user.employeeId,
    actorName: access.user.displayName,
    actorEmail: access.user.email,
  };
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = approveSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.action === "record-decision") {
      if (!parsed.data.decision) {
        return NextResponse.json({ error: "Decision is required" }, { status: 400 });
      }
      const row = await getOwnerReconciliationRow(parsed.data.assetTag, parsed.data.ninjaDeviceId);
      if (!row) {
        return NextResponse.json({ error: "No current reconciliation row found" }, { status: 404 });
      }
      if (parsed.data.decision === "YES") {
        return NextResponse.json({ error: "Use reassign-owner to approve and write the ownership change to Reftab." }, { status: 400 });
      }
      const decisionValue = parsed.data.decision;
      const saved = await prisma.$transaction(async (tx) => {
        let correctionRequestId: string | null = null;
        if (parsed.data.decision === "NO" || parsed.data.decision === "UNSURE") {
          const correction = await tx.correctionRequest.create({
            data: {
              source: "owner_reconciliation",
              assetTag: row.assetTag,
              subjectEmployeeId: row.ninjaOwner.employeeId,
              currentOwnerEmployeeId: row.reftabOwnerEmployeeId,
              proposedOwnerEmployeeId: row.ninjaOwner.employeeId,
              ninjaDeviceId: row.ninjaDevice.id,
              reason: parsed.data.reason?.trim() || (parsed.data.decision === "NO" ? "Suggested owner rejected" : "Owner requires investigation"),
              details: parsed.data.notes?.trim() || null,
              requesterEmployeeId: access.user.employeeId,
              requesterName: access.user.displayName,
              requesterEmail: access.user.email,
              status: "OPEN",
              auditEvents: {
                create: {
                  action: "CREATED_FROM_RECONCILIATION",
                  newStatus: "OPEN",
                  note: parsed.data.reason?.trim() || null,
                  actorEmployeeId: access.user.employeeId,
                  actorName: access.user.displayName,
                },
              },
            },
          });
          correctionRequestId = correction.id;
        }
        const decision = await tx.reconciliationDecision.create({
          data: {
            assetTag: row.assetTag,
            ninjaDeviceId: row.ninjaDevice.id,
            currentOwnerEmployeeId: row.reftabOwnerEmployeeId,
            proposedOwnerEmployeeId: row.ninjaOwner.employeeId,
            decision: decisionValue,
            reason: parsed.data.reason?.trim() || null,
            notes: parsed.data.notes?.trim() || null,
            decidedByEmployeeId: access.user.employeeId,
            decidedByName: access.user.displayName,
            correctionRequestId,
          },
        });
        await tx.reconciliationAudit.create({
          data: {
            ...actor,
            action: "record-decision", status: "SUCCEEDED",
            assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id,
            previousOwnerEmployeeId: row.reftabOwnerEmployeeId,
            previousOwnerName: row.reftabOwner?.displayName,
            proposedOwnerEmployeeId: row.ninjaOwner.employeeId,
            proposedOwnerName: row.ninjaOwner.displayName,
            decision: decisionValue, reason: parsed.data.reason?.trim() || null,
            decisionId: decision.id,
            notes: parsed.data.notes?.trim() || null,
            evidenceJson: JSON.stringify(row.ownerEvidence),
            correctionRequestId, completedAt: new Date(),
          }
        });
        return { decision, correctionRequestId };
      });
      return NextResponse.json({ ok: true, ...saved });
    }

    const job = await enqueueReconciliation({ ...parsed.data, action: parsed.data.action }, actor);
    return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (e) {
    console.error("[owner-reconciliation] POST failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Owner reconciliation failed" }, { status: 500 });
  }
}
