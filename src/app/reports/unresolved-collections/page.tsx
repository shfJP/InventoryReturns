"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";

type UnresolvedCollection = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string | null;
  managerEmployeeId: string | null;
  managerName: string | null;
  managerEmail: string | null;
  assetTag: string;
  catName: string | null;
  serial: string | null;
  model: string | null;
  source: string;
  detectedAt: string;
  status: string;
};

type LossSummary = {
  knownActive: { count: number; estimatedValueCents: number };
  unknown: { count: number; estimatedValueCents: number };
  total: { count: number; estimatedValueCents: number };
};

type UnresolvedResponse = {
  items: UnresolvedCollection[];
  summary?: LossSummary;
};

function dollarsFromCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function hasKnownManager(item: UnresolvedCollection) {
  return Boolean(
    item.managerEmployeeId?.trim() ||
    item.managerEmail?.trim() ||
    (item.managerName?.trim() && item.managerName.trim().toLowerCase() !== "unknown")
  );
}

type SortDirection = "asc" | "desc";
type UnresolvedSortKey = "employee" | "manager" | "assetTag" | "catName" | "serial" | "model" | "detectedAt" | "status";

const unresolvedColumns: Array<{ key: UnresolvedSortKey; label: string }> = [
  { key: "employee", label: "Employee" },
  { key: "manager", label: "Manager Responsible" },
  { key: "assetTag", label: "Asset Tag" },
  { key: "catName", label: "Category" },
  { key: "serial", label: "Serial" },
  { key: "model", label: "Model" },
  { key: "detectedAt", label: "Detected" },
  { key: "status", label: "Status" },
];

function unresolvedSortValue(item: UnresolvedCollection, key: UnresolvedSortKey) {
  if (key === "employee") return `${item.employeeName} ${item.employeeEmail ?? item.employeeId}`;
  if (key === "manager") return `${item.managerName ?? ""} ${item.managerEmail ?? item.managerEmployeeId ?? ""}`;
  if (key === "detectedAt") return new Date(item.detectedAt).getTime();
  return item[key] ?? "";
}

function unresolvedFilterText(item: UnresolvedCollection) {
  return [
    item.employeeName,
    item.employeeEmail,
    item.employeeId,
    item.managerName,
    item.managerEmail,
    item.managerEmployeeId,
    item.assetTag,
    item.catName,
    item.serial,
    item.model,
    item.source,
    item.status,
    new Date(item.detectedAt).toLocaleString(),
  ].filter(Boolean).join(" ").toLowerCase();
}

function SortHeader({
  column,
  sortKey,
  sortDirection,
  onSort,
}: {
  column: { key: UnresolvedSortKey; label: string };
  sortKey: UnresolvedSortKey;
  sortDirection: SortDirection;
  onSort: (key: UnresolvedSortKey) => void;
}) {
  const active = sortKey === column.key;
  return (
    <th className="table-header">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => onSort(column.key)}
      >
        <span>{column.label}</span>
        <span className="text-xs text-[var(--muted)]">{active ? (sortDirection === "asc" ? "↑" : "↓") : "↑↓"}</span>
      </button>
    </th>
  );
}

function UnresolvedTable({
  items,
  emptyText,
}: {
  items: UnresolvedCollection[];
  emptyText: string;
}) {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<UnresolvedSortKey>("detectedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const filteredItems = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = query ? items.filter((item) => unresolvedFilterText(item).includes(query)) : items;
    return [...filtered].sort((a, b) => {
      const aValue = unresolvedSortValue(a, sortKey);
      const bValue = unresolvedSortValue(b, sortKey);
      const result = typeof aValue === "number" && typeof bValue === "number"
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? result : -result;
    });
  }, [filter, items, sortDirection, sortKey]);

  function handleSort(key: UnresolvedSortKey) {
    if (key === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "detectedAt" ? "desc" : "asc");
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
        <input
          type="search"
          aria-label="Filter table"
          placeholder="Filter this table"
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead>
            <tr>
              {unresolvedColumns.map((column) => (
                <SortHeader
                  key={column.key}
                  column={column}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                <td className="table-cell">
                  <div className="font-medium text-[var(--text)]">{item.employeeName}</div>
                  <div className="text-xs text-[var(--muted)]">{item.employeeEmail ?? item.employeeId}</div>
                  {item.source === "reftab_unmatched_assignee" && (
                    <span className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Reftab unmatched
                    </span>
                  )}
                </td>
                <td className="table-cell">
                  <div className="font-medium text-[var(--text)]">{item.managerName ?? "Unknown"}</div>
                  <div className="text-xs text-[var(--muted)]">{item.managerEmail ?? item.managerEmployeeId ?? ""}</div>
                </td>
                <td className="table-cell font-medium text-[var(--text)]">{item.assetTag}</td>
                <td className="table-cell text-[var(--text-secondary)]">{item.catName ?? "-"}</td>
                <td className="table-cell text-[var(--text-secondary)]">{item.serial ?? "-"}</td>
                <td className="table-cell text-[var(--text-secondary)]">{item.model ?? "-"}</td>
                <td className="table-cell text-[var(--text-secondary)]">{new Date(item.detectedAt).toLocaleString()}</td>
                <td className="table-cell">
                  <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                    Pending Collection
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredItems.length === 0 && (
        <p className="py-12 text-center text-[var(--muted)]">{items.length === 0 ? emptyText : "No rows match the current filter."}</p>
      )}
    </div>
  );
}

export default function UnresolvedCollectionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<UnresolvedCollection[]>([]);
  const [summary, setSummary] = useState<LossSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }

    fetch("/api/reports/unresolved-collections")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load unresolved collections");
        return res.json();
      })
      .then((data: UnresolvedResponse | UnresolvedCollection[]) => {
        if (Array.isArray(data)) {
          setItems(data);
          setSummary(null);
          return;
        }
        setItems(data.items);
        setSummary(data.summary ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load unresolved collections"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const knownManagerItems = items.filter(hasKnownManager);
  const unknownManagerItems = items.filter((item) => !hasKnownManager(item));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">&larr; Dashboard</Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Unresolved Collections</h1>
        <p className="text-[var(--muted)]">Terminated employees or Reftab assignments that do not map cleanly to Entra users.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Unresolved Items</p>
          <p className="text-2xl font-bold text-orange-600">{items.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Employees</p>
          <p className="text-2xl font-bold text-[var(--text)]">{new Set(items.map((item) => item.employeeId)).size}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Managers</p>
          <p className="text-2xl font-bold text-[var(--text)]">{new Set(items.map((item) => item.managerEmployeeId).filter(Boolean)).size}</p>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <LossCard
            label="Known Active Management"
            count={summary.knownActive.count}
            value={summary.knownActive.estimatedValueCents}
            className="text-purple-700"
          />
          <LossCard
            label="Legacy - Unknown Manager"
            count={summary.unknown.count}
            value={summary.unknown.estimatedValueCents}
            className="text-amber-700"
          />
          <LossCard
            label="Total Estimated Loss"
            count={summary.total.count}
            value={summary.total.estimatedValueCents}
            className="text-red-700"
          />
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Known Managers</h2>
          <p className="text-sm text-[var(--muted)]">{knownManagerItems.length} unresolved item(s) with a manager responsible.</p>
        </div>
        <UnresolvedTable items={knownManagerItems} emptyText="No unresolved collections with known managers." />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Legacy - Unknown Manager</h2>
          <p className="text-sm text-[var(--muted)]">{unknownManagerItems.length} unresolved item(s) without manager details.</p>
        </div>
        <UnresolvedTable items={unknownManagerItems} emptyText="No legacy unresolved collections with unknown managers." />
      </section>
    </div>
  );
}

function LossCard({
  label,
  count,
  value,
  className,
}: {
  label: string;
  count: number;
  value: number;
  className: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${className}`}>{dollarsFromCents(value)}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{count} unresolved item(s)</p>
    </div>
  );
}
