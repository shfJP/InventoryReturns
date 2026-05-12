"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import { exportRowsToCsv } from "@/lib/csv-export";

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
  investigationNotes: string | null;
  ninjaOneMatches: Array<{
    id: string;
    displayName: string | null;
    systemName: string | null;
    dnsName: string | null;
    netbiosName: string | null;
    likelyUser: string | null;
    offline: boolean | null;
    lastContact: string | null;
    lastUpdate: string | null;
    matchReason: string;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    oldStatus: string | null;
    newStatus: string | null;
    note: string | null;
    actorEmployeeId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    createdAt: string;
  }>;
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

function normalizeItem(item: UnresolvedCollection): UnresolvedCollection {
  return { ...item, auditEvents: item.auditEvents ?? [], ninjaOneMatches: item.ninjaOneMatches ?? [] };
}

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

function formatDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const [last, ...rest] = trimmed.split(",");
  if (rest.length === 0) return trimmed;
  const first = rest.join(",").trim().replace(/\s+/g, " ");
  return first ? `${first} ${last.trim()}` : trimmed;
}

function firstNameOnly(name: string | null | undefined) {
  const displayName = formatDisplayName(name);
  return displayName.split(/\s+/)[0] || "Manager";
}

type SortDirection = "asc" | "desc";
type UnresolvedSortKey = "employee" | "manager" | "assetTag" | "catName" | "serial" | "model" | "ninjaOne" | "detectedAt" | "status" | "investigationNotes";

const unresolvedColumns: Array<{ key: UnresolvedSortKey; label: string }> = [
  { key: "employee", label: "Employee" },
  { key: "manager", label: "Manager Responsible" },
  { key: "assetTag", label: "Asset Tag" },
  { key: "catName", label: "Category" },
  { key: "serial", label: "Serial" },
  { key: "model", label: "Model" },
  { key: "ninjaOne", label: "NinjaOne Device" },
  { key: "detectedAt", label: "Detected" },
  { key: "status", label: "Status" },
  { key: "investigationNotes", label: "Notes" },
];

const investigationStatuses = [
  { value: "UNRESOLVED", label: "Unresolved" },
  { value: "INVESTIGATING", label: "Investigating" },
  { value: "PENDING_MANAGER", label: "Pending Manager" },
  { value: "PENDING_IT", label: "Pending IT" },
  { value: "PENDING_VENDOR", label: "Pending Vendor" },
  { value: "RESOLVED", label: "Resolved" },
];

function investigationStatusLabel(statusValue: string) {
  return investigationStatuses.find((status) => status.value === statusValue)?.label ?? statusValue;
}

function ninjaOneSummary(item: UnresolvedCollection) {
  const match = item.ninjaOneMatches[0];
  if (!match) return "";
  const deviceName = match.displayName ?? match.systemName ?? match.netbiosName ?? match.dnsName ?? match.id;
  const user = match.likelyUser ? `; user: ${match.likelyUser}` : "";
  const contact = match.lastContact ? `; last contact: ${formatNinjaTimestamp(match.lastContact)}` : "";
  return `${deviceName}${user}${contact}`;
}

function formatNinjaTimestamp(value: string | null | undefined) {
  if (!value) return "Not available";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(millis).toLocaleString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function collectionMailtoHref(item: UnresolvedCollection) {
  if (!item.managerEmail) return null;
  const subject = `Equipment collection needed: ${formatDisplayName(item.employeeName)} - ${item.assetTag}`;
  const body = [
    `Hello ${firstNameOnly(item.managerName)},`,
    "",
    "We are following up on an unresolved equipment return that appears to be under your management responsibility. Please coordinate collection of the equipment listed below and return it to the IT Department as soon as possible.",
    "",
    "Collection details:",
    `Employee: ${formatDisplayName(item.employeeName)}${item.employeeEmail ? ` <${item.employeeEmail}>` : ""}`,
    `Employee ID: ${item.employeeId}`,
    `Asset tag: ${item.assetTag}`,
    `Category: ${item.catName ?? "Not available"}`,
    `Serial: ${item.serial ?? "Not available"}`,
    `Model: ${item.model ?? "Not available"}`,
    `NinjaOne evidence: ${ninjaOneSummary(item) || "No matching NinjaOne device found"}`,
    `Current investigation status: ${investigationStatusLabel(item.status)}`,
    `Detected: ${new Date(item.detectedAt).toLocaleString()}`,
    "",
    "Investigation notes:",
    item.investigationNotes?.trim() || "No investigation notes have been recorded yet.",
    "",
    "Please reply with the expected return date, current equipment location, or any blockers preventing collection. This message copies IT Help so a collection support ticket can be tracked.",
    "",
    "Thank you.",
  ].join("\n");

  return `mailto:${encodeURIComponent(item.managerEmail)}?cc=${encodeURIComponent("ithelp@sevenhills.org")}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function unresolvedSortValue(item: UnresolvedCollection, key: UnresolvedSortKey) {
  if (key === "employee") return `${formatDisplayName(item.employeeName)} ${item.employeeEmail ?? item.employeeId}`;
  if (key === "manager") return `${formatDisplayName(item.managerName)} ${item.managerEmail ?? item.managerEmployeeId ?? ""}`;
  if (key === "ninjaOne") return ninjaOneSummary(item);
  if (key === "detectedAt") return new Date(item.detectedAt).getTime();
  return item[key] ?? "";
}

function unresolvedFilterText(item: UnresolvedCollection) {
  return [
    item.employeeName,
    formatDisplayName(item.employeeName),
    item.employeeEmail,
    item.employeeId,
    item.managerName,
    formatDisplayName(item.managerName),
    item.managerEmail,
    item.managerEmployeeId,
    item.assetTag,
    item.catName,
    item.serial,
    item.model,
    ninjaOneSummary(item),
    ...item.ninjaOneMatches.flatMap((match) => [
      match.displayName,
      match.systemName,
      match.dnsName,
      match.netbiosName,
      match.likelyUser,
      match.matchReason,
    ]),
    item.source,
    item.investigationNotes,
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
  isAdmin,
  onUpdateItem,
  exportName,
}: {
  items: UnresolvedCollection[];
  emptyText: string;
  isAdmin: boolean;
  onUpdateItem: (item: UnresolvedCollection) => void;
  exportName: string;
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

  function exportTable() {
    exportRowsToCsv(exportName, [
      { header: "Employee", value: (item) => formatDisplayName(item.employeeName) },
      { header: "Employee Email", value: (item) => item.employeeEmail },
      { header: "Employee ID", value: (item) => item.employeeId },
      { header: "Manager", value: (item) => formatDisplayName(item.managerName) || "Unknown" },
      { header: "Manager Email", value: (item) => item.managerEmail },
      { header: "Manager Employee ID", value: (item) => item.managerEmployeeId },
      { header: "Asset Tag", value: (item) => item.assetTag },
      { header: "Category", value: (item) => item.catName },
      { header: "Serial", value: (item) => item.serial },
      { header: "Model", value: (item) => item.model },
      { header: "NinjaOne Device", value: (item) => ninjaOneSummary(item) },
      { header: "Detected", value: (item) => new Date(item.detectedAt).toLocaleString() },
      { header: "Status", value: (item) => investigationStatusLabel(item.status) },
      { header: "Investigation Notes", value: (item) => item.investigationNotes },
    ], filteredItems);
  }

  async function updateInvestigation(item: UnresolvedCollection, data: Partial<Pick<UnresolvedCollection, "status" | "investigationNotes">>) {
    const res = await fetch("/api/reports/unresolved-collections", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, ...data }),
    });
    const updated = await res.json();
    if (!res.ok) throw new Error(updated.error ?? "Failed to update investigation");
    onUpdateItem({
      ...item,
      status: updated.status ?? item.status,
      investigationNotes: updated.investigationNotes ?? item.investigationNotes,
      auditEvents: updated.auditEvents ?? item.auditEvents,
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
        <input
          type="search"
          aria-label="Filter table"
          placeholder="Filter this table"
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <button
          type="button"
          onClick={exportTable}
          className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Export Excel
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1380px]">
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
                  <div className="font-medium text-[var(--text)]">{formatDisplayName(item.employeeName)}</div>
                  <div className="text-xs text-[var(--muted)]">{item.employeeEmail ?? item.employeeId}</div>
                  {item.source === "reftab_unmatched_assignee" && (
                    <span className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      Reftab unmatched
                    </span>
                  )}
                </td>
                <td className="table-cell">
                  <div className="font-medium text-[var(--text)]">{formatDisplayName(item.managerName) || "Unknown"}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {item.managerEmail ? (
                      <a
                        href={collectionMailtoHref(item) ?? undefined}
                        className="text-[var(--accent)] hover:underline"
                        title="Email manager and IT Help about this unresolved collection"
                      >
                        {item.managerEmail}
                      </a>
                    ) : (
                      item.managerEmployeeId ?? ""
                    )}
                  </div>
                </td>
                <td className="table-cell font-medium text-[var(--text)]">{item.assetTag}</td>
                <td className="table-cell text-[var(--text-secondary)]">{item.catName ?? "-"}</td>
                <td className="table-cell text-[var(--text-secondary)]">{item.serial ?? "-"}</td>
                <td className="table-cell text-[var(--text-secondary)]">{item.model ?? "-"}</td>
                <td className="table-cell text-[var(--text-secondary)]">
                  {item.ninjaOneMatches.length > 0 ? (
                    <div className="space-y-1">
                      {item.ninjaOneMatches.map((match) => {
                        const name = match.displayName ?? match.systemName ?? match.netbiosName ?? match.dnsName ?? match.id;
                        return (
                          <div key={match.id} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-900">
                            <div className="font-medium">{name}</div>
                            <div>{match.likelyUser ? `Likely user: ${match.likelyUser}` : "No user signal"}</div>
                            <div>{match.offline ? "Offline" : "Online or unknown"} · matched by {match.matchReason}</div>
                            {match.lastContact && <div>Last contact: {formatNinjaTimestamp(match.lastContact)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="table-cell text-[var(--text-secondary)]">{new Date(item.detectedAt).toLocaleString()}</td>
                <td className="table-cell">
                  {isAdmin ? (
                    <select
                      value={item.status}
                      onChange={(event) => {
                        updateInvestigation(item, { status: event.target.value }).catch((e) => alert(e instanceof Error ? e.message : "Failed to update status"));
                      }}
                      className="rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm text-[var(--text)]"
                    >
                      {investigationStatuses.map((status) => (
                        <option key={status.value} value={status.value}>{status.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                      {investigationStatusLabel(item.status)}
                    </span>
                  )}
                </td>
                <td className="table-cell">
                  {isAdmin ? (
                    <details className="group">
                      <summary className="inline-flex cursor-pointer items-center rounded-md border border-[var(--border)] p-2 text-[var(--text-secondary)] hover:bg-gray-100" title="Investigation notes">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        <span className="sr-only">Investigation notes</span>
                      </summary>
                      <textarea
                        defaultValue=""
                        placeholder="Add an investigation note"
                        className="mt-2 h-24 w-72 rounded-md border border-[var(--border)] p-2 text-sm text-[var(--text)]"
                        onBlur={(event) => {
                          const note = event.target.value.trim();
                          if (!note) return;
                          updateInvestigation(item, { investigationNotes: note })
                            .then(() => { event.target.value = ""; })
                            .catch((e) => alert(e instanceof Error ? e.message : "Failed to save notes"));
                        }}
                      />
                      {item.investigationNotes && (
                        <pre className="mt-2 max-h-36 w-72 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-xs text-[var(--text-secondary)]">{item.investigationNotes}</pre>
                      )}
                      {item.auditEvents.length > 0 && (
                        <div className="mt-2 max-h-32 w-72 overflow-auto rounded-md border border-[var(--border)] p-2">
                          <p className="mb-1 text-xs font-medium text-[var(--muted)]">Audit log</p>
                          {item.auditEvents.map((event) => (
                            <div key={event.id} className="border-t border-[var(--border)] py-1 text-xs text-[var(--text-secondary)] first:border-t-0">
                              <div className="font-medium text-[var(--text)]">{event.action.replace(/_/g, " ")}</div>
                              <div>{new Date(event.createdAt).toLocaleString()} · {event.actorName ?? event.actorEmail ?? "Unknown user"}</div>
                              {event.note && <div className="mt-0.5">{event.note}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </details>
                  ) : (
                    <span className="text-[var(--text-secondary)]">{item.investigationNotes ?? "-"}</span>
                  )}
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
  const [isAdmin, setIsAdmin] = useState(false);
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
          setItems(data.map(normalizeItem));
          setSummary(null);
          return;
        }
        setItems(data.items.map(normalizeItem));
        setSummary(data.summary ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load unresolved collections"))
      .finally(() => setLoading(false));
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [router]);

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const knownManagerItems = items.filter(hasKnownManager);
  const unknownManagerItems = items.filter((item) => !hasKnownManager(item));
  const updateItem = (updated: UnresolvedCollection) => {
    setItems((current) => updated.status === "RESOLVED"
      ? current.filter((item) => item.id !== updated.id)
      : current.map((item) => item.id === updated.id ? updated : item)
    );
  };

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
        <UnresolvedTable items={knownManagerItems} emptyText="No unresolved collections with known managers." isAdmin={isAdmin} onUpdateItem={updateItem} exportName="known-manager-unresolved.csv" />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Legacy - Unknown Manager</h2>
          <p className="text-sm text-[var(--muted)]">{unknownManagerItems.length} unresolved item(s) without manager details.</p>
        </div>
        <UnresolvedTable items={unknownManagerItems} emptyText="No legacy unresolved collections with unknown managers." isAdmin={isAdmin} onUpdateItem={updateItem} exportName="unknown-manager-unresolved.csv" />
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
