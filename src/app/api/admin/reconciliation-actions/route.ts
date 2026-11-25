import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAccessProfile } from "@/lib/access-control";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
const schema = z.object({ id: z.string().min(1), action: z.enum(["retry", "cancel"]),
  categoryId: z.string().regex(/^[1-9]\d*$/).optional() });

export async function POST(req: NextRequest) {
  const access = await getAccessProfile(req);
  if (!access?.canReconcile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  try {
    const { id, action, categoryId } = parsed.data;
    await prisma.$transaction(async (tx) => {
      const job = await tx.reconciliationJob.findUniqueOrThrow({ where: { id } });
      if (!(action === "retry" ? ["FAILED"] : ["FAILED", "BLOCKED"]).includes(job.status)) {
        throw new Error("This action cannot be changed in its current state. Uncertain writes must be verified first.");
      }
      if (action === "retry" && job.action !== "decommission-missing-asset" && !job.recipientEmail) {
        throw new Error("This historical action has no saved recipient. Return it to review and approve the current recipient.");
      }
      const changed = await tx.reconciliationJob.updateMany({ where: { id, status: job.status, updatedAt: job.updatedAt },
        data: action === "retry" ? { status: "QUEUED", nextAttemptAt: null, completedAt: null,
          ...(categoryId ? { categoryId } : {}) } : { status: "CANCELLED", nextAttemptAt: null, completedAt: new Date() } });
      if (!changed.count) throw new Error("The worker already changed this action. Refresh its status.");
      await tx.reconciliationAudit.create({ data: {
        jobId: id, action: action === "retry" ? "retry-queued-action" : "cancel-queued-action", status: "SUCCEEDED",
        assetTag: job.assetTag, ninjaDeviceId: job.ninjaDeviceId,
        actorEmployeeId: access.user.employeeId, actorName: access.user.displayName, actorEmail: access.user.email,
        notes: action === "retry" ? `Requested a retry${categoryId ? ` with category ${categoryId}` : ""}. Original approval retained.`
          : "Returned the saved action to Ownership Review.", completedAt: new Date(),
      } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update action" }, { status: 409 });
  }
}
