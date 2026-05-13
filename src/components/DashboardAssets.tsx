"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import type { DashboardData } from "@/types/dashboard";
import { exportRowsToCsv } from "@/lib/csv-export";
import { formatPersonName } from "@/lib/display-name";
import ContentHeader from "./ContentHeader";
import Pagination from "./Pagination";

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 25];

const ASSET_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "outstanding", label: "Outstanding only" },
  { value: "collected", label: "Collected only" },
  { value: "laptop", label: "Laptops only" },
  { value: "monitor", label: "Monitors only" },
];

export default function DashboardAssets({ data, initialSearchQuery = "" }: { data: DashboardData; initialSearchQuery?: string }) {
  const { me, staff, equipment, syncStatus } = data;
  const staffById = Object.fromEntries(staff.map((s) => [s.employeeId, s]));
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [filterBy, setFilterBy] = useState("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (initialSearchQuery) setSearchQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  const filteredEquipment = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = equipment;
    if (q) {
      list = list.filter((e) => {
        const assignee = staffById[e.assignedToEmployeeId];
        return (
          e.assetTag.toLowerCase().includes(q) ||
          (e.serial?.toLowerCase().includes(q)) ||
          (e.model?.toLowerCase().includes(q)) ||
          e.assignedToEmployeeId.toLowerCase().includes(q) ||
          (assignee && formatPersonName(assignee.displayName).toLowerCase().includes(q))
        );
      });
    }
    if (filterBy === "outstanding") {
      list = list.filter((e) => e.collectionStatus === "outstanding");
    } else if (filterBy === "collected") {
      list = list.filter((e) => e.collectionStatus === "collected");
    } else if (filterBy === "laptop") {
      list = list.filter((e) => (e.model?.toLowerCase().includes("mac") || e.model?.toLowerCase().includes("laptop")) ?? false);
    } else if (filterBy === "monitor") {
      list = list.filter((e) => e.model?.toLowerCase().includes("monitor") ?? false);
    }
    return list;
  }, [equipment, searchQuery, filterBy, staffById]);

  const totalPages = Math.max(1, Math.ceil(filteredEquipment.length / pageSize));
  const paginatedEquipment = useMemo(
    () => filteredEquipment.slice((page - 1) * pageSize, page * pageSize),
    [filteredEquipment, page, pageSize]
  );

  const handleFilterChange = (value: string) => {
    setFilterBy(value);
    setPage(1);
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };
  const exportEquipment = () => {
    exportRowsToCsv("dashboard-equipment.csv", [
      { header: "Asset Tag", value: (e) => e.assetTag },
      { header: "Serial", value: (e) => e.serial },
      { header: "Model", value: (e) => e.model },
      { header: "Assigned To", value: (e) => formatPersonName(staffById[e.assignedToEmployeeId]?.displayName) || e.assignedToEmployeeId },
      { header: "Assigned To Employee ID", value: (e) => e.assignedToEmployeeId },
      { header: "Status", value: (e) => e.collectionStatus },
    ], filteredEquipment);
  };

  return (
    <div className="space-y-6">
      <ContentHeader
        title="Equipment (asset-centric)"
        searchPlaceholder="Search equipment"
        showFilter={true}
        searchValue={searchQuery}
        onSearchChange={(v) => { setSearchQuery(v); setPage(1); }}
        filterOptions={ASSET_FILTER_OPTIONS}
        selectedFilter={filterBy}
        onFilterChange={handleFilterChange}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        showSettingsLink={true}
      />
      <div className="flex justify-end">
        <button type="button" onClick={exportEquipment} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
          Export Excel
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Signed in as {formatPersonName(me.displayName)} ({me.employeeId}). Return logistics view. · Showing {filteredEquipment.length} of {equipment.length}
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr>
                <th className="table-header">Asset tag</th>
                <th className="table-header">Serial</th>
                <th className="table-header">Model</th>
                <th className="table-header">Assigned to</th>
                <th className="table-header">Status</th>
                <th className="table-header">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEquipment.map((e) => {
                const assignee = staffById[e.assignedToEmployeeId];
                const isCollected = e.collectionStatus === "collected";
                const isOutstanding = e.collectionStatus === "outstanding";
                return (
                  <tr
                    key={`${e.assetTag}-${e.assignedToEmployeeId}`}
                    className={`border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50 ${isCollected ? "opacity-50" : ""}`}
                  >
                    <td className="table-cell font-medium text-[var(--text)]">{e.assetTag}</td>
                    <td className="table-cell text-[var(--text-secondary)]">{e.serial ?? "—"}</td>
                    <td className="table-cell text-[var(--text-secondary)]">{e.model ?? "—"}</td>
                    <td className="table-cell">
                      {assignee ? (
                        <Link
                          href={`/staff/${encodeURIComponent(e.assignedToEmployeeId)}`}
                          className="text-[var(--accent)] hover:underline"
                        >
                          {formatPersonName(assignee.displayName)}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted)]">{e.assignedToEmployeeId}</span>
                      )}
                    </td>
                    <td className="table-cell">
                      {isCollected ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          ✓ Collected
                        </span>
                      ) : isOutstanding ? (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          Outstanding
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          Assigned
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      {isCollected || !isOutstanding ? (
                        <span className="text-sm text-[var(--muted)]">—</span>
                      ) : (
                        <Link
                          href={`/staff/${encodeURIComponent(e.assignedToEmployeeId)}`}
                          className="inline-flex rounded-lg bg-[var(--success)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                        >
                          Mark collected
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredEquipment.length === 0 && (
          <div className="px-4 py-12 text-center text-[var(--muted)]">
            <p>
              {equipment.length === 0
                ? "No equipment in scope. Run db:seed or connect Reftab API."
                : "No equipment matches the current search or filter."}
            </p>
            {equipment.length === 0 && (
              <p className="mt-2 text-xs">
                {syncStatus?.reftabSyncedAt
                  ? `Last Reftab sync: ${new Date(syncStatus.reftabSyncedAt).toLocaleString()}`
                  : "No Reftab sync has written equipment yet."}
              </p>
            )}
          </div>
        )}
        {filteredEquipment.length > 0 && (
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--text)]">People in scope</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{staff.length} report(s). Open staff detail to see all equipment per person.</p>
      </div>
    </div>
  );
}
