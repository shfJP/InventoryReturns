"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import { formatContactTimestamp } from "@/lib/date-time";
import type { OwnerLoginEvidence } from "@/lib/ninja-login-evidence";
import { OwnerEvidence } from "./owner-evidence";
import { ReconciliationAuditTable } from "./reconciliation-audit-table";
import { decommissionEligibility } from "@/lib/decommission-policy";
import { HardwareDecommissionPanel, type DecommissionCandidate } from "./hardware-decommission-panel";
import { HOUSE_NINJA_LOGIN, HOUSE_REFTAB_EMAIL, missingReftabRecipient } from "@/lib/missing-reftab-policy";
import { HouseDeviceImport } from "./house-device-import";
import { postReconciliationAction as postJsonWithTimeout, readReconciliationResponse as readResponseJson } from "@/lib/reconciliation-request";
import { runReconciliationBatch } from "@/lib/reconciliation-batch";
import { BackgroundActions } from "./background-actions";

type UserSummary = {
  employeeId: string;
  displayName: string;
  email: string;
  upn: string | null;
  isActive: boolean;
};

type OwnerReconciliationRow = {
  id: string;
  assetTag: string;
  aid: string | null;
  serial: string | null;
  model: string | null;
  title: string | null;
  category: string | null;
  reftabOwner: UserSummary | null;
  reftabOwnerEmployeeId: string;
  ninjaOwner: UserSummary;
  ninjaOwnerRaw: string;
  ninjaDevice: {
    id: string;
    displayName: string | null;
    systemName: string | null;
    dnsName: string | null;
    netbiosName: string | null;
    offline: boolean | null;
    lastContact: string | null;
    lastUpdate: string | null;
  };
  matchReason: string;
  confidence: number;
  ownerEvidence: OwnerLoginEvidence;
};

type MissingReftabAssetRow = {
  id: string;
  assetTag: string;
  serial: string | null;
  model: string | null;
  title: string | null;
  ninjaOwner: UserSummary | null;
  ninjaOwnerRaw: string | null;
  ownerStatus: "active" | "missing" | "unresolved" | "inactive";
  ninjaDevice: OwnerReconciliationRow["ninjaDevice"];
  identityReason: string;
};

type CategoryOption = {
  categoryId: string;
  name: string;
};

type ApiResponse = {
  rows: OwnerReconciliationRow[];
  missingReftabRows: MissingReftabAssetRow[];
  count: number;
  summary: {
    equipmentCount: number;
    ninjaDeviceCount: number;
    matchedDeviceCount: number;
    missingReftabCount: number;
    missingNinjaOwnerCount: number;
    unresolvedNinjaOwnerCount: number;
    inactiveNinjaOwnerCount: number;
    alreadyMatchedOwnerCount: number;
    mismatchCount: number;
  };
  cache?: {
    generatedAt: string;
    expiresAt: string;
    hit: boolean;
  };
  deferHours?: number;
};

const MISMATCH_PAGE_SIZE = 25;

function ownerLabel(owner: UserSummary | null, fallbackEmployeeId: string) {
  if (!owner) return fallbackEmployeeId;
  return `${owner.displayName} (${owner.employeeId})`;
}

function deviceLabel(row: { ninjaDevice: OwnerReconciliationRow["ninjaDevice"] }) {
  return row.ninjaDevice.displayName ?? row.ninjaDevice.systemName ?? row.ninjaDevice.dnsName ?? row.ninjaDevice.netbiosName ?? row.ninjaDevice.id;
}

function responseErrorMessage(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error.trim() ? data.error : fallback;
}

async function fetchReftabCategories(): Promise<CategoryOption[]> {
  const res = await fetch("/api/admin/owner-reconciliation?categories=1");
  const data = await readResponseJson(res);
  if (!res.ok) throw new Error(responseErrorMessage(data, "Failed to load Reftab categories"));
  return Array.isArray(data.categories) ? data.categories as CategoryOption[] : [];
}

function ownerStatusLabel(status: MissingReftabAssetRow["ownerStatus"]) {
  return {
    active: "Active directory owner",
    missing: "No owner signal",
    unresolved: "Owner not in directory",
    inactive: "Inactive owner",
  }[status];
}

export default function OwnerReconciliationPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OwnerReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const actionLock = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<{ assetTag: string; detail: string; failed?: boolean }[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<ApiResponse["summary"] | null>(null);
  const [missingReftabRows, setMissingReftabRows] = useState<MissingReftabAssetRow[]>([]);
  const [categoryModalRow, setCategoryModalRow] = useState<MissingReftabAssetRow | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [mismatchPage, setMismatchPage] = useState(1);
  const [cache, setCache] = useState<ApiResponse["cache"] | null>(null);
  const [deferHours, setDeferHours] = useState(24);
  const [auditRefresh, setAuditRefresh] = useState(0);
  const [houseImportBusy, setHouseImportBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [decommissionCandidate, setDecommissionCandidate] = useState<DecommissionCandidate | null>(null);
  const dismissDecommission = useCallback(() => setDecommissionCandidate(null), []);
  const refreshAudit = useCallback(() => setAuditRefresh((value) => value + 1), []);
  const missingAssetImported = useCallback((deviceId: string) => {
    setMissingReftabRows((previous) => previous.filter((row) => row.ninjaDevice.id !== deviceId));
    setSelectedMissing((previous) => {
      const next = new Set(previous);
      next.delete(deviceId);
      return next;
    });
    setSummary((previous) => previous ? {
      ...previous,
      equipmentCount: previous.equipmentCount + 1,
      matchedDeviceCount: previous.matchedDeviceCount + 1,
      alreadyMatchedOwnerCount: previous.alreadyMatchedOwnerCount + 1,
      missingReftabCount: Math.max(0, previous.missingReftabCount - 1),
    } : previous);
  }, []);
  const reserveDecommissions = useCallback((deviceIds: string[]) => {
    setMissingReftabRows((previous) => previous.filter((row) => !deviceIds.includes(row.ninjaDevice.id)));
  }, []);

  async function exportReport() {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/owner-reconciliation/export", { cache: "no-store" });
      if (!response.ok) {
        const data = await readResponseJson(response);
        throw new Error(responseErrorMessage(data, "Failed to export reconciliation report"));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "reconciliation-report.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to export reconciliation report");
    } finally {
      setExporting(false);
    }
  }

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/owner-reconciliation${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await readResponseJson(res);
      if (!res.ok) throw new Error(responseErrorMessage(data, "Failed to load owner reconciliation"));
      const response = data as ApiResponse;
      setSelected(new Set());
      setSelectedMissing(new Set());
      setRows(response.rows);
      setMissingReftabRows(response.missingReftabRows);
      setSummary(response.summary);
      setCache(response.cache ?? null);
      setDeferHours(response.deferHours ?? 24);
      if (refresh) setMessage("Reconciliation data recalculated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load owner reconciliation");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    void load();
  }, [load, router]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      [
        row.assetTag,
        row.serial,
        row.model,
        row.title,
        row.reftabOwner?.displayName,
        row.reftabOwner?.email,
        row.reftabOwnerEmployeeId,
        row.ninjaOwner.displayName,
        row.ninjaOwner.email,
        row.ninjaOwner.employeeId,
        row.ninjaOwnerRaw,
        deviceLabel(row),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [query, rows]);

  const mismatchPageCount = Math.max(1, Math.ceil(filteredRows.length / MISMATCH_PAGE_SIZE));
  const pagedRows = useMemo(() => {
    const start = (mismatchPage - 1) * MISMATCH_PAGE_SIZE;
    return filteredRows.slice(start, start + MISMATCH_PAGE_SIZE);
  }, [filteredRows, mismatchPage]);

  useEffect(() => {
    setMismatchPage(1);
  }, [query]);

  useEffect(() => {
    setMismatchPage((page) => Math.min(page, mismatchPageCount));
  }, [mismatchPageCount]);

  const filteredMissingRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return missingReftabRows;
    return missingReftabRows.filter((row) =>
      [
        row.assetTag,
        row.serial,
        row.model,
        row.title,
        row.ninjaOwner?.displayName,
        row.ninjaOwner?.email,
        row.ninjaOwner?.employeeId,
        row.ninjaOwnerRaw,
        deviceLabel(row),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [query, missingReftabRows]);

  const busy = houseImportBusy || approvingId !== null;
  const blocked = busy || categoryModalRow !== null || decommissionCandidate !== null;
  function acquireAction() {
    if (actionLock.current) return false;
    actionLock.current = true;
    return true;
  }
  function releaseAction() { actionLock.current = false; }
  function reportResult(assetTag: string, detail: string, failed = false) {
    setResults((previous) => [...previous, { assetTag, detail, failed }]);
    setMessage(failed ? null : `${assetTag}: ${detail}`);
  }
  function toggleSelection(id: string, missing = false) {
    const update = missing ? setSelectedMissing : setSelected;
    update((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  async function performOwnerActions(targets: OwnerReconciliationRow[], decision?: "NO" | "UNSURE" | "DEFER") {
    if (!targets.length || actionLock.current || blocked) return;
    let reason: string | null = null;
    if (decision) {
      reason = window.prompt(`Reason for ${decision === "DEFER" ? "deferring" : "sending to the correction queue"} ${targets.length} selected item(s):`);
      if (reason === null) return;
    } else if (!window.confirm(`Reconcile ${targets.length} item(s) in Reftab? Each asset will be checked in from its current owner and checked out to its listed recipient.\n\n${targets.map((row) => `${row.assetTag}: ${row.reftabOwner?.email ?? row.reftabOwnerEmployeeId} -> ${missingReftabRecipient(row)?.email ?? row.ninjaOwner.email}`).join("\n")}`)) return;
    if (!acquireAction()) return;
    setApprovingId(targets[0].id);
    setError(null);
    setMessage(null);
    let completed = 0;
    try {
      const outcome = await runReconciliationBatch(targets, async (row) => {
        setApprovingId(row.id);
        setProgress(`Processing ${completed + 1} of ${targets.length}: ${row.assetTag}. Keep this page open.`);
        const { res, data } = await postJsonWithTimeout({
          action: decision ? "record-decision" : "reassign-owner",
          assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id,
          ...(decision ? { decision, reason } : {}),
        });
        if (!res.ok) throw new Error(responseErrorMessage(data, "Reconciliation action failed"));
      }, (row) => {
        completed++;
        setRows((previous) => previous.filter((item) => item.id !== row.id));
        setSelected((previous) => { const next = new Set(previous); next.delete(row.id); return next; });
        setSummary((previous) => previous ? {
          ...previous, mismatchCount: Math.max(0, previous.mismatchCount - 1),
          alreadyMatchedOwnerCount: previous.alreadyMatchedOwnerCount + (decision ? 0 : 1),
        } : previous);
        reportResult(row.assetTag, decision === "DEFER" ? "Review deferred." : decision ? "Sent to the inventory correction queue." : `Reftab owner updated to ${missingReftabRecipient(row)?.email ?? row.ninjaOwner.email}.`);
      }, (row, cause) => {
        const detail = cause instanceof Error ? cause.message : "Action failed";
        reportResult(row.assetTag, detail, true);
        setError(`Stopped at ${row.assetTag}: ${detail} Check the audit history and Reftab before retrying. Remaining items were not processed.`);
      });
      setMessage(`${outcome.completed} of ${targets.length} item(s) completed.${outcome.stopped ? " Batch stopped; review the failed item before retrying." : ""}`);
    } finally {
      setProgress(null);
      releaseAction();
      setApprovingId(null);
      refreshAudit();
    }
  }
  async function approve(row: OwnerReconciliationRow) { await performOwnerActions([row]); }
  async function recordDecision(row: OwnerReconciliationRow, decision: "NO" | "UNSURE" | "DEFER") {
    await performOwnerActions([row], decision);
  }

  async function submitMissing(row: MissingReftabAssetRow, categoryId?: string) {
    const recipient = missingReftabRecipient(row);
    if (!recipient || houseImportBusy || !acquireAction()) return;

    setApprovingId(row.id);
    setProgress(`Adding ${row.assetTag} to Reftab. Keep this page open.`);
    setError(null);
    setCategoryError(null);
    setMessage(null);
    try {
      const { res, data } = await postJsonWithTimeout({
        action: "add-missing-asset",
        assetTag: row.assetTag,
        ninjaDeviceId: row.ninjaDevice.id,
        categoryId,
      });
      if (!res.ok) throw new Error(responseErrorMessage(data, "Failed to add Reftab asset"));
      missingAssetImported(row.ninjaDevice.id);
      setMessage(`${row.assetTag} added to Reftab and loaned to ${recipient.email}.`);
      reportResult(row.assetTag, `Created in Reftab and loaned to ${recipient.email}.`);
      setCategoryModalRow(null);
      setSelectedCategoryId("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to add Reftab asset";
      if (!categoryId && message.includes("Could not determine a Reftab category id")) {
        setError(null);
        setCategoryModalRow(row);
        setCategories([]);
        setSelectedCategoryId("");
        setCategoryLoading(true);
        try {
          const fetchedCategories = await fetchReftabCategories();
          setCategories(fetchedCategories);
          setSelectedCategoryId(fetchedCategories[0]?.categoryId ?? "");
        } catch (categoryError) {
          setCategoryError(categoryError instanceof Error ? categoryError.message : "Failed to load Reftab categories");
        } finally {
          setCategoryLoading(false);
        }
      } else {
        reportResult(row.assetTag, message, true);
        if (categoryId) setCategoryError(message);
        else setError(message);
      }
    } finally {
      releaseAction();
      setProgress(null);
      setApprovingId(null);
      setAuditRefresh((value) => value + 1);
    }
  }

  async function addMissing(row: MissingReftabAssetRow) {
    if (actionLock.current || blocked) return;
    const recipient = missingReftabRecipient(row);
    if (!recipient) return;
    const confirmed = window.confirm(`Add ${row.assetTag} to Reftab and loan it to ${recipient.email}?`);
    if (!confirmed) return;
    await submitMissing(row);
  }

  async function submitCategoryModal() {
    if (!categoryModalRow || !selectedCategoryId) return;
    await submitMissing(categoryModalRow, selectedCategoryId);
  }

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">&larr; Dashboard</Link>
        <button type="button" onClick={() => void exportReport()} disabled={exporting || houseImportBusy || approvingId !== null}
          title="Recalculate totals from latest synced data and export all items, regardless of search or page"
          className="btn-secondary whitespace-nowrap disabled:opacity-50">
          {exporting ? "Calculating export..." : "Export Excel report"}
        </button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Active Employee Owner Reconciliation</h1>
          <p className="text-[var(--muted)]">{rows.length} owner mismatch{rows.length === 1 ? "" : "es"}, {missingReftabRows.length} missing from Reftab</p>
          {cache && <p className="mt-1 text-xs text-[var(--muted)]">Calculated {new Date(cache.generatedAt).toLocaleString()} · {cache.hit ? "cached result" : "fresh result"} · deferred reviews return after {deferHours} hour(s)</p>}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="input-search"
          />
          <button type="button" onClick={() => void load(true)} disabled={blocked} className="btn-secondary whitespace-nowrap disabled:opacity-50">
            Recalculate
          </button>
        </div>
      </div>

      <BackgroundActions />
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}
      {(progress || results.length > 0) && (
        <div className="sticky top-2 z-20 rounded-lg border border-[var(--border)] bg-white p-4 shadow-lg">
          <p role="status" aria-live="polite" className="font-medium">{progress ?? message ?? "Recent action results"}</p>
          {results.length > 0 && <details open={!busy} className="mt-2 text-sm">
            <summary className="cursor-pointer">Action results ({results.length})</summary>
            <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {results.map((result, index) => <li key={index} className={result.failed ? "text-red-700" : "text-emerald-800"}>
                <strong>{result.assetTag}</strong> · {result.failed ? "Needs review: " : "Completed: "}{result.detail}
              </li>)}
            </ul>
          </details>}
        </div>
      )}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryPill label="Reftab items" value={summary.equipmentCount} />
          <SummaryPill label="Ninja devices" value={summary.ninjaDeviceCount} />
          <SummaryPill label="Device matches" value={summary.matchedDeviceCount} />
          <SummaryPill label="Missing Reftab" value={missingReftabRows.length} />
          <SummaryPill label="No owner signal" value={summary.missingNinjaOwnerCount} />
          <SummaryPill label="Owner not in directory" value={summary.unresolvedNinjaOwnerCount} />
          <SummaryPill label="Inactive owner" value={summary.inactiveNinjaOwnerCount} />
          <SummaryPill label="Already aligned" value={summary.alreadyMatchedOwnerCount} />
          <SummaryPill label="Mismatches" value={rows.length} />
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">NinjaOne owner mismatches</h2>
            <span className="text-sm text-[var(--muted)]">
              {filteredRows.length === 0
                ? "0 shown"
                : `${((mismatchPage - 1) * MISMATCH_PAGE_SIZE) + 1}-${Math.min(mismatchPage * MISMATCH_PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`}
            </span>
          </div>
        </div>
        <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          Owner support uses observed logins over the last 30 days. Device match measures asset identity. Review both before changing ownership.
        </p>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3 text-sm">
          <span>{rows.filter((row) => selected.has(row.id)).length} selected across all pages</span>
          <button type="button" className="btn-secondary" disabled={blocked} onClick={() => setSelected(new Set(filteredRows.map((row) => row.id)))}>Select all filtered ({filteredRows.length})</button>
          <button type="button" className="btn-secondary" disabled={blocked || !selected.size} onClick={() => setSelected(new Set())}>Clear selection</button>
          <button type="button" className="btn-secondary" disabled={blocked || !selected.size} onClick={() => void performOwnerActions(rows.filter((row) => selected.has(row.id)))}>Reconcile selected</button>
          {(["NO", "UNSURE", "DEFER"] as const).map((decision) => <button key={decision} type="button" className="btn-secondary" disabled={blocked || !selected.size}
            onClick={() => void performOwnerActions(rows.filter((row) => selected.has(row.id)), decision)}>
            {decision === "NO" ? "No" : decision === "UNSURE" ? "Unsure" : "Defer"} selected
          </button>)}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px]">
            <thead>
              <tr>
                <th className="table-header"><input type="checkbox" aria-label="Select owner mismatches on this page" disabled={blocked || !pagedRows.length}
                  checked={pagedRows.length > 0 && pagedRows.every((row) => selected.has(row.id))}
                  onChange={(event) => setSelected((previous) => { const next = new Set(previous); pagedRows.forEach((row) => { if (event.target.checked) next.add(row.id); else next.delete(row.id); }); return next; })} /></th>
                <th className="table-header">Asset</th>
                <th className="table-header">Serial</th>
                <th className="table-header">Reftab owner</th>
                <th className="table-header">NinjaOne owner</th>
                <th className="table-header">NinjaOne device</th>
                <th className="table-header">Device match</th>
                <th className="table-header">Owner support</th>
                <th className="table-header">Last contact</th>
                <th className="table-header">Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                  <td className="table-cell"><input type="checkbox" aria-label={`Select ${row.assetTag}`} checked={selected.has(row.id)} disabled={blocked} onChange={() => toggleSelection(row.id)} /></td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{row.assetTag}</div>
                    <div className="text-xs text-[var(--muted)]">{row.title ?? row.model ?? row.category ?? "-"}</div>
                  </td>
                  <td className="table-cell text-[var(--text-secondary)]">{row.serial ?? "-"}</td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{ownerLabel(row.reftabOwner, row.reftabOwnerEmployeeId)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.reftabOwner?.email ?? "No active directory match"}</div>
                  </td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{ownerLabel(row.ninjaOwner, row.ninjaOwner.employeeId)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.ninjaOwner.email}</div>
                  </td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{deviceLabel(row)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.ninjaOwnerRaw}</div>
                  </td>
                  <td className="table-cell">
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      {row.matchReason} · {row.confidence}%
                    </span>
                  </td>
                  <td className="table-cell align-top"><OwnerEvidence evidence={row.ownerEvidence} /></td>
                  <td className="table-cell text-[var(--text-secondary)]">{formatContactTimestamp(row.ninjaDevice.lastContact ?? row.ninjaDevice.lastUpdate, "-")}</td>
                  <td className="table-cell">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => approve(row)}
                        disabled={blocked}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        title="Yes, assign this asset to the suggested person"
                      >
                        {approvingId === row.id ? "Processing..." : "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => recordDecision(row, "NO")}
                        disabled={blocked}
                        className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        title="No, create an IT correction request"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={() => recordDecision(row, "UNSURE")}
                        disabled={blocked}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--text)] disabled:opacity-50"
                      >
                        Unsure
                      </button>
                      <button
                        type="button"
                        onClick={() => recordDecision(row, "DEFER")}
                        disabled={blocked}
                        className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--muted)] disabled:opacity-50"
                        title={`Hide this review for ${deferHours} hour(s)`}
                      >
                        Defer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length > MISMATCH_PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
            <span className="text-sm text-[var(--muted)]">Page {mismatchPage} of {mismatchPageCount}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMismatchPage((page) => Math.max(1, page - 1))}
                disabled={mismatchPage === 1}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--table-header-bg)] disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setMismatchPage((page) => Math.min(mismatchPageCount, page + 1))}
                disabled={mismatchPage === mismatchPageCount}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--table-header-bg)] disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
        {filteredRows.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">No owner mismatches found.</p>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">In NinjaOne, missing from Reftab</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[var(--muted)]">{filteredMissingRows.length} shown</span>
              <HouseDeviceImport selectedMode rows={missingReftabRows.filter((row) => selectedMissing.has(row.id))}
                disabled={blocked} onImported={missingAssetImported} onAttempt={refreshAudit} onBusyChange={setHouseImportBusy}
                acquire={acquireAction} release={releaseAction} onResult={reportResult} />
              <HouseDeviceImport rows={missingReftabRows} disabled={blocked}
                onImported={missingAssetImported} onAttempt={refreshAudit} onBusyChange={setHouseImportBusy}
                acquire={acquireAction} release={releaseAction} onResult={reportResult} />
            </div>
          </div>
        </div>
        <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          Devices logged in as {HOUSE_NINJA_LOGIN} will be loaned to {HOUSE_REFTAB_EMAIL} when added to Reftab.
        </p>
        <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
          Devices confirmed offline for over one year can be created as Decommissioned in Reftab, then reviewed before optional NinjaOne removal.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr>
                <th className="table-header"><input type="checkbox" aria-label="Select eligible filtered missing devices" disabled={blocked}
                  checked={filteredMissingRows.some((row) => missingReftabRecipient(row)) && filteredMissingRows.filter((row) => missingReftabRecipient(row)).every((row) => selectedMissing.has(row.id))}
                  onChange={(event) => setSelectedMissing(new Set(event.target.checked ? filteredMissingRows.filter((row) => missingReftabRecipient(row)).map((row) => row.id) : []))} /></th>
                <th className="table-header">Asset</th>
                <th className="table-header">Serial</th>
                <th className="table-header">NinjaOne owner</th>
                <th className="table-header">NinjaOne device</th>
                <th className="table-header">Identity</th>
                <th className="table-header">Last contact</th>
                <th className="table-header">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredMissingRows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                  <td className="table-cell"><input type="checkbox" aria-label={`Select missing asset ${row.assetTag}`} checked={selectedMissing.has(row.id)} disabled={blocked || !missingReftabRecipient(row)} onChange={() => toggleSelection(row.id, true)} /></td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{row.assetTag}</div>
                    <div className="text-xs text-[var(--muted)]">{row.title ?? row.model ?? "-"}</div>
                  </td>
                  <td className="table-cell text-[var(--text-secondary)]">{row.serial ?? "-"}</td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{row.ninjaOwner ? ownerLabel(row.ninjaOwner, row.ninjaOwner.employeeId) : ownerStatusLabel(row.ownerStatus)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.ninjaOwner?.email ?? row.ninjaOwnerRaw ?? "-"}</div>
                    {missingReftabRecipient(row)?.email === HOUSE_REFTAB_EMAIL && (
                      <div className="mt-1 text-xs font-medium text-sky-700">Loan to {HOUSE_REFTAB_EMAIL}</div>
                    )}
                  </td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{deviceLabel(row)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.ninjaOwnerRaw}</div>
                  </td>
                  <td className="table-cell">
                    <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                      {row.identityReason}
                    </span>
                  </td>
                  <td className="table-cell text-[var(--text-secondary)]">
                    {formatContactTimestamp(row.ninjaDevice.lastContact, "-")}
                    {decommissionEligibility(row.ninjaDevice).eligible && <div className="text-xs font-medium text-amber-800">Offline over 1 year</div>}
                  </td>
                  <td className="table-cell">
                    <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addMissing(row)}
                      disabled={blocked || !missingReftabRecipient(row)}
                      className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      title={missingReftabRecipient(row) ? `Create and loan to ${missingReftabRecipient(row)!.email}` : ownerStatusLabel(row.ownerStatus)}
                    >
                      {approvingId === row.id ? "Adding" : "Add to Reftab"}
                    </button>
                    {decommissionEligibility(row.ninjaDevice).eligible && <button type="button"
                      disabled={blocked} onClick={() => setDecommissionCandidate(row)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                      Decommission
                    </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredMissingRows.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">No NinjaOne-only equipment found.</p>
        )}
      </section>

      <HardwareDecommissionPanel candidate={decommissionCandidate} onDismiss={dismissDecommission}
        onReserved={reserveDecommissions} onAttempt={refreshAudit} />
      <ReconciliationAuditTable refreshKey={auditRefresh} />

      {categoryModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="reftab-category-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <h2 id="reftab-category-title" className="text-lg font-semibold text-[var(--text)]">Select Reftab Category</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {categoryModalRow.assetTag} needs a category before it can be created in Reftab.
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div>
                <label htmlFor="reftab-category" className="mb-2 block text-sm font-medium text-[var(--text)]">Category</label>
                <select
                  id="reftab-category"
                  value={selectedCategoryId}
                  onChange={(event) => setSelectedCategoryId(event.target.value)}
                  disabled={categoryLoading || categories.length === 0 || approvingId === categoryModalRow.id}
                  className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)]"
                >
                  {categories.map((category) => (
                    <option key={category.categoryId} value={category.categoryId}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              {categoryLoading && <p className="text-sm text-[var(--muted)]">Loading Reftab categories...</p>}
              {!categoryLoading && categories.length === 0 && (
                <p className="text-sm text-red-700">No Reftab categories were returned.</p>
              )}
              {categoryError && (
                <div role="alert" className="whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {categoryError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border)] px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setCategoryModalRow(null);
                  setSelectedCategoryId("");
                  setCategoryError(null);
                }}
                disabled={approvingId === categoryModalRow.id}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--table-header-bg)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCategoryModal}
                disabled={categoryLoading || !selectedCategoryId || approvingId === categoryModalRow.id}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {approvingId === categoryModalRow.id ? "Adding" : "Create Asset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold text-[var(--text)]">{value.toLocaleString()}</div>
    </div>
  );
}
