"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HardwareDecommission } from "@prisma/client";
import { DECOMMISSION_REASON } from "@/lib/decommission-policy";
import { formatContactTimestamp } from "@/lib/date-time";

export type DecommissionCandidate = {
  assetTag: string;
  title: string | null;
  model: string | null;
  ninjaDevice: { id: string; lastContact: string | null };
};
type Workflow = Omit<HardwareDecommission, "createdAt" | "updatedAt" | "lastContact" | "visuallyConfirmedAt" | "ninjaDecommissionedAt"> & {
  createdAt: string; updatedAt: string; lastContact: string;
  visuallyConfirmedAt: string | null; ninjaDecommissionedAt: string | null;
};
type Category = { categoryId: string; name: string };
const labels: Record<string, string> = {
  CREATING: "Creation pending — check status", FAILED: "Creation failed",
  REVIEW_REQUIRED: "Check Reftab creation", AWAITING_CONFIRMATION: "Awaiting visual confirmation",
  KEPT: "Confirmed — kept in NinjaOne", REMOVING: "NinjaOne action pending",
  REMOVE_REVIEW_REQUIRED: "Check NinjaOne result", NINJA_DECOMMISSIONED: "Decommissioned in NinjaOne",
};
const confirmable = (record: Workflow) => ["AWAITING_CONFIRMATION", "KEPT"].includes(record.status);
const reftabUrl = (record: Workflow) => `https://www.reftab.com/assets/${encodeURIComponent(record.reftabAid ?? record.assetTag)}`;

export async function requestDecommission(body?: Record<string, unknown>, page = 1) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`/api/admin/hardware-decommission${body ? "" : `?page=${page}`}`, {
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: controller.signal, cache: "no-store",
    });
    const data = await response.json().catch(() => { throw new Error("The server response could not be read. Check the saved decommission status before retrying."); });
    if (!response.ok) throw new Error(data.error ?? "Decommission action failed");
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The request timed out. Check the saved status before retrying; the action may have completed.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function HardwareDecommissionPanel({ candidate, onDismiss, onReserved, onAttempt, refreshKey = 0, disabled = false }: {
  disabled?: boolean;
  refreshKey?: number;
  candidate: DecommissionCandidate | null;
  onDismiss: () => void;
  onReserved: (deviceIds: string[]) => void;
  onAttempt: () => void;
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [canRemove, setCanRemove] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState("");
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [review, setReview] = useState<Workflow | null>(null);
  const [verified, setVerified] = useState(false);
  const [acting, setBusy] = useState(false);
  const busy = acting || disabled;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const modalOpen = Boolean(candidate || review);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/hardware-decommission?page=${page}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load saved decommissions");
        setWorkflows(data.workflows);
        setTotal(data.total);
        setCanRemove(data.canRemoveFromNinjaOne);
        onReserved(data.workflows.filter((item: Workflow) => item.status !== "FAILED").map((item: Workflow) => item.ninjaDeviceId));
        if (page > Math.max(1, Math.ceil(data.total / 25))) setPage(Math.max(1, Math.ceil(data.total / 25)));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load saved decommissions");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, reload, onReserved, refreshKey]);

  useEffect(() => {
    if (!candidate) return;
    const controller = new AbortController();
    setReview(null);
    setVerified(false);
    setError(null);
    setMessage(null);
    setCategory("");
    setCategories([]);
    setCategoryLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/admin/owner-reconciliation?categories=1", { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load Reftab categories");
        setCategories(data.categories ?? []);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load Reftab categories");
      } finally {
        if (!controller.signal.aborted) setCategoryLoading(false);
      }
    })();
    return () => controller.abort();
  }, [candidate]);

  useEffect(() => {
    if (modalOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!modalOpen && dialog.current?.open) dialog.current?.close();
  }, [modalOpen]);

  const close = useCallback(() => {
    if (busy) return;
    setReview(null);
    setVerified(false);
    onDismiss();
  }, [busy, onDismiss]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await requestDecommission(body);
      const record = data.workflow as Workflow;
      setReview(record);
      setVerified(false);
      onDismiss();
      if (record.status !== "FAILED") onReserved([record.ninjaDeviceId]);
      if (record.status === "NINJA_DECOMMISSIONED") setMessage(`${record.assetTag} was decommissioned in NinjaOne.`);
      else if (record.status === "KEPT") setMessage(`${record.assetTag} was confirmed in Reftab and kept in NinjaOne.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decommission action failed");
      // Reload durable state after failures, including requests whose result is uncertain.
      if (review || candidate) {
        try {
          const data = await requestDecommission({ action: "status", ...(review ? { id: review.id } : { ninjaDeviceId: candidate!.ninjaDevice.id }) });
          if (data.workflow && data.workflow.status !== "FAILED") {
            setReview(data.workflow);
            setVerified(false);
            onReserved([data.workflow.ninjaDeviceId]);
            onDismiss();
          }
        } catch { /* Keep the original actionable error visible. */ }
      }
    } finally {
      setBusy(false);
      setReload((value) => value + 1);
      onAttempt();
    }
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Hardware decommissions</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">Saved Reftab creation and NinjaOne confirmation steps. Reviews remain available after you leave this page.</p>
          </div>
          <button type="button" className="btn-secondary" disabled={loading || busy} onClick={() => { setError(null); setReload((value) => value + 1); }}>Refresh</button>
        </div>
        {!modalOpen && error && <p role="alert" className="p-4 text-red-700">{error}</p>}
        {!modalOpen && message && <p role="status" className="p-4 text-emerald-800">{message}</p>}
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="w-full min-w-[900px]">
            <thead><tr>{["Asset / device", "Last online", "Started by", "Status", "Action"].map((label) => <th className="table-header" key={label}>{label}</th>)}</tr></thead>
            <tbody>{workflows.map((record) => <tr key={record.id} className="border-b border-[var(--border)] align-top">
              <td className="table-cell"><div className="font-medium">{record.assetTag}</div><div className="text-xs text-[var(--muted)]">{record.deviceName}</div></td>
              <td className="table-cell">{formatContactTimestamp(record.lastContact)}</td>
              <td className="table-cell"><div>{record.actorName} ({record.actorEmployeeId})</div><div className="text-xs text-[var(--muted)]">{formatContactTimestamp(record.createdAt)}</div></td>
              <td className="table-cell"><span className="font-medium">{labels[record.status] ?? record.status}</span>{record.error && <p className="mt-1 max-w-md break-words text-xs text-red-700">{record.error}</p>}</td>
              <td className="table-cell"><button type="button" className="btn-secondary whitespace-nowrap" disabled={busy} onClick={() => {
                setReview(record); setVerified(false); setError(null); setMessage(null);
              }}>{confirmable(record) ? "Review / confirm" : "View / check status"}</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {workflows.length === 0 && <p className="p-6 text-center text-[var(--muted)]">{loading ? "Loading decommissions..." : "No hardware decommissions recorded."}</p>}
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--muted)]">
          <span>{total} record(s) · Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={loading || busy || page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
            <button type="button" className="btn-secondary" disabled={loading || busy || page * 25 >= total} onClick={() => setPage((value) => value + 1)}>Next</button>
          </div>
        </div>
      </section>

      <dialog ref={dialog} aria-labelledby="decommission-title" onCancel={(event) => { event.preventDefault(); close(); }}
        className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg border border-[var(--border)] bg-white p-0 text-[var(--text)] shadow-xl backdrop:bg-black/40">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 id="decommission-title" className="text-lg font-semibold">{candidate ? `Decommission ${candidate.assetTag}` : `Review ${review?.assetTag ?? "decommission"}`}</h2>
        </div>
        <div className="space-y-4 px-5 py-4">
          {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
          {candidate && <>
            <p>{candidate.title ?? candidate.model ?? candidate.assetTag}</p>
            <p className="text-sm">Last online: {formatContactTimestamp(candidate.ninjaDevice.lastContact)}. {DECOMMISSION_REASON}.</p>
            <p className="text-sm">Create an unassigned asset in Reftab with the <strong>Decommissioned</strong> status. Asset Notes will record the current date and time, your signed-in identity, and the inactivity reason above.</p>
            <label className="block text-sm font-medium">Reftab category
              <select value={category} onChange={(event) => setCategory(event.target.value)} disabled={categoryLoading || busy} className="mt-2 w-full rounded border border-[var(--border)] p-2">
                <option value="">{categoryLoading ? "Loading categories..." : "Select a category"}</option>
                {categories.map((item) => <option key={item.categoryId} value={item.categoryId}>{item.name}</option>)}
              </select>
            </label>
            {!categoryLoading && categories.length === 0 && <p className="text-sm text-red-700">No Reftab categories available. Close and reopen to reload.</p>}
            <p className="text-sm text-[var(--muted)]">After creation, open Reftab and visually confirm the asset before choosing what to do in NinjaOne.</p>
          </>}
          {review && <>
            <p><strong>{review.deviceName}</strong> · {labels[review.status] ?? review.status}</p>
            {review.error && <p className="break-words text-sm text-red-700">{review.error}</p>}
            <p className="text-sm">Last online: {formatContactTimestamp(review.lastContact)}</p>
            <a href={reftabUrl(review)} target="_blank" rel="noopener noreferrer" className="inline-block font-medium text-[var(--accent)] underline">Open {review.assetTag} in Reftab ↗</a>
            <div className="text-sm"><p className="font-medium">Expected status: Decommissioned</p>
              <p className="mt-2 font-medium">Asset Notes</p><pre className="mt-1 whitespace-pre-wrap break-words rounded bg-[var(--table-header-bg)] p-3 font-sans text-xs">{review.assetNotes}</pre>
            </div>
            {confirmable(review) && <>
              <label className="flex items-start gap-2 rounded border border-[var(--border)] p-3 text-sm">
                <input type="checkbox" checked={verified} disabled={busy} onChange={(event) => setVerified(event.target.checked)} className="mt-1" />
                <span>I opened Reftab and visually confirmed this device, its Decommissioned status, and the Asset Notes shown above.</span>
              </label>
              <p className="text-sm text-[var(--muted)]">Decommission in NinjaOne removes the device from active management. NinjaOne may retain its record in the decommissioned view.</p>
              {!canRemove && <p className="text-sm text-amber-800">NinjaOne removal needs the management OAuth scope configured by an administrator. You can confirm and keep the device in NinjaOne now.</p>}
            </>}
            {!confirmable(review) && review.status !== "NINJA_DECOMMISSIONED" && <p className="text-sm text-[var(--muted)]">
              Use Check status to read back the result. Pending or uncertain actions require review before another write. Failed creations can be retried from the missing equipment list.
            </p>}
          </>}
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
          <button type="button" className="btn-secondary" disabled={busy} onClick={close}>{review && confirmable(review) ? "Review later" : "Close"}</button>
          {candidate && <button type="button" className="btn-primary" disabled={busy || categoryLoading || !category}
            onClick={() => void act({ action: "create", ninjaDeviceId: candidate.ninjaDevice.id, assetTag: candidate.assetTag, categoryId: category })}>
            {busy ? "Creating..." : "Create Decommissioned asset"}
          </button>}
          {review && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act({ action: "verify", id: review.id })}>Check status</button>}
          {review && confirmable(review) && <>
            {review.status !== "KEPT" && <button type="button" className="btn-secondary" disabled={busy || !verified}
              onClick={() => void act({ action: "confirm", id: review.id, choice: "keep", confirmedInReftab: true })}>Keep in NinjaOne</button>}
            <button type="button" className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy || !verified || !canRemove}
              onClick={() => void act({ action: "confirm", id: review.id, choice: "remove", confirmedInReftab: true })}>{busy ? "Processing..." : "Decommission in NinjaOne"}</button>
          </>}
        </div>
      </dialog>
    </>
  );
}
