import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getAccessProfile } from "@/lib/access-control";
import { confirmHardwareDecommission, verifyHardwareDecommission } from "@/lib/hardware-decommission";
import { enqueueReconciliation } from "@/lib/reconciliation-jobs";
import { canDecommissionNinjaOne } from "@/lib/ninjaone";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), ninjaDeviceId: z.string().min(1), assetTag: z.string().min(1), categoryId: z.string().regex(/^[1-9]\d*$/) }),
  z.object({ action: z.literal("verify"), id: z.string().min(1) }),
  z.object({ action: z.literal("status"), id: z.string().min(1).optional(), ninjaDeviceId: z.string().min(1).optional() }),
  z.object({ action: z.literal("confirm"), id: z.string().min(1), choice: z.enum(["keep", "remove"]), confirmedInReftab: z.literal(true) }),
]);

export async function GET(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  try {
    const requestedPage = Number(req.nextUrl.searchParams.get("page") ?? "1");
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
    const [workflows, total] = await Promise.all([
      prisma.hardwareDecommission.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 25, take: 25 }),
      prisma.hardwareDecommission.count(),
    ]);
    return NextResponse.json({ workflows, total, canRemoveFromNinjaOne: canDecommissionNinjaOne() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load decommission records" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) return NextResponse.json({ error: "Forbidden: reconciliation access is required" }, { status: 403 });
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid decommission request", details: parsed.error.flatten() }, { status: 400 });
  const actor = { actorEmployeeId: access.user.employeeId, actorName: access.user.displayName, actorEmail: access.user.email };
  try {
    const input = parsed.data;
    if (input.action === "status") {
      if (!input.id && !input.ninjaDeviceId) return NextResponse.json({ error: "A decommission reference is required" }, { status: 400 });
      const workflow = await prisma.hardwareDecommission.findUnique({
        where: input.id ? { id: input.id } : { ninjaDeviceId: input.ninjaDeviceId! },
      });
      return NextResponse.json({ workflow });
    }
    if (input.action === "verify") return NextResponse.json({ ok: true, ...await verifyHardwareDecommission(input.id, actor) });
    if (input.action === "create") {
      const job = await enqueueReconciliation({ ...input, action: "decommission-missing-asset" }, actor);
      return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
    }
    const workflow = await confirmHardwareDecommission(input, actor);
    return NextResponse.json({ ok: true, workflow });
  } catch (error) {
    console.error("[hardware-decommission] Action failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Decommission action failed. Check its saved status before retrying." }, { status: 409 });
  }
}
