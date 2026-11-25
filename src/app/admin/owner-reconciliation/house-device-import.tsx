"use client";

import { useRef, useState } from "react";
import type { MissingReftabAssetRow } from "@/lib/owner-reconciliation";
import { HOUSE_NINJA_LOGIN, HOUSE_REFTAB_EMAIL, isHouseNinjaLogin, missingReftabRecipient } from "@/lib/missing-reftab-policy";
import { enqueueReconciliationAction } from "@/lib/reconciliation-request";
import { runReconciliationBatch } from "@/lib/reconciliation-batch";

type Category = { categoryId: string; name: string };

export function HouseDeviceImport({ rows, disabled, onImported, onAttempt, onBusyChange, selectedMode = false, acquire, release, onResult }: {
  selectedMode?: boolean;
  acquire: () => boolean;
  release: () => void;
  onResult: (assetTag: string, detail: string, failed?: boolean) => void;
  rows: MissingReftabAssetRow[];
  disabled: boolean;
  onImported: (deviceId: string) => void;
  onAttempt: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const eligibleRows = rows.filter((row) => selectedMode ? Boolean(missingReftabRecipient(row)) : isHouseNinjaLogin(row.ninjaOwnerRaw));
  const started = useRef(false);
  const dialogId = selectedMode ? "selected-import" : "house-import";
  const [targets, setTargets] = useState<MissingReftabAssetRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    if (disabled || !eligibleRows.length || !acquire()) return;
    onBusyChange(true);
    started.current = false;
    setTargets(eligibleRows);
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
    if (!targets?.length || started.current) return;
    started.current = true;
    setRunning(true);
    setAttempted(true);
    setError(null);
    try {
      await runReconciliationBatch(targets, async (row) => {
        const { res, data } = await enqueueReconciliationAction({
          action: "add-missing-asset", assetTag: row.assetTag,
          ninjaDeviceId: row.ninjaDevice.id, categoryId: categoryId || undefined,
        });
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not create and loan the asset.");
      }, (row) => {
        setAdded((value) => value + 1);
        onImported(row.ninjaDevice.id);
        onResult(row.assetTag, `Decision saved: create and assign to ${missingReftabRecipient(row)?.email}.`);
      }, (row, cause) => {
        const detail = cause instanceof Error ? cause.message : "Import failed.";
        setError(`Stopped at ${row.assetTag}: ${detail} Check audit history and Reftab before retrying. Remaining devices were not processed.`);
        onResult(row.assetTag, detail, true);
      });
    } finally {
      setRunning(false);
      onAttempt();
    }
  }

  function close() {
    if (running) return;
    setTargets(null);
    release();
    onBusyChange(false);
  }

  return (
    <>
      <button type="button" onClick={() => void open()}
        disabled={disabled || running || eligibleRows.length === 0}
        className="btn-secondary whitespace-nowrap disabled:opacity-50">
        {selectedMode ? "Add selected to Reftab" : "Add all house devices"} ({eligibleRows.length})
      </button>
      {targets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`}
            className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id={`${dialogId}-title`} className="text-lg font-semibold text-[var(--text)]">{selectedMode ? "Add selected devices to Reftab" : "Add house devices to Reftab"}</h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {selectedMode ? `Create ${targets.length} selected missing devices and loan each to its listed recipient.` : `Create all ${targets.length} missing devices logged in as ${HOUSE_NINJA_LOGIN} and loan them to ${HOUSE_REFTAB_EMAIL}. This includes matches outside the current search.`}
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="max-h-48 overflow-y-auto rounded border border-[var(--border)] p-3 text-sm">
                {targets.map((row) => (
                  <div key={row.id}>{row.assetTag} · {row.title ?? row.ninjaDevice.systemName ?? row.ninjaDevice.id} · {missingReftabRecipient(row)?.email}</div>
                ))}
              </div>
              <div>
                <label htmlFor={`${dialogId}-category`} className="mb-2 block text-sm font-medium">Reftab category</label>
                <select id={`${dialogId}-category`} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}
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
                {added} of {targets.length} decisions saved. Creating and assigning assets continues in the background.{running ? " Keep this page open while the remaining decisions are saved." : " Track results in Actions & Audit."}
              </p>}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
              <button type="button" disabled={running} onClick={close} className="btn-secondary disabled:opacity-50">
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
