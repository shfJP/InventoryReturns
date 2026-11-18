import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ReftabWriteError } from "./reftab-write-error";
import { NinjaOneWriteError } from "./ninjaone";

// Record the attempt before contacting Reftab. A process interruption leaves
// PENDING visible for review; external changes cannot be rolled back by Prisma.
export async function runAuditedReftabChange<T>(
  data: Omit<Prisma.ReconciliationAuditCreateInput, "status">,
  writeReftab: () => Promise<T>,
  saveLocal: (tx: Prisma.TransactionClient, result: T) => Promise<void | { decisionId: string }>,
): Promise<{ result: T; auditId: string }> {
  return runAuditedExternalChange("Reftab", data, writeReftab, saveLocal);
}

export async function runAuditedExternalChange<T>(
  system: "Reftab" | "NinjaOne",
  data: Omit<Prisma.ReconciliationAuditCreateInput, "status">,
  writeExternal: () => Promise<T>,
  saveLocal: (tx: Prisma.TransactionClient, result: T) => Promise<void | { decisionId: string }>,
): Promise<{ result: T; auditId: string }> {
  const audit = await prisma.reconciliationAudit.create({ data: { ...data, status: "PENDING" } });
  let externalCompleted = false;
  try {
    const result = await writeExternal();
    externalCompleted = true;
    await prisma.$transaction(async (tx) => {
      const local = await saveLocal(tx, result);
      await tx.reconciliationAudit.update({
        where: { id: audit.id },
        data: { status: "SUCCEEDED", completedAt: new Date(), resultJson: JSON.stringify(result), ...(local ?? {}) },
      });
    });
    return { result, auditId: audit.id };
  } catch (error) {
    const reviewRequired = externalCompleted || ((error instanceof ReftabWriteError || error instanceof NinjaOneWriteError) && error.outcome !== "rejected");
    const message = error instanceof Error ? error.message : String(error);
    const detail = externalCompleted ? `${system} completed, but saving the local change failed: ${message}` : message;
    try {
      await prisma.reconciliationAudit.update({
        where: { id: audit.id },
        data: { status: reviewRequired ? "REVIEW_REQUIRED" : "FAILED", completedAt: new Date(), error: detail },
      });
    } catch (auditError) {
      console.error(`[reconciliation-audit] Could not finish audit ${audit.id}; attempt remains pending`, auditError);
    }
    throw new Error(`${detail}${reviewRequired ? ` Check ${system} and sync before retrying; the action may have partially applied.` : ""} (Audit ${audit.id})`);
  }
}
