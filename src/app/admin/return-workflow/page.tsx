"use client";

import { useEffect, useState } from "react";

type Role = "supervisor" | "hr" | "it" | "designated";
type Config = {
  defaultRecipientRole: Role;
  enabledRecipientRoles: Role[];
  designatedRecipientLabel: string;
  returnInstructions: string;
  requireLocation: boolean;
};

const roleLabels: Record<Role, string> = {
  supervisor: "Supervisor",
  hr: "Human Resources",
  it: "Information Technology",
  designated: "Designated recipient",
};

export default function ReturnWorkflowPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/return-workflow").then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      return data;
    }).then(setConfig).catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load"));
  }, []);

  async function save() {
    if (!config) return;
    const res = await fetch("/api/admin/return-workflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
    setConfig(data);
    setMessage("Return workflow saved.");
  }
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>;
  if (!config) return <p className="text-[var(--muted)]">Loading return workflow…</p>;
  return <div className="mx-auto max-w-3xl space-y-6">
    <div><h1 className="text-2xl font-bold">Employee-exit return workflow</h1><p className="text-[var(--muted)]">Define who physically receives equipment before IT closes the asset record.</p></div>
    {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}
    <section className="card space-y-4">
      <fieldset><legend className="text-sm font-semibold">Allowed recipients</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{(Object.keys(roleLabels) as Role[]).map((role) => <label key={role} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3">
          <input type="checkbox" checked={config.enabledRecipientRoles.includes(role)} onChange={(event) => {
            const enabled = event.target.checked ? [...config.enabledRecipientRoles, role] : config.enabledRecipientRoles.filter((item) => item !== role);
            setConfig({ ...config, enabledRecipientRoles: enabled, defaultRecipientRole: enabled.includes(config.defaultRecipientRole) ? config.defaultRecipientRole : enabled[0] ?? "it" });
          }} />
          {roleLabels[role]}
        </label>)}</div>
      </fieldset>
      <label className="block text-sm font-medium">Default recipient
        <select value={config.defaultRecipientRole} onChange={(event) => setConfig({ ...config, defaultRecipientRole: event.target.value as Role })} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2">
          {config.enabledRecipientRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">Designated recipient label
        <input value={config.designatedRecipientLabel} onChange={(event) => setConfig({ ...config, designatedRecipientLabel: event.target.value })} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2" />
      </label>
      <label className="block text-sm font-medium">Instructions
        <textarea value={config.returnInstructions} onChange={(event) => setConfig({ ...config, returnInstructions: event.target.value })} className="mt-1 min-h-28 w-full rounded-lg border border-[var(--border)] px-3 py-2" />
      </label>
      <label className="flex items-center gap-3"><input type="checkbox" checked={config.requireLocation} onChange={(event) => setConfig({ ...config, requireLocation: event.target.checked })} /><span className="text-sm font-medium">Require a return location when equipment is collected</span></label>
      <button type="button" onClick={save} disabled={config.enabledRecipientRoles.length === 0} className="btn-primary">Save workflow</button>
    </section>
  </div>;
}
