import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/access-control";
import { prisma } from "@/lib/db";

const bodySchema = z.object({ eventId: z.string().min(1) });

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const access = await requireCapability(req, "canCloseOut");
  if (!access) {
    return NextResponse.json({ error: "Forbidden: IT or administrator access is required" }, { status: 403 });
  }
  const employeeId = access.user.employeeId;
  const user = await prisma.user.findUnique({
    where: { employeeId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const event = await prisma.collectionEvent.findUnique({
    where: { id: parsed.data.eventId },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (event.status === "CLOSED_OUT") {
    return NextResponse.json({ error: "Already closed out" }, { status: 400 });
  }
  if (event.status !== "COLLECTED_PENDING_IT") {
    return NextResponse.json({ error: `Cannot close an event in ${event.status} status` }, { status: 409 });
  }

  await prisma.collectionEvent.update({
    where: { id: parsed.data.eventId },
    data: {
      status: "CLOSED_OUT",
      closedOutByItEmployeeId: user.id,
      closedOutAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, eventId: parsed.data.eventId, status: "CLOSED_OUT" });
}
