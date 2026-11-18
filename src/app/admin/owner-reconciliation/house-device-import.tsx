"use client";

import { useState } from "react";
import type { MissingReftabAssetRow } from "@/lib/owner-reconciliation";
import { HOUSE_NINJA_LOGIN, HOUSE_REFTAB_EMAIL, isHouseNinjaLogin } from "@/lib/missing-reftab-policy";

type Category = { categoryId: string; name: string };

export function HouseDeviceImport({ rows, disabled, onImported, onAttempt, onBusyChange }: {
  rows: MissingReftabAssetRow[];
  disabled: boolean;
  onImported: (deviceId: string) => void;
  onAttempt: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const houseRows = rows.filter((row) => isHouseNinjaLogin(row.ninjaOwnerRaw));
  const [targets, setTargets] = useState<MissingReftabAssetRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setTargets(houseRows);
    setCategoryId("");
    setCategories([]);
    setAdded(0);
    setAttempted(false);
    setError(null);
    setCategoryLoading(true);
    try {
      const response = await fetch("/api/admin/owner-reconciliation?categories=1");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load Reftab categories.");
      setCategories(data.categories ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Reftab categories.");
    } finally {
      setCategoryLoading(false);
    }
  }

  async function start() {
    if (!targets?.length || running || attempted) return;
    setRunning(true);
    setAttempted(true);
    setError(null);
    onBusyChange(true);
    let current: MissingReftabAssetRow | null = null;
    try {
      for (const row of targets) {
        current = row;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 60_000);
        try {
          const response = await fetch("/api/admin/owner-reconciliation", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "add-missing-asset", assetTag: row.assetTag,
              ninjaDeviceId: row.ninjaDevice.id, categoryId: categoryId || undefined,
            }),
            signal: controller.signal,
          });
          const data = await response.json().catch(() => {
            throw new Error("The server response could not be read. Check Reftab and the audit history before retrying.");
          });
          if (!response.ok) throw new Error(data.error ?? "Could not create and loan the asset.");
          setAdded((value) => value + 1);
          onImported(row.ninjaDevice.id);
        } finally {
          window.clearTimeout(timeout);
        }
      }
    } catch (cause) {
      const detail = cause instanceof Error && cause.name === "AbortError"
        ? "The request timed out. Check Reftab and the audit history before retrying."
        : cause instanceof Error ? cause.message : "Import failed.";
      setError(`Stopped at ${current?.assetTag ?? "device"}: ${detail}`);
    } finally {
      setRunning(false);
      onBusyChange(false);
      onAttempt();
    }
  }

  return (
    <>
      <button type="button" onClick={() => void open()}
        disabled={disabled || running || houseRows.length === 0}
        className="btn-secondary whitespace-nowrap disabled:opacity-50">
        Add all house devices ({houseRows.length})
      </button>
      {targets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="house-import-title"
            className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id="house-import-title" className="text-lg font-semibold text-[var(--text)]">Add house devices to Reftab</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Create all {targets.length} missing devices logged in as {HOUSE_NINJA_LOGIN} and loan them to {HOUSE_REFTAB_EMAIL}.
                This includes matches outside the current search.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="max-h-48 overflow-y-auto rounded border border-[var(--border)] p-3 text-sm">
                {targets.map((row) => (
                  <div key={row.id}>{row.assetTag} · {row.title ?? row.ninjaDevice.systemName ?? row.ninjaDevice.id}</div>
                ))}
              </div>
              <div>
                <label htmlFor="house-import-category" className="mb-2 block text-sm font-medium">Reftab category</label>
                <select id="house-import-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}
                  disabled={categoryLoading || attempted}
                  className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm">
                  <option value="">Determine automatically for each device</option>
                  {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {categoryLoading ? "Loading categories..." : "Selecting a category applies it to every device in this batch."}
                </p>
              </div>
              {attempted && <p role="status" className="text-sm text-[var(--text)]">
                {added} of {targets.length} devices created and loaned to {HOUSE_REFTAB_EMAIL}.{running ? " Importing..." : ""}
              </p>}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
              <button type="button" disabled={running} onClick={() => setTargets(null)} className="btn-secondary disabled:opacity-50">
                {attempted ? "Close" : "Cancel"}
              </button>
              {!attempted && <button type="button" onClick={() => void start()} disabled={categoryLoading}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50">
                Create and loan {targets.length} devices
              </button>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
