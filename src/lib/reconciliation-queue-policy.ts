// Only failures known to have happened before an external write can be retried.
// Pending/uncertain audits are held for verification, regardless of the error text.
export function failedJobStatus(uncertain: boolean, changedRecipient: boolean) {
  return uncertain ? "REVIEW_REQUIRED" : changedRecipient ? "BLOCKED" : "FAILED";
}

export function retryAt(attempts: number, now = Date.now()) {
  return new Date(now + Math.min(24 * 60, 5 * 2 ** Math.min(Math.max(attempts - 1, 0), 9)) * 60_000);
}

export function approvedRecipientMatches(approved: string | null, current: string | undefined) {
  return Boolean(approved && current && approved.toLowerCase() === current.toLowerCase());
}
