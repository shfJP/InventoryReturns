"use client";

import { useEffect, useState } from "react";
import type { ReconciliationAudit } from "@prisma/client";
import type { OwnerLoginEvidence } from "@/lib/ninja-login-evidence";
import { formatContactTimestamp } from "@/lib/date-time";
import { OwnerEvidence } from "./owner-evidence";

type AuditEntry = Omit<ReconciliationAudit, "createdAt" | "completedAt"> & { createdAt: string; completedAt: string | null };
const actions: Record<string, string> = {
  "reassign-owner": "Change owner", "add-missing-asset": "Create and assign asset", "record-decision": "Review decision",
  "decommission-missing-asset": "Create Decommissioned asset", "verify-decommission": "Verify Reftab decommission",
  "confirm-decommission-keep": "Confirm / keep in NinjaOne", "decommission-ninja-device": "Decommission in NinjaOne",
  "verify-ninja-decommission": "Verify NinjaOne decommission",
};
const statuses: Record<string, string> = {
  SUCCEEDED: "Completed", FAILED: "Failed", PENDING: "Pending / incomplete", REVIEW_REQUIRED: "Review required", RECORDED: "Historical decision",
};

function savedEvidence(json: string | null): OwnerLoginEvidence | null {
  if (!json) return null;
  try {
    const evidence = JSON.parse(json) as OwnerLoginEvidence;
    return typeof evidence?.proposedOwnerLogins === "number" ? evidence : null;
  } catch { return null; }
}

export function ReconciliationAuditTable({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const timeout = window.setTimeout(() => { setPage(1); setSearch(query.trim()); }, 300);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({ audit: "1", page: String(page), q: search });
        const response = await fetch(`/api/admin/owner-reconciliation?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load audit history");
        setRows(body.rows);
        setTotal(body.total);
        const lastPage = Math.max(1, Math.ceil(body.total / 25));
        if (page > lastPage) setPage(lastPage);
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load audit history");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, search, refreshKey, reload]);
  const pages = Math.max(1, Math.ceil(total / 25));
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Reconciliation audit log</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Ownership changes, asset creation, hardware decommissions, and review decisions, including failed or incomplete attempts.</p>
        </div>
        <div className="flex gap-2">
          <input aria-label="Search audit log" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search asset, owner, or reviewer" className="input-search" />
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((value) => value + 1)}>Refresh</button>
        </div>
      </div>
      {error && <p role="alert" className="p-4 text-red-700">{error}</p>}
      <div className="overflow-x-auto" aria-busy={loading}>
        <table className="w-full min-w-[1000px]">
          <thead><tr>
            {["When / reviewer", "Asset / device", "Action / result", "Previous owner", "Proposed owner", "Details"].map((label) =>
              <th key={label} className="table-header">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map((row) => {
            const evidence = savedEvidence(row.evidenceJson);
            return <tr key={row.id} className="border-b border-[var(--border)] align-top">
              <td className="table-cell">
                <div>{formatContactTimestamp(row.createdAt, "-")}</div>
                <div className="text-xs text-[var(--muted)]">{row.actorName} ({row.actorEmployeeId})</div>
              </td>
              <td className="table-cell">
                <div className="font-medium">{row.assetTag}</div>
                <div className="text-xs text-[var(--muted)]">NinjaOne {row.ninjaDeviceId}</div>
              </td>
              <td className="table-cell">
                <div>{actions[row.action] ?? row.action}{row.decision ? ` · ${row.decision}` : ""}</div>
                <span className={`text-xs font-medium ${row.status === "SUCCEEDED" ? "text-emerald-700" : "text-amber-800"}`}>
                  {statuses[row.status] ?? row.status}
                </span>
              </td>
              <td className="table-cell">{row.previousOwnerName ?? row.previousOwnerEmployeeId ?? "—"}
                {row.previousOwnerName && <div className="text-xs text-[var(--muted)]">{row.previousOwnerEmployeeId}</div>}
              </td>
              <td className="table-cell">{row.proposedOwnerName ?? row.proposedOwnerEmployeeId ?? "—"}
                {row.proposedOwnerName && <div className="text-xs text-[var(--muted)]">{row.proposedOwnerEmployeeId}</div>}
              </td>
              <td className="table-cell max-w-md space-y-1 break-words text-xs">
                {row.reason && <p>{row.reason}</p>}{row.notes && <p>{row.notes}</p>}
                {row.error && <p className="text-red-700">{row.error}</p>}
                {["PENDING", "REVIEW_REQUIRED"].includes(row.status) && <p>Check {row.action.includes("ninja-decommission") || row.action === "decommission-ninja-device" ? "NinjaOne" : "Reftab"} before retrying.</p>}
                {row.correctionRequestId && <p>Correction request: {row.correctionRequestId}</p>}
                {evidence && <details><summary className="cursor-pointer text-[var(--accent)]">Login evidence at review</summary><OwnerEvidence evidence={evidence} /></details>}
                <details><summary className="cursor-pointer text-[var(--muted)]">Audit reference</summary>
                  <p>{row.id}</p>
                  <p>Completed: {formatContactTimestamp(row.completedAt, "Not recorded")}</p>
                </details>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!error && rows.length === 0 && <p className="p-8 text-center text-[var(--muted)]">{loading ? "Loading audit log..." : "No reconciliation actions recorded."}</p>}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--muted)]">
        <span>{total} record(s) · Page {page} of {pages}{loading ? " · Updating..." : ""}</span>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={loading || page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <button type="button" className="btn-secondary" disabled={loading || page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      </div>
    </section>
  );
}
