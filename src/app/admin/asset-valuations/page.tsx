"use client";

import { useEffect, useState } from "react";

type Asset = {
  id: string;
  assetTag: string;
  serial: string | null;
  title: string | null;
  catName: string | null;
  assignedToEmployeeId: string;
  purchaseValueCents: number | null;
  replacementValueCents: number | null;
  bookValueCents: number | null;
  purchaseDate: string | null;
  user: { displayName: string; division: string | null; department: string | null; subdivision: string | null } | null;
};

function dollars(cents: number | null) { return cents === null ? "" : (cents / 100).toFixed(2); }
function cents(value: string) { return value.trim() === "" ? null : Math.max(0, Math.round(Number(value) * 100)); }

export default function AssetValuationsPage() {
  const [items, setItems] = useState<Asset[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  async function load(search = "") {
    const res = await fetch(`/api/admin/asset-valuations${search ? `?search=${encodeURIComponent(search)}` : ""}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to load assets"); return; }
    setItems(data.items ?? []);
  }
  useEffect(() => { void load(); }, []);

  function updateLocal(id: string, key: keyof Asset, value: unknown) {
    setItems((previous) => previous.map((item) => item.id === id ? { ...item, [key]: value } : item));
  }
  async function save(item: Asset) {
    setSaving(item.id);
    const res = await fetch("/api/admin/asset-valuations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        purchaseValueCents: item.purchaseValueCents,
        replacementValueCents: item.replacementValueCents,
        bookValueCents: item.bookValueCents,
        purchaseDate: item.purchaseDate ? new Date(item.purchaseDate).toISOString() : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Failed to save asset valuation");
    setSaving(null);
  }

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Per-asset valuations</h1><p className="text-[var(--muted)]">Maintain purchase, replacement, and current book values used by executive reports.</p></div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    <form onSubmit={(event) => { event.preventDefault(); void load(query); }} className="flex gap-2"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search asset, serial, title, or employee" className="input-search max-w-xl" /><button className="btn-secondary">Search</button></form>
    <div className="grid gap-3">
      {items.map((item) => <article key={item.id} className="card">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{item.assetTag} · {item.title ?? item.catName ?? "Asset"}</h2><p className="text-sm text-[var(--muted)]">{item.user?.displayName ?? item.assignedToEmployeeId} · {[item.user?.division, item.user?.department, item.user?.subdivision].filter(Boolean).join(" / ") || "No organization"}</p></div><button type="button" onClick={() => save(item)} disabled={saving === item.id} className="btn-primary">{saving === item.id ? "Saving…" : "Save"}</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MoneyField label="Purchase value" value={dollars(item.purchaseValueCents)} onChange={(value) => updateLocal(item.id, "purchaseValueCents", cents(value))} />
          <MoneyField label="Replacement value" value={dollars(item.replacementValueCents)} onChange={(value) => updateLocal(item.id, "replacementValueCents", cents(value))} />
          <MoneyField label="Book value" value={dollars(item.bookValueCents)} onChange={(value) => updateLocal(item.id, "bookValueCents", cents(value))} />
          <label className="text-sm font-medium">Purchase date<input type="date" value={item.purchaseDate?.slice(0, 10) ?? ""} onChange={(event) => updateLocal(item.id, "purchaseDate", event.target.value || null)} className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2" /></label>
        </div>
      </article>)}
    </div>
  </div>;
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<div className="relative mt-1"><span className="absolute left-3 top-2 text-[var(--muted)]">$</span><input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-[var(--border)] py-2 pl-7 pr-3" /></div></label>;
}
