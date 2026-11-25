"use client";

import { useEffect, useState } from "react";

type Job = { id: string; assetTag: string; action: string; status: string; error: string | null };
const labels: Record<string, string> = {
  QUEUED: "Queued", RUNNING: "In progress", SUCCEEDED: "Completed",
  FAILED: "Failed", REVIEW_REQUIRED: "Check Reftab — completion unconfirmed",
};

export function BackgroundActions() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch("/api/admin/owner-reconciliation?jobs=1", {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not check background action status.");
        const data = await response.json();
        if (!controller.signal.aborted) { setJobs(data.jobs ?? []); setError(null); }
      } catch {
        if (!controller.signal.aborted) setError("Could not check background action status. Refresh to check again before retrying an action.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 5_000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  if (!jobs.length && !error) return null;
  return <details className="rounded-lg border border-[var(--border)] bg-white p-4" open={jobs.some((job) => job.status === "QUEUED" || job.status === "RUNNING")}>
    <summary className="cursor-pointer font-medium">Recent background actions ({jobs.length})</summary>
    <p className="mt-2 text-sm text-[var(--muted)]">Actions continue if you leave this page. Status updates automatically. Recalculate after a completed action to refresh the tables.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto text-sm">
      {jobs.map((job) => <li key={job.id}>
        <strong>{job.assetTag}</strong> · {job.action === "add-missing-asset" ? "Create and assign asset" : "Change owner"} · {labels[job.status] ?? job.status}
        {job.error && <p className="text-red-700">{job.error}</p>}
        <p className="text-xs text-[var(--muted)]">Action reference: {job.id}</p>
      </li>)}
    </ul>
  </details>;
}
