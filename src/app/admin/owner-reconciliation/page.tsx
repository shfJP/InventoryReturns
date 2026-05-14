"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";

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
};

function ownerLabel(owner: UserSummary | null, fallbackEmployeeId: string) {
  if (!owner) return fallbackEmployeeId;
  return `${owner.displayName} (${owner.employeeId})`;
}

function deviceLabel(row: { ninjaDevice: OwnerReconciliationRow["ninjaDevice"] }) {
  return row.ninjaDevice.displayName ?? row.ninjaDevice.systemName ?? row.ninjaDevice.dnsName ?? row.ninjaDevice.netbiosName ?? row.ninjaDevice.id;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function postJsonWithTimeout(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch("/api/admin/owner-reconciliation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Reftab action timed out after 60 seconds. Check Reftab, then refresh this page.");
    }
    throw e;
  } finally {
    window.clearTimeout(timeout);
  }
}

function ownerStatusLabel(status: MissingReftabAssetRow["ownerStatus"]) {
  return {
    active: "Active Entra owner",
    missing: "No owner signal",
    unresolved: "Owner not in Entra",
    inactive: "Inactive owner",
  }[status];
}

export default function OwnerReconciliationPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OwnerReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<ApiResponse["summary"] | null>(null);
  const [missingReftabRows, setMissingReftabRows] = useState<MissingReftabAssetRow[]>([]);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }

    fetch("/api/admin/owner-reconciliation")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load owner reconciliation");
        return data as ApiResponse;
      })
      .then((data) => {
        setRows(data.rows);
        setMissingReftabRows(data.missingReftabRows);
        setSummary(data.summary);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load owner reconciliation"))
      .finally(() => setLoading(false));
  }, [router]);

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

  async function approve(row: OwnerReconciliationRow) {
    const confirmed = window.confirm(`Move ${row.assetTag} from ${ownerLabel(row.reftabOwner, row.reftabOwnerEmployeeId)} to ${ownerLabel(row.ninjaOwner, row.ninjaOwner.employeeId)} in Reftab?`);
    if (!confirmed) return;

    setApprovingId(row.id);
    setError(null);
    setMessage(null);
    try {
      const { res, data } = await postJsonWithTimeout({ assetTag: row.assetTag, ninjaDeviceId: row.ninjaDevice.id });
      if (!res.ok) throw new Error(data.error ?? "Failed to approve owner change");
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      setSummary((prev) => prev ? {
        ...prev,
        mismatchCount: Math.max(0, prev.mismatchCount - 1),
        alreadyMatchedOwnerCount: prev.alreadyMatchedOwnerCount + 1,
      } : prev);
      setMessage(`${row.assetTag} reassigned to ${row.ninjaOwner.displayName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve owner change");
    } finally {
      setApprovingId(null);
    }
  }

  async function addMissing(row: MissingReftabAssetRow) {
    if (!row.ninjaOwner?.isActive) return;
    const confirmed = window.confirm(`Add ${row.assetTag} to Reftab and assign it to ${ownerLabel(row.ninjaOwner, row.ninjaOwner.employeeId)}?`);
    if (!confirmed) return;

    setApprovingId(row.id);
    setError(null);
    setMessage(null);
    try {
      const { res, data } = await postJsonWithTimeout({
        action: "add-missing-asset",
        assetTag: row.assetTag,
        ninjaDeviceId: row.ninjaDevice.id,
        serial: row.serial,
        model: row.model,
        title: row.title,
        ownerEmployeeId: row.ninjaOwner.employeeId,
        ownerEmail: row.ninjaOwner.email,
      });
      if (!res.ok) throw new Error(data.error ?? "Failed to add Reftab asset");
      setMissingReftabRows((prev) => prev.filter((item) => item.id !== row.id));
      setSummary((prev) => prev ? {
        ...prev,
        missingReftabCount: Math.max(0, prev.missingReftabCount - 1),
        equipmentCount: prev.equipmentCount + 1,
      } : prev);
      setMessage(`${row.assetTag} added to Reftab for ${row.ninjaOwner.displayName}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add Reftab asset");
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">&larr; Dashboard</Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Owner Reconciliation</h1>
          <p className="text-[var(--muted)]">{rows.length} owner mismatch{rows.length === 1 ? "" : "es"}, {missingReftabRows.length} missing from Reftab</p>
        </div>
        <div className="w-full max-w-sm">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="input-search"
          />
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryPill label="Reftab items" value={summary.equipmentCount} />
          <SummaryPill label="Ninja devices" value={summary.ninjaDeviceCount} />
          <SummaryPill label="Device matches" value={summary.matchedDeviceCount} />
          <SummaryPill label="Missing Reftab" value={summary.missingReftabCount} />
          <SummaryPill label="No owner signal" value={summary.missingNinjaOwnerCount} />
          <SummaryPill label="Owner not in Entra" value={summary.unresolvedNinjaOwnerCount} />
          <SummaryPill label="Inactive owner" value={summary.inactiveNinjaOwnerCount} />
          <SummaryPill label="Already aligned" value={summary.alreadyMatchedOwnerCount} />
          <SummaryPill label="Mismatches" value={summary.mismatchCount} />
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">NinjaOne owner mismatches</h2>
            <span className="text-sm text-[var(--muted)]">{filteredRows.length} shown</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px]">
            <thead>
              <tr>
                <th className="table-header">Asset</th>
                <th className="table-header">Serial</th>
                <th className="table-header">Reftab owner</th>
                <th className="table-header">NinjaOne owner</th>
                <th className="table-header">NinjaOne device</th>
                <th className="table-header">Match</th>
                <th className="table-header">Last contact</th>
                <th className="table-header">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{row.assetTag}</div>
                    <div className="text-xs text-[var(--muted)]">{row.title ?? row.model ?? row.category ?? "-"}</div>
                  </td>
                  <td className="table-cell text-[var(--text-secondary)]">{row.serial ?? "-"}</td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{ownerLabel(row.reftabOwner, row.reftabOwnerEmployeeId)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.reftabOwner?.email ?? "No active Entra match"}</div>
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
                  <td className="table-cell text-[var(--text-secondary)]">{formatDate(row.ninjaDevice.lastContact ?? row.ninjaDevice.lastUpdate)}</td>
                  <td className="table-cell">
                    <button
                      type="button"
                      onClick={() => approve(row)}
                      disabled={approvingId === row.id}
                      className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      {approvingId === row.id ? "Approving" : "Approve"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredRows.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">No owner mismatches found.</p>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">In NinjaOne, missing from Reftab</h2>
            <span className="text-sm text-[var(--muted)]">{filteredMissingRows.length} shown</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr>
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
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{row.assetTag}</div>
                    <div className="text-xs text-[var(--muted)]">{row.title ?? row.model ?? "-"}</div>
                  </td>
                  <td className="table-cell text-[var(--text-secondary)]">{row.serial ?? "-"}</td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{row.ninjaOwner ? ownerLabel(row.ninjaOwner, row.ninjaOwner.employeeId) : ownerStatusLabel(row.ownerStatus)}</div>
                    <div className="text-xs text-[var(--muted)]">{row.ninjaOwner?.email ?? row.ninjaOwnerRaw ?? "-"}</div>
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
                  <td className="table-cell text-[var(--text-secondary)]">{formatDate(row.ninjaDevice.lastContact ?? row.ninjaDevice.lastUpdate)}</td>
                  <td className="table-cell">
                    <button
                      type="button"
                      onClick={() => addMissing(row)}
                      disabled={approvingId === row.id || !row.ninjaOwner?.isActive}
                      className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      title={row.ninjaOwner?.isActive ? "Create and assign in Reftab" : ownerStatusLabel(row.ownerStatus)}
                    >
                      {approvingId === row.id ? "Adding" : "Add to Reftab"}
                    </button>
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
