import assert from "node:assert/strict";
import { test } from "node:test";
import { DECOMMISSION_REASON, decommissionAssetNotes, decommissionEligibility } from "./decommission-policy";

const now = new Date("2026-11-11T17:20:30.000Z");
test("decommission eligibility uses a strict calendar-year boundary and actual last contact", () => {
  for (const lastContact of [
    "2025-11-11T17:20:29.999Z",
    String(Date.parse("2025-11-11T17:20:29.999Z")),
    String(Date.parse("2025-11-11T17:20:29.999Z") / 1000),
  ]) {
    assert.equal(decommissionEligibility({ offline: true, lastContact }, now).eligible, true);
  }
  for (const lastContact of [
    "2025-11-11T17:20:30.000Z", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z",
    null, undefined, "", "   ", "not a date", "0", "-1", "Infinity",
  ]) {
    assert.equal(decommissionEligibility({ offline: true, lastContact }, now).eligible, false, String(lastContact));
  }
  for (const offline of [false, null, undefined]) {
    assert.equal(decommissionEligibility({ offline, lastContact: "2024-01-01T00:00:00Z" }, now).eligible, false);
  }
  assert.equal(decommissionEligibility({ offline: true, lastContact: null, ...{ lastUpdate: "2024-01-01" } }, now).eligible, false);
});

test("decommission notes contain the server time, authenticated actor and exact inactivity reason", () => {
  const notes = decommissionAssetNotes({
    id: "workflow-123", ninjaDeviceId: "123", at: now, lastContact: new Date("2024-11-01T12:00:00Z"),
    actorName: "IT Reviewer", actorEmployeeId: "IT123", actorEmail: "it@example.test",
  });
  assert.match(notes, /2026-11-11T17:20:30.000Z \(UTC\) by IT Reviewer \(IT123; it@example.test\)/);
  assert.ok(notes.split("\n").includes(DECOMMISSION_REASON));
  assert.match(notes, /NinjaOne device: 123. Last online: 2024-11-01T12:00:00.000Z/);
  assert.match(notes, /Decommission reference: workflow-123/);
});
