"use client";

import { useRef, useState } from "react";
import type { MissingReftabAssetRow } from "@/lib/owner-reconciliation";
import { decommissionEligibility } from "@/lib/decommission-policy";
import { runReconciliationBatch } from "@/lib/reconciliation-batch";
import { requestDecommission } from "./hardware-decommission-panel";

type Category = { categoryId: string; name: string };

export function BatchDecommission({ rows, disabled, acquire, release, onBusyChange, onReserved, onAttempt, onResult }: {
  rows: MissingReftabAssetRow[];
  disabled: boolean;
  acquire: () => boolean;
  release: () => void;
  onBusyChange: (busy: boolean) => void;
  onReserved: (ids: string[]) => void;
  onAttempt: () => void;
  onResult: (assetTag: string, detail: string, failed?: boolean) => void;
}) {
  const eligible = rows.filter((row) => decommissionEligibility(row.ninjaDevice).eligible);
  const [targets, setTargets] = useState<MissingReftabAssetRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function open() {
    if (disabled || !eligible.length || !acquire()) return;
    onBusyChange(true);
    setTargets(eligible);
    setCategories([]);
    setCategory("");
    setCompleted(0);
    setCurrent("");
    setError(null);
    started.current = false;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/owner-reconciliation?categories=1");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load Reftab categories.");
      setCategories(data.categories ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Reftab categories.");
    } finally { setLoading(false); }
  }

  async function start() {
    if (!targets?.length || !category || started.current) return;
    started.current = true;
    setRunning(true);
    setError(null);
    try {
      await runReconciliationBatch(targets, async (row) => {
        setCurrent(row.assetTag);
        try {
          const data = await requestDecommission({
            action: "create", ninjaDeviceId: row.ninjaDevice.id, assetTag: row.assetTag, categoryId: category,
          });
          if (data.workflow?.status !== "AWAITING_CONFIRMATION") {
            if (data.workflow && data.workflow.status !== "FAILED") onReserved([row.ninjaDevice.id]);
            throw new Error("This device has an existing or incomplete decommission. Review its saved status before continuing.");
          }
        } catch (cause) {
          // Recover reservations after timeouts without repeating an external write.
          try {
            const saved = await requestDecommission({ action: "status", ninjaDeviceId: row.ninjaDevice.id });
            if (saved.workflow && saved.workflow.status !== "FAILED") onReserved([row.ninjaDevice.id]);
          } catch { /* Preserve the original error and stop the batch. */ }
          throw cause;
        }
      }, (row) => {
        setCompleted((value) => value + 1);
        onReserved([row.ninjaDevice.id]);
        onResult(row.assetTag, "Created as Decommissioned in Reftab. Awaiting visual confirmation before optional NinjaOne removal.");
      }, (row, cause) => {
        const detail = cause instanceof Error ? cause.message : "Decommission failed.";
        setError(`Stopped at ${row.assetTag}: ${detail} Check Hardware decommissions and Reftab before retrying. Remaining devices were not processed.`);
        onResult(row.assetTag, detail, true);
      });
    } finally {
      setRunning(false);
      setCurrent("");
      onAttempt();
    }
  }

  function close() {
    if (running || loading) return;
    setTargets(null);
    release();
    onBusyChange(false);
  }

  return <>
    <button type="button" className="btn-secondary" disabled={disabled || !eligible.length} onClick={() => void open()}>
      Decommission selected ({eligible.length})
    </button>
    {targets && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="batch-decommission-title" className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <h2 id="batch-decommission-title" className="text-lg font-semibold">Decommission {targets.length} selected device(s)</h2>
        <p className="text-sm">Create unassigned assets in Reftab with Decommissioned status. Each device must be confirmed offline for over one year; eligibility is checked again in NinjaOne before creation.</p>
        <p className="text-sm">Your signed-in identity and inactivity reason are recorded for each device. Review each saved item under Hardware decommissions and visually confirm it in Reftab before optional NinjaOne removal.</p>
        <p className="text-sm">Only eligible selected devices are included. Choose a category for this batch.</p>
        <ul className="max-h-40 overflow-y-auto text-sm">{targets.map((row) => <li key={row.id}>{row.assetTag} · {row.title ?? row.ninjaDevice.systemName ?? row.ninjaDevice.id}</li>)}</ul>
        <label className="block text-sm">Reftab category
          <select className="mt-1 w-full rounded border border-[var(--border)] p-2" disabled={loading || started.current} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{loading ? "Loading categories..." : "Select a category"}</option>
            {categories.map((item) => <option key={item.categoryId} value={item.categoryId}>{item.name}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <p role="status" className="text-sm">{completed} of {targets.length} created{current ? ` · Processing ${current}. Keep this page open.` : ""}</p>
        {started.current && !running && <p className="text-sm">Review saved results under Hardware decommissions.</p>}
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" disabled={running || loading} onClick={close}>Close</button>
          <button className="btn-primary" disabled={loading || !category || started.current} onClick={() => void start()}>{running ? "Processing..." : "Create Decommissioned assets"}</button>
        </div>
      </div>
    </div>}
  </>;
}
