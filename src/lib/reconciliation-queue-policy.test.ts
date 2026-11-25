import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedRecipientMatches, failedJobStatus, retryAt } from "./reconciliation-queue-policy";

test("uncertain external writes always require verification, including changed recipients", () => {
  assert.equal(failedJobStatus(true, true), "REVIEW_REQUIRED");
  assert.equal(failedJobStatus(true, false), "REVIEW_REQUIRED");
  assert.equal(failedJobStatus(false, true), "BLOCKED");
  assert.equal(failedJobStatus(false, false), "FAILED");
});

test("safe retries back off from five minutes to a maximum of one day", () => {
  const now = Date.parse("2026-11-25T15:00:00Z");
  assert.equal(retryAt(1, now).getTime() - now, 5 * 60_000);
  assert.equal(retryAt(3, now).getTime() - now, 20 * 60_000);
  assert.equal(retryAt(50, now).getTime() - now, 24 * 60 * 60_000);
});

test("saved approvals require the same recipient and reject missing legacy recipients", () => {
  assert.equal(approvedRecipientMatches("Owner@Example.test", "owner@example.test"), true);
  assert.equal(approvedRecipientMatches("old@example.test", "new@example.test"), false);
  assert.equal(approvedRecipientMatches(null, "new@example.test"), false);
  assert.equal(approvedRecipientMatches("owner@example.test", undefined), false);
});
