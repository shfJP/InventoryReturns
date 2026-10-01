import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/access-control";
import { prisma } from "@/lib/db";
import { notifyItCollected } from "@/lib/notify";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  eventId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const access = await requireCapability(req, "canCloseOut");
  if (!access) {
    return NextResponse.json({ error: "Forbidden: IT or administrator access is required" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const event = await prisma.collectionEvent.findUnique({
    where: { id: parsed.data.eventId },
    include: {
      markedByManager: {
        select: { employeeId: true, displayName: true },
      },
    },
  });
  if (!event) {
    return NextResponse.json({ error: "Collection event not found" }, { status: 404 });
  }

  const assignee = await prisma.user.findUnique({
    where: { employeeId: event.assignedToEmployeeId },
    select: { displayName: true },
  });
  if (!assignee) {
    return NextResponse.json({ error: "Assigned employee no longer exists in the directory" }, { status: 409 });
  }

  await prisma.collectionEvent.update({
    where: { id: event.id },
    data: {
      notificationStatus: "SENDING",
      notificationError: null,
    },
  });

  const result = await notifyItCollected({
    assetTag: event.assetTag,
    serial: event.serial ?? undefined,
    employeeId: event.assignedToEmployeeId,
    employeeName: assignee.displayName,
    markedByManagerId: event.markedByManager.employeeId,
    markedByManagerName: event.markedByManager.displayName,
    notes: event.notes ?? undefined,
    markedAt: event.markedCollectedAt.toISOString(),
    eventId: event.id,
    returnRecipientRole: event.returnRecipientRole,
    returnLocation: event.returnLocation ?? undefined,
  });

  const updated = await prisma.collectionEvent.update({
    where: { id: event.id },
    data: {
      notificationStatus: result.ok ? "SENT" : "FAILED",
      notificationReference: result.reference ?? null,
      notificationError: result.ok ? null : result.error ?? "Notification failed",
    },
    select: {
      id: true,
      notificationStatus: true,
      notificationReference: true,
      notificationError: true,
    },
  });

  if (!result.ok) {
    return NextResponse.json(
      { ...updated, error: updated.notificationError ?? "Notification failed" },
      { status: 502 },
    );
  }
  return NextResponse.json(updated);
}
