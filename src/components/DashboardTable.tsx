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

const STAFF_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "has_equipment", label: "Has equipment" },
  { value: "no_equipment", label: "No equipment" },
  { value: "outstanding_only", label: "Outstanding only" },
  { value: "collected_only", label: "Collected only" },
];

export default function DashboardTable({ data, initialSearchQuery = "" }: { data: DashboardData; initialSearchQuery?: string }) {
  const { me, staff, equipmentByEmployee } = data;
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [filterBy, setFilterBy] = useState("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (initialSearchQuery) setSearchQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  const filteredStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = staff;
    if (q) {
      list = list.filter(
        (s) =>
          formatPersonName(s.displayName).toLowerCase().includes(q) ||
          s.employeeId.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q)
      );
    }
    if (filterBy === "has_equipment") {
      list = list.filter((s) => (equipmentByEmployee[s.employeeId]?.length ?? 0) > 0);
    } else if (filterBy === "no_equipment") {
      list = list.filter((s) => (equipmentByEmployee[s.employeeId]?.length ?? 0) === 0);
    } else if (filterBy === "outstanding_only") {
      list = list.filter((s) => {
        const items = equipmentByEmployee[s.employeeId] ?? [];
        return items.some((e) => e.collectionStatus === "outstanding");
      });
    } else if (filterBy === "collected_only") {
      list = list.filter((s) => {
        const items = equipmentByEmployee[s.employeeId] ?? [];
        return items.length > 0 && items.every((e) => e.collectionStatus === "collected");
      });
    }
    return list;
  }, [staff, searchQuery, filterBy, equipmentByEmployee]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / pageSize));
  const paginatedStaff = useMemo(
    () => filteredStaff.slice((page - 1) * pageSize, page * pageSize),
    [filteredStaff, page, pageSize]
  );

  const handleFilterChange = (value: string) => {
    setFilterBy(value);
    setPage(1);
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };
  const exportStaff = () => {
    exportRowsToCsv("dashboard-reports.csv", [
      { header: "Name", value: (s) => formatPersonName(s.displayName) },
      { header: "Employee ID", value: (s) => s.employeeId },
      { header: "Email", value: (s) => s.email },
      { header: "Active", value: (s) => s.isActive === false ? "No" : "Yes" },
      { header: "Outstanding", value: (s) => (equipmentByEmployee[s.employeeId] ?? []).filter((e) => e.collectionStatus === "outstanding").length },
      { header: "Collected", value: (s) => (equipmentByEmployee[s.employeeId] ?? []).filter((e) => e.collectionStatus === "collected").length },
    ], filteredStaff);
  };

  return (
    <div className="space-y-6">
      <ContentHeader
        title="Reports"
        searchPlaceholder="Search reports"
        showFilter={true}
        searchValue={searchQuery}
        onSearchChange={(v) => { setSearchQuery(v); setPage(1); }}
        filterOptions={STAFF_FILTER_OPTIONS}
        selectedFilter={filterBy}
        onFilterChange={handleFilterChange}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageSize={pageSize}
        onPageSizeChange={handlePageSizeChange}
        showSettingsLink={true}
      />
      <div className="flex justify-end">
        <button type="button" onClick={exportStaff} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
          Export Excel
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Signed in as {formatPersonName(me.displayName)} ({me.employeeId}) · Showing {filteredStaff.length} of {staff.length}
      </p>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                <th className="table-header">Name</th>
                <th className="table-header">Employee ID</th>
                <th className="table-header">Contact E-mail</th>
                <th className="table-header">Equipment</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedStaff.map((s) => {
                const items = equipmentByEmployee[s.employeeId] ?? [];
                const outstanding = items.filter((e) => e.collectionStatus === "outstanding").length;
                const collected = items.filter((e) => e.collectionStatus === "collected").length;
                return (
                  <tr
                    key={s.employeeId}
                    className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50"
                  >
                    <td className="table-cell font-medium text-[var(--text)]">
                      {formatPersonName(s.displayName)}
                      {s.isActive === false && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-[var(--text-secondary)]">{s.employeeId}</td>
                    <td className="table-cell text-[var(--text-secondary)]">{s.email}</td>
                    <td className="table-cell text-[var(--muted)]">
                      <div className="flex items-center gap-2">
                        <span>{outstanding} outstanding</span>
                        {collected > 0 && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            {collected} collected
                          </span>
                        )}
                      </div>
                      {s.isActive !== false && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      <Link
                        href={`/staff/${encodeURIComponent(s.employeeId)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                      >
                        View & collect
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredStaff.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">
            {staff.length === 0
              ? "No direct or indirect reports found. Run db:seed to load sample data."
              : "No reports match the current search or filter."}
          </p>
        )}
        {filteredStaff.length > 0 && (
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--text)]">Equipment summary</h2>
        <div className="mt-2 flex gap-6 text-sm">
          <p className="text-[var(--muted)]">
            Total: <strong className="text-[var(--text)]">{data.equipment.length}</strong>
          </p>
          <p className="text-[var(--muted)]">
            Outstanding: <strong className="text-amber-600">{data.equipment.filter((e) => e.collectionStatus === "outstanding").length}</strong>
          </p>
          <p className="text-[var(--muted)]">
            Collected: <strong className="text-emerald-600">{data.equipment.filter((e) => e.collectionStatus === "collected").length}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
