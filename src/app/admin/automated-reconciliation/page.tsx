"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { OwnerReconciliationResult } from "@/lib/owner-reconciliation";
import { automaticOwnerPolicy } from "@/lib/reconciliation-scope";
import { ReconciliationAuditTable } from "../owner-reconciliation/reconciliation-audit-table";

type ResponseData = OwnerReconciliationResult & {
  cache: { generatedAt: string };
  automationRun: {
    mode: string; state: string; stage: string; startedAt: string; finishedAt: string | null;
    error: string | null; reconciliation: { completed: number; skipped: number; failed: number } | null;
  } | null;
};

export default function AutomatedReconciliationPage() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/owner-reconciliation?view=automated${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load automation");
      setData(body);
      setError(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load automation");
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pending = [
    ...(data?.rows ?? []).map((row) => ({
      key: row.id, asset: row.assetTag, device: row.ninjaDevice.systemName ?? row.ninjaDevice.id,
      policy: automaticOwnerPolicy(row), action: "Check in and check out to new owner",
      previous: row.reftabOwner?.displayName ?? row.reftabOwnerEmployeeId,
      next: automaticOwnerPolicy(row)?.startsWith("House") ? "ithelp@sevenhills.org" : row.ninjaOwner.email,
    })),
    ...(data?.missingReftabRows ?? []).map((row) => ({
      key: row.id, asset: row.assetTag, device: row.ninjaDevice.systemName ?? row.ninjaDevice.id,
      policy: "House → IT Help", action: "Create asset and assign", previous: "Missing from Reftab",
      next: "ithelp@sevenhills.org",
    })),
  ];
  const run = data?.automationRun;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">Automated Reconciliation</h1>
        <p className="text-[var(--muted)]">House computers go to ithelp@sevenhills.org. Existing computers ending in -LT follow their active NinjaOne owner.</p>
        <p className="text-sm text-[var(--muted)]">Ownership changes check in the existing loan and check out to the new owner. Missing ordinary laptops still require <Link href="/admin/owner-reconciliation" className="underline">manual remediation</Link>.</p>
      </div>
      <button className="btn-secondary" disabled={busy} onClick={() => void load(true)}>{busy ? "Refreshing..." : "Refresh status"}</button>
    </div>
    {error && <p role="alert" className="rounded border border-red-200 p-4 text-red-700">{error}</p>}
    <section className="rounded-lg border border-[var(--border)] bg-white p-4 space-y-2">
      <h2 className="font-semibold">Scheduled maintenance</h2>
      {run ? <>
        <p>{run.state} · {run.mode} · Last stage: {run.stage}</p>
        <p className="text-sm">Started {new Date(run.startedAt).toLocaleString()} · Finished {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "Not recorded"}</p>
        {run.reconciliation && <p>{run.reconciliation.completed} completed · {run.reconciliation.skipped} skipped · {run.reconciliation.failed} failed</p>}
        {run.error && <p className="text-red-700">{run.error}</p>}
        {run.state === "running" && <p className="text-sm">If the scheduled process was interrupted, completion will remain unrecorded. Check Coolify task logs.</p>}
      </> : <p>No external scheduled run recorded yet.</p>}
      <p className="text-sm text-[var(--muted)]">A skipped item can have an unconfirmed prior write, a conflicting match, or another action in progress. Review the audit log before retrying.</p>
    </section>
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white">
      <div className="p-4">
        <h2 className="font-semibold">Pending automation ({pending.length})</h2>
        <p className="text-sm text-[var(--muted)]">{data?.rows.length ?? 0} owner changes · {data?.missingReftabRows.length ?? 0} House imports. Calculated from synced inventory{data ? ` at ${new Date(data.cache.generatedAt).toLocaleString()}` : ""}. Completed items leave this queue.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full">
        <thead><tr>{["Asset / device", "Policy", "Current Reftab owner", "Target owner", "Action"].map((label) => <th className="table-header" key={label}>{label}</th>)}</tr></thead>
        <tbody>{pending.map((row) => <tr key={row.key} className="border-t border-[var(--border)]">
          <td className="table-cell">{row.asset}<div className="text-xs">{row.device}</div></td>
          <td className="table-cell">{row.policy}</td><td className="table-cell">{row.previous}</td>
          <td className="table-cell">{row.next}</td><td className="table-cell">{row.action}</td>
        </tr>)}</tbody>
      </table></div>
      {data && pending.length === 0 && <p className="p-4 text-[var(--muted)]">No eligible changes pending in the current snapshot.</p>}
    </section>
    <ReconciliationAuditTable refreshKey={revision} automated />
  </div>;
}
