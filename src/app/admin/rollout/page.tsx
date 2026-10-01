"use client";

import { useEffect, useState } from "react";

type Checklist = {
  dataReviewed: boolean;
  workflowApproved: boolean;
  securityApproved: boolean;
  pilotComplete: boolean;
  trainingComplete: boolean;
  communicationsSent: boolean;
  launchApproved: boolean;
  notes: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Readiness = {
  checklist: Checklist;
  data: Record<string, number>;
  configuration: Record<string, boolean | number>;
};

const labels: Record<keyof Omit<Checklist, "notes" | "updatedAt" | "updatedBy">, string> = {
  dataReviewed: "Starting dataset reviewed and accepted",
  workflowApproved: "Employee-exit return workflow approved",
  securityApproved: "Security groups and role access approved",
  pilotComplete: "Pilot group completed testing",
  trainingComplete: "IT and manager training completed",
  communicationsSent: "Launch communications sent",
  launchApproved: "Business owner approved launch",
};

export default function RolloutPage() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/rollout").then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load rollout readiness");
      return data;
    }).then(setReadiness).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load"));
  }, []);

  async function save() {
    if (!readiness) return;
    const res = await fetch("/api/admin/rollout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readiness.checklist),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
    setReadiness({ ...readiness, checklist: data });
    setMessage("Rollout checklist saved.");
  }

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>;
  if (!readiness) return <p className="text-[var(--muted)]">Loading readiness…</p>;
  const completed = Object.keys(labels).filter((key) => readiness.checklist[key as keyof Checklist] === true).length;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Pilot and rollout readiness</h1><p className="text-[var(--muted)]">Operational checks, data cleanup evidence, and formal launch sign-off.</p></div>
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(readiness.data).map(([key, value]) => <Metric key={key} label={key} value={value} />)}
      </div>
      <section className="card">
        <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Launch checklist</h2><span className="text-sm text-[var(--muted)]">{completed}/{Object.keys(labels).length} complete</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(Object.entries(labels) as Array<[keyof typeof labels, string]>).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
              <input type="checkbox" checked={readiness.checklist[key]} onChange={(event) => setReadiness({ ...readiness, checklist: { ...readiness.checklist, [key]: event.target.checked } })} className="h-4 w-4" />
              <span className="text-sm font-medium">{label}</span>
            </label>
          ))}
        </div>
        <label className="mt-4 block text-sm font-medium">Notes
          <textarea value={readiness.checklist.notes} onChange={(event) => setReadiness({ ...readiness, checklist: { ...readiness.checklist, notes: event.target.value } })} className="mt-1 min-h-28 w-full rounded-lg border border-[var(--border)] px-3 py-2" />
        </label>
        <button type="button" onClick={save} className="btn-primary mt-4">Save checklist</button>
      </section>
      <section className="card">
        <h2 className="text-lg font-semibold">Deployment configuration</h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(readiness.configuration).map(([key, value]) => <div key={key}><dt className="text-xs font-medium uppercase text-[var(--muted)]">{key}</dt><dd className="mt-1 text-sm">{typeof value === "boolean" ? value ? "Configured" : "Not configured" : value}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="card"><p className="break-words text-xs uppercase text-[var(--muted)]">{label.replaceAll(/([A-Z])/g, " $1")}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>;
}
