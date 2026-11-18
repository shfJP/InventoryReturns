import { prisma } from "../src/lib/db";

// Old decisions are retained as historical records, without claiming that the
// earlier API captured an external outcome or login evidence. The unique
// decisionId also makes repeated startups safe.
async function main() {
  let cursor: string | undefined;
  let imported = 0;
  while (true) {
    const decisions = await prisma.reconciliationDecision.findMany({
      orderBy: { id: "asc" }, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!decisions.length) break;
    const employeeIds = [...new Set(decisions.flatMap((decision) =>
      [decision.currentOwnerEmployeeId, decision.proposedOwnerEmployeeId].filter((id): id is string => Boolean(id))))];
    const users = await prisma.user.findMany({
      where: { employeeId: { in: employeeIds } }, select: { employeeId: true, displayName: true },
    });
    const names = new Map(users.map((user) => [user.employeeId, user.displayName]));
    const result = await prisma.reconciliationAudit.createMany({
      skipDuplicates: true,
      data: decisions.map((decision) => ({
        decisionId: decision.id,
        action: "record-decision",
        status: "RECORDED",
        assetTag: decision.assetTag,
        ninjaDeviceId: decision.ninjaDeviceId,
        previousOwnerEmployeeId: decision.currentOwnerEmployeeId,
        previousOwnerName: names.get(decision.currentOwnerEmployeeId ?? ""),
        proposedOwnerEmployeeId: decision.proposedOwnerEmployeeId,
        proposedOwnerName: names.get(decision.proposedOwnerEmployeeId ?? ""),
        actorEmployeeId: decision.decidedByEmployeeId,
        actorName: decision.decidedByName ?? decision.decidedByEmployeeId,
        decision: decision.decision,
        reason: decision.reason,
        notes: [decision.notes, "Imported from an earlier review decision. Login evidence and request outcome were not captured."].filter(Boolean).join("\n"),
        correctionRequestId: decision.correctionRequestId,
        createdAt: decision.createdAt,
        completedAt: decision.createdAt,
      })),
    });
    imported += result.count;
    cursor = decisions[decisions.length - 1].id;
  }
  console.info(`[reconciliation-audit] Imported ${imported} historical decision(s).`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
