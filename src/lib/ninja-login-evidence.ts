export const LOGIN_WINDOW_DAYS = 30;
const DAY = 86_400_000;

export type LoginObservation = { username: string; loggedOnAt: Date };
export type OwnerLoginEvidence = {
  signal: "strong" | "moderate" | "weak" | "insufficient" | "stale";
  explanation: string;
  windowDays: number;
  totalLogins: number;
  proposedOwnerLogins: number;
  currentOwnerLogins: number;
  otherLogins: number;
  unresolvedLogins: number;
  proposedOwnerShare: number | null;
  proposedOwnerDays: number;
  lastProposedLoginAt: string | null;
  collectionStartedAt: string | null;
  lastCheckedAt: string | null;
  users: { name: string; employeeId: string | null; count: number }[];
};

// NinjaOne's last-logged-on-user endpoint supplies Unix seconds. Also accept
// milliseconds/ISO values for stored snapshots; invalid or future times are omitted.
export function parseLoginTime(value: unknown, now = new Date()): Date | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) && date.getTime() > 0 && date.getTime() <= now.getTime()
    ? date : null;
}

export function loginFromSnapshot(value: unknown, now = new Date()): LoginObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawName = record.userName ?? record.username;
  const username = typeof rawName === "string" ? rawName.trim().toLowerCase() : "";
  const loggedOnAt = parseLoginTime(record.logonTime, now);
  return username && loggedOnAt ? { username, loggedOnAt } : null;
}

export function buildOwnerLoginEvidence(input: {
  observations: LoginObservation[];
  proposedOwnerEmployeeId: string;
  currentOwnerEmployeeId: string;
  resolveUser: (username: string) => { employeeId: string; displayName: string } | null;
  collectionStartedAt: Date | null;
  lastCheckedAt: Date | null;
  now?: Date;
}): OwnerLoginEvidence {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - LOGIN_WINDOW_DAYS * DAY;
  // Deduplicate by resolved identity and timestamp too, so equivalent aliases
  // cannot inflate the signal when the endpoint changes username formatting.
  const sessions = new Map<string, { name: string; employeeId: string | null; date: Date }>();
  for (const observation of input.observations) {
    const time = observation.loggedOnAt.getTime();
    if (!Number.isFinite(time) || time < cutoff || time > now.getTime()) continue;
    const user = input.resolveUser(observation.username);
    const identity = user?.employeeId ?? observation.username.trim().toLowerCase();
    sessions.set(`${identity}\u0000${time}`, {
      name: user?.displayName ?? observation.username,
      employeeId: user?.employeeId ?? null,
      date: observation.loggedOnAt,
    });
  }
  const proposed = [...sessions.values()].filter((session) => session.employeeId === input.proposedOwnerEmployeeId);
  const total = sessions.size;
  const days = new Set(proposed.map((session) => session.date.toISOString().slice(0, 10))).size;
  const latest = proposed.reduce((last, session) => Math.max(last, session.date.getTime()), 0);
  const current = [...sessions.values()].filter((session) => session.employeeId === input.currentOwnerEmployeeId).length;
  const unresolved = [...sessions.values()].filter((session) => session.employeeId === null).length;
  const share = total ? proposed.length / total : null;
  const users = new Map<string, OwnerLoginEvidence["users"][number]>();
  for (const session of sessions.values()) {
    const key = session.employeeId ?? session.name;
    const entry = users.get(key) ?? { name: session.name, employeeId: session.employeeId, count: 0 };
    entry.count++;
    users.set(key, entry);
  }
  let signal: OwnerLoginEvidence["signal"] = "insufficient";
  let explanation = "Not enough distinct observed logins to assess ownership.";
  const checkAge = input.lastCheckedAt ? now.getTime() - input.lastCheckedAt.getTime() : NaN;
  const fresh = Number.isFinite(checkAge) && checkAge >= 0 && checkAge <= 2 * DAY;
  if (total && !fresh) {
    signal = "stale";
    explanation = "Login evidence has not been checked successfully in the last 48 hours.";
  } else if (total >= 3 && (proposed.length === 0 || latest < now.getTime() - 7 * DAY || (share ?? 0) < 0.5 || current >= proposed.length)) {
    signal = "weak";
    explanation = "Recent usage does not consistently support the suggested owner.";
  } else if (total >= 5 && proposed.length >= 5 && days >= 3 && (share ?? 0) >= 0.8 && latest >= now.getTime() - 7 * DAY) {
    signal = "strong";
    explanation = "Suggested owner has at least 5 observed logins across 3 days, at least 80% of usage, and a login within 7 days.";
  } else if (proposed.length >= 3 && days >= 2 && (share ?? 0) >= 0.6 && latest >= now.getTime() - 7 * DAY) {
    signal = "moderate";
    explanation = "Suggested owner has at least 3 observed logins across 2 days, at least 60% of usage, and a login within 7 days.";
  }
  return {
    signal, explanation, windowDays: LOGIN_WINDOW_DAYS,
    totalLogins: total, proposedOwnerLogins: proposed.length, currentOwnerLogins: current,
    otherLogins: total - proposed.length - current,
    unresolvedLogins: unresolved,
    proposedOwnerShare: share === null ? null : Math.round(share * 100),
    proposedOwnerDays: days,
    lastProposedLoginAt: latest ? new Date(latest).toISOString() : null,
    collectionStartedAt: input.collectionStartedAt?.toISOString() ?? null,
    lastCheckedAt: input.lastCheckedAt?.toISOString() ?? null,
    users: [...users.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
