"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { OwnerReconciliationResult } from "@/lib/owner-reconciliation";

type ResponseData = OwnerReconciliationResult & { cache: { generatedAt: string } };

export default function NoOwnerSignalPage() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/owner-reconciliation?view=no-owner-signal${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load devices without an owner signal.");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load devices without an owner signal.");
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const search = query.trim().toLowerCase();
  const rows = (data?.reportItems ?? []).filter((row) =>
    [row.assetTag, row.serial, row.title, row.ninjaDeviceId].some((value) => value?.toLowerCase().includes(search)));
  const missingIds = new Set(data?.missingReftabRows.map((row) => row.ninjaDevice.id));
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">No Owner Signal</h1>
        <p className="text-[var(--muted)]">Devices without a NinjaOne owner signal are excluded from <Link href="/admin/owner-reconciliation" className="underline">Ownership Review</Link> and its counts.</p>
        <p className="text-sm text-[var(--muted)]">Includes devices already in Reftab and devices missing from Reftab. Review login evidence in NinjaOne and sync inventory after correcting it.</p>
      </div>
      <button className="btn-secondary" disabled={busy} onClick={() => void load(true)}>{busy ? "Refreshing..." : "Refresh status"}</button>
    </div>
    {error && <p role="alert" className="rounded border border-red-200 p-4 text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white">
      <div className="space-y-3 p-4">
        <p>{rows.length} shown · {data?.reportItems.length ?? 0} total · {data?.missingReftabRows.length ?? 0} missing from Reftab</p>
        <p className="text-sm text-[var(--muted)]">Calculated from synced inventory{data ? ` at ${new Date(data.cache.generatedAt).toLocaleString()}` : ""}. Refresh recalculates from that inventory.</p>
        <input className="w-full rounded border border-[var(--border)] p-2" aria-label="Search devices without an owner signal" placeholder="Search asset, serial, device, or NinjaOne ID" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="overflow-x-auto"><table className="w-full">
        <thead><tr>{["Asset", "Device / title", "Serial", "NinjaOne ID", "Reftab"].map((label) => <th className="table-header" key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.ninjaDeviceId ?? row.assetTag} className="border-t border-[var(--border)]">
          <td className="table-cell">{row.assetTag}</td><td className="table-cell">{row.title ?? "—"}</td>
          <td className="table-cell">{row.serial ?? "—"}</td><td className="table-cell">{row.ninjaDeviceId}</td>
          <td className="table-cell">{missingIds.has(row.ninjaDeviceId ?? "") ? "Missing from Reftab" : "In Reftab"}</td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p className="p-6 text-center text-[var(--muted)]">{busy ? "Loading devices..." : "No devices found."}</p>}
    </section>
  </div>;
}
