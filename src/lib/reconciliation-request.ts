// An import performs multiple sequential Reftab calls, each with its own
// server timeout. Keep waiting through that workflow, including the response body.
const RECONCILIATION_REQUEST_TIMEOUT_MS = 5 * 60_000;

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
    const data: Record<string, unknown> = await readReconciliationResponse(res).catch((error) => {
      if (controller.signal.aborted || res.ok) throw error;
      return { error: error instanceof Error ? error.message : "Server returned a non-JSON response" };
    });
    return { res, data };
  } catch (error) {
    const detail = controller.signal.aborted
      ? "Reftab action is still unconfirmed after waiting five minutes."
      : error instanceof Error ? error.message : "The Reftab response could not be received.";
    // Never retry a write automatically: disconnecting does not stop the server.
    throw new Error(`${detail} The server may still complete the action. Check Reftab and the reconciliation audit history, then refresh this page before retrying.`);
  } finally {
    clearTimeout(timeout);
  }
}
