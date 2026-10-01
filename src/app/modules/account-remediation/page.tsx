"use client";

import { FormEvent, useEffect, useState } from "react";

type Item = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  system: string;
  issueType: string;
  description: string;
  status: string;
  priority: string;
  requesterName: string | null;
  resolutionNotes: string | null;
  createdAt: string;
};

export default function AccountRemediationPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employeeId: "",
    employeeName: "",
    system: "",
    issueType: "PROVISIONING_FAILED",
    description: "",
    priority: "NORMAL",
  });

  async function load() {
    const res = await fetch("/api/account-remediation");
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to load workflow"); return; }
    setItems(data.items ?? []);
    setCanManage(Boolean(data.canManage));
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const res = await fetch("/api/account-remediation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to submit workflow item"); return; }
    setForm({ employeeId: "", employeeName: "", system: "", issueType: "PROVISIONING_FAILED", description: "", priority: "NORMAL" });
    await load();
  }

  async function update(id: string, status: string) {
    const resolutionNotes = window.prompt("Review or resolution note") ?? "";
    const res = await fetch("/api/account-remediation", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, resolutionNotes }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to update workflow item"); return; }
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Account remediation</h1>
        <p className="text-[var(--muted)]">Escalate provisioning, access, and deprovisioning failures to the account-support queue.</p>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
      <form onSubmit={submit} className="grid gap-4 rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm sm:grid-cols-2">
        <Field label="Employee ID *" required value={form.employeeId} onChange={(value) => setForm({ ...form, employeeId: value })} />
        <Field label="Employee name" value={form.employeeName} onChange={(value) => setForm({ ...form, employeeName: value })} />
        <Field label="System *" required value={form.system} onChange={(value) => setForm({ ...form, system: value })} />
        <label className="text-sm font-medium">Issue type
          <select value={form.issueType} onChange={(event) => setForm({ ...form, issueType: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2">
            <option value="PROVISIONING_FAILED">Provisioning failed</option>
            <option value="ACCOUNT_MISSING">Account missing</option>
            <option value="ACCESS_INCORRECT">Access incorrect</option>
            <option value="DEPROVISIONING_FAILED">Deprovisioning failed</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="text-sm font-medium">Priority
          <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2">
            {["LOW", "NORMAL", "HIGH", "URGENT"].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="sm:col-span-2 text-sm font-medium">Description *
          <textarea required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border border-[var(--border)] px-3 py-2" />
        </label>
        <button type="submit" className="btn-primary sm:col-span-2 sm:w-fit">Submit issue</button>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Workflow queue</h2>
        {items.length === 0 ? <p className="card text-[var(--muted)]">No account-remediation items.</p> : items.map((item) => (
          <article key={item.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h3 className="font-semibold">{item.system}: {item.issueType.replaceAll("_", " ")}</h3>
                <p className="text-sm text-[var(--muted)]">{item.employeeName || item.employeeId} · requested by {item.requesterName || "Unknown"}</p>
              </div>
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">{item.status}</span>
            </div>
            <p className="mt-3 text-sm">{item.description}</p>
            {canManage && !["RESOLVED", "REJECTED"].includes(item.status) && <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => update(item.id, "IN_REVIEW")}>Start review</button>
              <button type="button" className="btn-secondary" onClick={() => update(item.id, "WAITING")}>Waiting</button>
              <button type="button" className="btn-success" onClick={() => update(item.id, "RESOLVED")}>Resolve</button>
              <button type="button" className="btn-secondary" onClick={() => update(item.id, "REJECTED")}>Reject</button>
            </div>}
          </article>
        ))}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, required = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="text-sm font-medium">{label}<input required={required} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2" /></label>;
}
