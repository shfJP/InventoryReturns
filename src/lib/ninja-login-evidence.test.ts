import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOwnerLoginEvidence, loginFromSnapshot, parseLoginTime, type LoginObservation } from "./ninja-login-evidence";
import { buildNinjaUserAliases, resolveNinjaDirectoryUser } from "./ninja-user";

const now = new Date("2026-11-11T18:00:00Z");
const proposed = { employeeId: "A6WL", displayName: "Brenda Doucette", email: "bdoucette@example.test", upn: null, isActive: true };
const current = { employeeId: "OLD", displayName: "Previous Owner", email: "old@example.test", upn: null, isActive: true };
const device = { systemName: "BDOUCETTE-LT550" };
const aliases = buildNinjaUserAliases([proposed, current]);
const login = (day: number, username = "7HILLS\\BDoucette", hour = 12): LoginObservation =>
  ({ username, loggedOnAt: new Date(`2026-11-${String(day).padStart(2, "0")}T${hour}:00:00Z`) });
function evidence(observations: LoginObservation[], lastCheckedAt: Date | null = now) {
  return buildOwnerLoginEvidence({
    observations, lastCheckedAt, collectionStartedAt: new Date("2026-11-01T12:00:00Z"),
    proposedOwnerEmployeeId: proposed.employeeId, currentOwnerEmployeeId: current.employeeId,
    resolveUser: (username) => resolveNinjaDirectoryUser(username, aliases, device), now,
  });
}

test("parses actual NinjaOne snapshots without inventing logins from missing timestamps", () => {
  assert.deepEqual(loginFromSnapshot({ userName: " 7HILLS\\BDoucette ", logonTime: 1794398400 }, now),
    { username: "7hills\\bdoucette", loggedOnAt: new Date(1794398400 * 1000) });
  for (const value of [null, {}, { userName: "user" }, { userName: "user", logonTime: 0 }, { userName: "user", logonTime: "garbage" }]) {
    assert.equal(loginFromSnapshot(value, now), null);
  }
  assert.equal(parseLoginTime("2026-11-12T12:00:00Z", now), null);
  assert.equal(parseLoginTime("", now), null);
  assert.equal(parseLoginTime(Date.parse("2026-11-10T12:00:00Z"), now)?.toISOString(), "2026-11-10T12:00:00.000Z");
});

test("repeat syncs and equivalent directory aliases cannot inflate login counts", () => {
  const result = evidence([login(10), login(10), login(10, "bdoucette@example.test"), login(10, "A6WL")]);
  assert.equal(result.totalLogins, 1);
  assert.equal(result.proposedOwnerLogins, 1);
  assert.equal(result.signal, "insufficient");
});

test("consistent multi-day recent use raises owner support", () => {
  const result = evidence([login(5), login(6), login(7), login(8), login(10)]);
  assert.equal(result.signal, "strong");
  assert.equal(result.proposedOwnerShare, 100);
  assert.equal(result.proposedOwnerDays, 5);
  assert.equal(result.lastProposedLoginAt, "2026-11-10T12:00:00.000Z");
  assert.equal(evidence([login(8), login(9), login(10)]).signal, "moderate");
});

test("many logins on one day do not establish sustained ownership", () => {
  assert.equal(evidence([login(10), login(10, undefined, 13), login(10, undefined, 14), login(10, undefined, 15), login(10, undefined, 16)]).signal, "insufficient");
});

test("competing current-owner usage weakens the suggestion", () => {
  const result = evidence([login(8), login(9, "old@example.test"), login(10, "OLD"), login(11, "7HILLS\\old")]);
  assert.equal(result.signal, "weak");
  assert.equal(result.currentOwnerLogins, 3);
  assert.equal(result.proposedOwnerShare, 25);
});

test("local and unknown accounts remain in the denominator", () => {
  const result = evidence([login(8), login(9, "BDOUCETTE-LT550\\BDoucette"), login(10, ".\\bdoucette"), login(11, "unknown")]);
  assert.equal(result.proposedOwnerLogins, 1);
  assert.equal(result.totalLogins, 4);
  assert.equal(result.otherLogins, 3);
  assert.equal(result.unresolvedLogins, 3);
  assert.equal(result.signal, "weak");
});

test("stale checks and stale proposed logins cannot yield strong support", () => {
  const observations = [login(5), login(6), login(7), login(8), login(10)];
  assert.equal(evidence(observations, new Date("2026-11-01T12:00:00Z")).signal, "stale");
  assert.equal(evidence(observations, new Date("2026-11-12T12:00:00Z")).signal, "stale");
  assert.equal(evidence(observations, null).signal, "stale");
  assert.equal(evidence([login(1), login(2), login(3)]).signal, "weak");
});

test("missing history is insufficient; events outside the window and future events are excluded", () => {
  assert.equal(evidence([]).proposedOwnerShare, null);
  assert.equal(evidence([]).signal, "insufficient");
  assert.equal(evidence([login(12), { username: "bdoucette", loggedOnAt: new Date("2026-09-01") }]).totalLogins, 0);
});

test("ambiguous directory usernames are unresolved while exact emails still resolve", () => {
  const duplicate = { ...proposed, employeeId: "OTHER", email: "bdoucette@other.test", displayName: "Other Person" };
  const ambiguous = buildNinjaUserAliases([proposed, duplicate]);
  assert.equal(resolveNinjaDirectoryUser("7HILLS\\BDoucette", ambiguous, device), null);
  assert.equal(resolveNinjaDirectoryUser(proposed.email, ambiguous, device)?.employeeId, proposed.employeeId);
});
