"use client";

import { useCallback, useEffect, useState } from "react";
import { formatContactTimestamp } from "@/lib/date-time";
import { ReconciliationAuditTable } from "../owner-reconciliation/reconciliation-audit-table";
import { HardwareDecommissionPanel } from "../owner-reconciliation/hardware-decommission-panel";

type Job = {
  id: string; action: string; assetTag: string; ninjaDeviceId: string; recipientEmail: string | null;
  actorName: string; actorEmployeeId: string; status: string; attempts: number; error: string | null;
  createdAt: string; completedAt: string | null; nextAttemptAt: string | null;
};
const statuses: Record<string, string> = {
  QUEUED: "Decision saved · queued", RUNNING: "In progress", FAILED: "Failed · retry pending",
  REVIEW_REQUIRED: "Awaiting verification", BLOCKED: "Approval needs review", SUCCEEDED: "Completed", CANCELLED: "Returned to review",
};
const actions: Record<string, string> = {
  "reassign-owner": "Change owner", "add-missing-asset": "Create and assign asset", "decommission-missing-asset": "Create Decommissioned asset",
};
const noop = () => {};

export default function ReconciliationActionsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [workerOnline, setWorkerOnline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [auditJob, setAuditJob] = useState<string | undefined>();
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setHistoryRevision((value) => value + 1);
    }, 10_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    let active = false;
    async function load() {
      if (active) return;
      active = true;
      try {
        const params = new URLSearchParams({ jobs: "1", page: String(page), q: search });
        const response = await fetch(`/api/admin/owner-reconciliation?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load saved actions");
        setJobs(data.jobs); setTotal(data.total); setWorkerOnline(data.workerOnline); setError(null);
        if (page > Math.max(1, Math.ceil(data.total / 25))) setPage(Math.max(1, Math.ceil(data.total / 25)));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load saved actions");
      } finally { active = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [page, search, revision]);

  async function manage(job: Job, action: "retry" | "cancel", categoryId?: string) {
    if (busy) return;
    if (action === "cancel" && !window.confirm(`Return ${job.assetTag} to Ownership Review? Its saved approval will be cancelled; its history remains available.`)) return;
    setBusy(job.id); setError(null);
    try {
      const response = await fetch("/api/admin/reconciliation-actions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: job.id, action, categoryId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update action");
      refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update action"); }
    finally { setBusy(null); }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold">Actions &amp; Audit</h1>
        <p className="mt-2 text-sm">Saved decisions leave Ownership Review immediately. This page tracks execution, retries, and completed work.</p>
      </div>
      <a href="/admin/owner-reconciliation" className="btn-secondary">Ownership Review</a>
    </div>
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 text-sm space-y-2">
      <p>{workerOnline ? "Background worker is online." : "No recent worker heartbeat. Saved decisions remain queued for the worker or scheduled maintenance."} Status refreshes every five seconds.</p>
      <p>Safe failures retry automatically with increasing delays. Fix the reported sync, credentials, or category issue; the original approval and recipient are retained. You can request an earlier retry below.</p>
      <p>Uncertain writes are checked against Reftab automatically before completion. Recipient changes require review. Decommissions still require visual confirmation below before optional NinjaOne removal.</p>
    </div>
    <section className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
      <div className="p-4 flex flex-wrap justify-between gap-3">
        <h2 className="font-semibold">Saved actions ({total})</h2>
        <input type="search" aria-label="Search saved actions" className="input-search" placeholder="Asset, device, recipient, or staff" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="btn-secondary" onClick={refresh}>Refresh</button>
      </div>
      {error && <p role="alert" className="p-4 text-red-700">{error}</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
        <thead><tr>{["Submitted / approved by", "Item / approved action", "Status", "Issue / next step"].map((label) => <th className="table-header" key={label}>{label}</th>)}</tr></thead>
        <tbody>{jobs.map((job) => <tr key={job.id} className="border-t border-[var(--border)] align-top">
          <td className="table-cell"><p>{formatContactTimestamp(job.createdAt)}</p><p>{job.actorName}</p>
            <p className="text-xs text-[var(--muted)]">{job.actorEmployeeId.startsWith("system:") ? "Automation" : "Staff approval · background execution"}</p></td>
          <td className="table-cell"><p className="font-semibold">{job.assetTag}</p><p>NinjaOne {job.ninjaDeviceId}</p><p>{actions[job.action] ?? job.action}</p><p>{job.recipientEmail}</p>
            <button className="text-sm underline" onClick={() => setAuditJob(job.id)}>View attempts in audit</button></td>
          <td className="table-cell"><p className={job.status === "SUCCEEDED" ? "text-emerald-700" : "text-amber-800"}>{statuses[job.status] ?? job.status}</p><p>{job.attempts} attempt(s)</p>
            {job.nextAttemptAt && <p className="text-xs">Next {["REVIEW_REQUIRED", "BLOCKED"].includes(job.status) ? "verification" : "retry"}: {formatContactTimestamp(job.nextAttemptAt)}</p>}
            {job.status === "SUCCEEDED" && <p className="text-xs">{formatContactTimestamp(job.completedAt)}</p>}</td>
          <td className="table-cell max-w-lg space-y-2"><p className="break-words text-sm text-red-700">{job.error}</p>
            {job.status === "FAILED" && <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => void manage(job, "retry")}>Retry now</button>
              <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => {
                const category = window.prompt("Reftab category ID for this saved action:");
                if (category && /^[1-9]\d*$/.test(category.trim())) void manage(job, "retry", category.trim());
              }}>Set category &amp; retry</button>
            </div>}
            {["FAILED", "BLOCKED"].includes(job.status) && <button className="btn-secondary" disabled={Boolean(busy)} onClick={() => void manage(job, "cancel")}>Return to review</button>}
            {job.status === "REVIEW_REQUIRED" && <p className="text-sm">Automatic readback will confirm the approved result when available. Check Reftab and the linked audit if the result remains unconfirmed.</p>}
            {job.status === "SUCCEEDED" && job.action === "decommission-missing-asset" && <p className="text-sm">Reftab creation complete. Continue visual confirmation in Hardware decommissions below.</p>}
            <p className="text-xs text-[var(--muted)]">Reference: {job.id}</p>
          </td>
        </tr>)}</tbody>
      </table></div>
      {!jobs.length && <p className="p-6 text-sm">No saved actions found.</p>}
      <div className="p-4 flex items-center justify-between"><span>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span><div className="flex gap-2">
        <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
        <button className="btn-secondary" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>Next</button>
      </div></div>
    </section>
    <HardwareDecommissionPanel candidate={null} onDismiss={noop} onReserved={noop} onAttempt={refresh} refreshKey={revision + historyRevision} />
    {auditJob && <button className="btn-secondary" onClick={() => setAuditJob(undefined)}>Show all audit history</button>}
    <ReconciliationAuditTable key={auditJob ?? "all"} jobId={auditJob} refreshKey={revision + historyRevision} />
  </div>;
}
