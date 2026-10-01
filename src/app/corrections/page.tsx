"use client";

import { FormEvent, useEffect, useState } from "react";

type Correction = {
  id: string;
  assetTag: string | null;
  subjectEmployeeId: string | null;
  currentOwnerEmployeeId: string | null;
  proposedOwnerEmployeeId: string | null;
  reason: string;
  details: string | null;
  status: string;
  priority: string;
  requesterName: string | null;
  assignedToEmployeeId: string | null;
  resolutionNotes: string | null;
  createdAt: string;
};

export default function CorrectionsPage() {
  const [items, setItems] = useState<Correction[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    assetTag: "",
    subjectEmployeeId: "",
    currentOwnerEmployeeId: "",
    proposedOwnerEmployeeId: "",
    reason: "",
    details: "",
    priority: "NORMAL",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const assetTag = params.get("assetTag")?.trim() ?? "";
    const employeeId = params.get("employeeId")?.trim() ?? "";
    if (!assetTag && !employeeId) return;
    setForm((previous) => ({
      ...previous,
      assetTag: assetTag || previous.assetTag,
      subjectEmployeeId: employeeId || previous.subjectEmployeeId,
      currentOwnerEmployeeId: employeeId || previous.currentOwnerEmployeeId,
      reason: previous.reason || "Equipment assignment appears incorrect",
    }));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/corrections");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load correction requests");
      setItems(data.items ?? []);
      setCanManage(Boolean(data.canManage));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load correction requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const res = await fetch("/api/corrections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to create correction request");
      return;
    }
    setForm({ assetTag: "", subjectEmployeeId: "", currentOwnerEmployeeId: "", proposedOwnerEmployeeId: "", reason: "", details: "", priority: "NORMAL" });
    setMessage("Correction request submitted to the review queue.");
    await load();
  }

  async function changeStatus(id: string, status: string) {
    const resolutionNotes = window.prompt(status === "RESOLVED" ? "Resolution notes" : "Review note") ?? "";
    const res = await fetch("/api/corrections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, resolutionNotes }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to update correction");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Inventory corrections</h1>
        <p className="text-[var(--muted)]">Report incorrect ownership or equipment details and follow the IT review to completion.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}

      <form onSubmit={submit} className="grid gap-4 rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm sm:grid-cols-2">
        <Field label="Asset tag" value={form.assetTag} onChange={(value) => setForm({ ...form, assetTag: value })} />
        <Field label="Employee ID affected" value={form.subjectEmployeeId} onChange={(value) => setForm({ ...form, subjectEmployeeId: value })} />
        <Field label="Current owner employee ID" value={form.currentOwnerEmployeeId} onChange={(value) => setForm({ ...form, currentOwnerEmployeeId: value })} />
        <Field label="Proposed owner employee ID" value={form.proposedOwnerEmployeeId} onChange={(value) => setForm({ ...form, proposedOwnerEmployeeId: value })} />
        <label className="text-sm font-medium text-[var(--text)]">
          Priority
          <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2">
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </label>
        <Field label="Reason *" required value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} />
        <label className="sm:col-span-2 text-sm font-medium text-[var(--text)]">
          Details
          <textarea value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border)] px-3 py-2" />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary">Submit correction</button>
        </div>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text)]">Correction queue</h2>
        {loading ? <p className="text-[var(--muted)]">Loading…</p> : items.length === 0 ? <p className="card text-[var(--muted)]">No correction requests.</p> : (
          <div className="grid gap-3">
            {items.map((item) => (
              <article key={item.id} className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--text)]">{item.assetTag || "General inventory correction"} · {item.reason}</h3>
                    <p className="text-sm text-[var(--muted)]">
                      {item.subjectEmployeeId ? `Employee ${item.subjectEmployeeId} · ` : ""}Submitted by {item.requesterName || "Unknown"} on {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">{item.status}</span>
                </div>
                {item.details && <p className="mt-3 text-sm text-[var(--text-secondary)]">{item.details}</p>}
                <div className="mt-3 text-xs text-[var(--muted)]">
                  Current: {item.currentOwnerEmployeeId || "unknown"} → Proposed: {item.proposedOwnerEmployeeId || "not supplied"} · Priority {item.priority}
                </div>
                {canManage && !["RESOLVED", "REJECTED"].includes(item.status) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => changeStatus(item.id, "IN_REVIEW")} className="btn-secondary">Start review</button>
                    <button type="button" onClick={() => changeStatus(item.id, "RESOLVED")} className="btn-success">Resolve</button>
                    <button type="button" onClick={() => changeStatus(item.id, "REJECTED")} className="btn-secondary">Reject</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="text-sm font-medium text-[var(--text)]">
      {label}
      <input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2" />
    </label>
  );
}
