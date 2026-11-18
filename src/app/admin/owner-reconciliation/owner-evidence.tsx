import type { OwnerLoginEvidence } from "@/lib/ninja-login-evidence";
import { formatContactTimestamp } from "@/lib/date-time";

const signalLabels = {
  strong: "Strong support", moderate: "Moderate support", weak: "Weak support",
  insufficient: "Insufficient history", stale: "Stale evidence",
};

export function OwnerEvidence({ evidence }: { evidence: OwnerLoginEvidence }) {
  const color = evidence.signal === "strong" ? "bg-emerald-50 text-emerald-700"
    : evidence.signal === "moderate" ? "bg-sky-50 text-sky-700"
      : "bg-amber-50 text-amber-800";
  return (
    <div className="min-w-[230px] max-w-sm space-y-1 text-xs text-[var(--muted)]">
      <span title={evidence.explanation} className={`inline-flex rounded-full px-2.5 py-0.5 font-medium ${color}`}>
        {signalLabels[evidence.signal]}
      </span>
      {evidence.totalLogins > 0 ? <>
        <p>{evidence.proposedOwnerLogins} of {evidence.totalLogins} observed logins ({evidence.proposedOwnerShare}%) · {evidence.proposedOwnerDays} day(s)</p>
        <p>Current Reftab owner: {evidence.currentOwnerLogins} · Other accounts: {evidence.otherLogins}</p>
        <p>Suggested owner last login: {formatContactTimestamp(evidence.lastProposedLoginAt, "Not observed")}</p>
      </> : <p>No timestamped logins observed in the last {evidence.windowDays} days.</p>}
      <details>
        <summary className="cursor-pointer text-[var(--accent)]">Usage and coverage</summary>
        <div className="mt-2 space-y-1">
          <p>{evidence.explanation}</p>
          <p>Observed during syncs; sessions between syncs may be missed.</p>
          <p>Collection began: {formatContactTimestamp(evidence.collectionStartedAt, "Not started")}</p>
          <p>Last successful check: {formatContactTimestamp(evidence.lastCheckedAt, "Unavailable")}</p>
          <p>{evidence.unresolvedLogins} login(s) could not be matched to a directory user. These remain in the total.</p>
          {evidence.users.map((user) => <p key={user.employeeId ?? user.name}>
            {user.name}{user.employeeId ? ` (${user.employeeId})` : " (unresolved/local)"}: {user.count}
          </p>)}
        </div>
      </details>
    </div>
  );
}
