// The POST only enqueues a durable job. Subsequent GETs observe it without
// holding one HTTP request open through the external Reftab workflow.
const RECONCILIATION_REQUEST_TIMEOUT_MS = 30 * 60_000;

export async function readReconciliationResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const preview = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(`Server returned a non-JSON response (${res.status}). ${preview || "No response body."}`);
  }
}

export async function postReconciliationAction(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RECONCILIATION_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch("/api/admin/owner-reconciliation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: Record<string, unknown> = await readReconciliationResponse(res).catch((error) => {
      if (controller.signal.aborted || res.ok) throw error;
      return { error: error instanceof Error ? error.message : "Server returned a non-JSON response" };
    });
    if (res.status === 202 && typeof data.jobId === "string") {
      const jobId = data.jobId;
      while (true) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new Error("Status polling timed out")); };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", abort);
            resolve();
          }, 2_000);
          controller.signal.addEventListener("abort", abort, { once: true });
          if (controller.signal.aborted) abort();
        });
        const status = await fetch(`/api/admin/owner-reconciliation?job=${encodeURIComponent(jobId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        data = await readReconciliationResponse(status);
        if (!status.ok) throw new Error(typeof data.error === "string" ? data.error : `Could not check job ${jobId}`);
        if (data.status === "SUCCEEDED") {
          return { res: Response.json(data.result), data: data.result as Record<string, unknown> };
        }
        if (data.status === "FAILED" || data.status === "REVIEW_REQUIRED") {
          return { res: Response.json(data, { status: 500 }), data };
        }
      }
    }
    return { res, data };
  } catch (error) {
    const detail = controller.signal.aborted
      ? "Reftab action is still unconfirmed after waiting thirty minutes."
      : error instanceof Error ? error.message : "The Reftab response could not be received.";
    // Never retry a write automatically: disconnecting does not stop the server.
    throw new Error(`${detail} The server may still complete the action. Check recent background actions and the reconciliation audit history, then check Reftab before retrying.`);
  } finally {
    clearTimeout(timeout);
  }
}

// Return as soon as the server has durably saved the decision.
export async function enqueueReconciliationAction(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch("/api/admin/owner-reconciliation", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    const data = await readReconciliationResponse(res);
    if (res.status === 202 && typeof data.jobId !== "string") throw new Error("Missing saved action reference.");
    return { res, data };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : "Could not receive the response."} Check Actions & Audit before resubmitting; the decision may already be saved.`);
  } finally { clearTimeout(timeout); }
}
