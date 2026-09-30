"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";

type DirectoryStatus = "all" | "active" | "terminated" | "review";

type DirectoryManager = {
  employeeId: string;
  displayName: string;
  email: string | null;
  isActive: boolean;
};

type DirectoryRow = {
  employeeId: string;
  sourcePersonKey: string;
  displayName: string;
  email: string | null;
  managerEmployeeId: string | null;
  manager: DirectoryManager | null;
  employmentStatus: string;
  directoryState: string;
  isActive: boolean;
  terminationDate: string | null;
  sourceSyncedAt: string | null;
  replicatedAt: string;
};

type DirectoryResponse = {
  summary: {
    total: number;
    active: number;
    terminated: number;
    needsReview: number;
    lastReplicatedAt: string | null;
    latestSourceSyncAt: string | null;
  };
  rows: DirectoryRow[];
  pagination: {
    page: number;
    pageSize: number;
    pageCount: number;
    filteredCount: number;
  };
};

function formatDate(value: string | null, includeTime = false): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" });
}

function statusBadge(row: DirectoryRow) {
  if (row.isActive) {
    return {
      label: "Active",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    };
  }
  if (row.employmentStatus === "T" && row.directoryState === "OFFBOARDING") {
    return {
      label: "Terminated",
      className: "bg-rose-50 text-rose-700 ring-rose-600/20",
    };
  }
  return {
    label: "Review",
    className: "bg-amber-50 text-amber-700 ring-amber-600/20",
  };
}

export default function DirectoryPage() {
  const router = useRouter();
  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [status, setStatus] = useState<DirectoryStatus>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const loadDirectory = useCallback((signal?: AbortSignal) => {
    const params = new URLSearchParams({
      status,
      q: search.trim(),
      page: String(page),
      pageSize: "50",
    });

    setLoading(true);
    setError(null);
    fetch(`/api/admin/directory?${params.toString()}`, { signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Failed to load directory");
        return body as DirectoryResponse;
      })
      .then((body) => {
        setData(body);
        if (body.pagination.page !== page) setPage(body.pagination.page);
      })
      .catch((fetchError) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load directory");
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [page, search, status]);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => loadDirectory(controller.signal), search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadDirectory, reloadToken, router, search]);

  async function syncDirectory() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/sync-entra", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Directory sync failed");
      setMessage(
        `Directory sync complete: ${Number(body.replicated ?? body.usersUpserted ?? 0).toLocaleString()} employee states processed.`,
      );
      setPage(1);
      setReloadToken((token) => token + 1);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Directory sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const summary = data?.summary;
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">
        &larr; Dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Employee Directory</h1>
          <p className="text-[var(--muted)]">
            Current active, terminated, and review states replicated from the employee lifecycle database.
          </p>
          {summary?.lastReplicatedAt && (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Snapshot replicated {formatDate(summary.lastReplicatedAt, true)}
              {summary.latestSourceSyncAt
                ? ` · latest source update ${formatDate(summary.latestSourceSyncAt, true)}`
                : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={syncDirectory}
          disabled={syncing}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {syncing ? "Syncing directory..." : "Sync directory"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="All employee states" value={summary?.total ?? 0} tone="slate" />
        <SummaryCard label="Active" value={summary?.active ?? 0} tone="emerald" />
        <SummaryCard label="Terminated" value={summary?.terminated ?? 0} tone="rose" />
        <SummaryCard label="Needs review" value={summary?.needsReview ?? 0} tone="amber" />
      </div>

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="space-y-3 border-b border-[var(--border)] bg-[var(--table-header-bg)] p-4 lg:flex lg:items-center lg:justify-between lg:space-y-0">
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All"],
              ["active", "Active"],
              ["terminated", "Terminated"],
              ["review", "Needs review"],
            ] as Array<[DirectoryStatus, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                }}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  status === value
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-gray-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="block lg:w-96">
            <span className="sr-only">Search directory</span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, employee ID, email, or manager ID"
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr>
                <th className="table-header">Employee</th>
                <th className="table-header">Status</th>
                <th className="table-header">Directory state</th>
                <th className="table-header">Manager</th>
                <th className="table-header">Termination date</th>
                <th className="table-header">Source updated</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row) => {
                const badge = statusBadge(row);
                return (
                  <tr key={row.employeeId} className="transition hover:bg-[var(--table-header-bg)]/50">
                    <td className="table-cell">
                      <div className="font-medium text-[var(--text)]">{row.displayName}</div>
                      <div className="text-xs text-[var(--muted)]">
                        {row.employeeId}{row.email ? ` · ${row.email}` : ""}
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${badge.className}`}>
                        {badge.label}
                      </span>
                      <div className="mt-1 text-xs text-[var(--muted)]">Code {row.employmentStatus}</div>
                    </td>
                    <td className="table-cell text-[var(--text-secondary)]">{row.directoryState}</td>
                    <td className="table-cell">
                      {row.manager ? (
                        <>
                          <div className="font-medium text-[var(--text)]">{row.manager.displayName}</div>
                          <div className="text-xs text-[var(--muted)]">{row.manager.employeeId}</div>
                        </>
                      ) : (
                        <span className="text-[var(--muted)]">{row.managerEmployeeId ?? "-"}</span>
                      )}
                    </td>
                    <td className="table-cell text-[var(--text-secondary)]">{formatDate(row.terminationDate)}</td>
                    <td className="table-cell text-[var(--text-secondary)]">{formatDate(row.sourceSyncedAt, true)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && data?.rows.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">
            {search ? "No directory rows match this search." : "No directory snapshot is available yet."}
          </p>
        )}
        {loading && <p className="py-12 text-center text-[var(--muted)]">Loading directory...</p>}

        {pagination && pagination.filteredCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
            <span className="text-sm text-[var(--muted)]">
              {((pagination.page - 1) * pagination.pageSize) + 1}-
              {Math.min(pagination.page * pagination.pageSize, pagination.filteredCount)} of{" "}
              {pagination.filteredCount.toLocaleString()}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--muted)]">
                Page {pagination.page} of {pagination.pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={loading || pagination.page <= 1}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(pagination.pageCount, current + 1))}
                disabled={loading || pagination.page >= pagination.pageCount}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "rose" | "amber";
}) {
  const toneClass = {
    slate: "text-slate-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
  }[tone];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value.toLocaleString()}</div>
    </div>
  );
}
