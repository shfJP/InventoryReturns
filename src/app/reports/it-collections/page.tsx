"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import { exportRowsToCsv } from "@/lib/csv-export";
import { formatPersonName } from "@/lib/display-name";

type ManagerRank = {
  managerName: string;
  managerId: string;
  totalUnderReports: number;
  collectedByManager: number;
  collectedByIT: number;
};

type ITData = {
  totalByIT: number;
  totalByManager: number;
  total: number;
  managerRanking: ManagerRank[];
};

export default function ITCollectionsPage() {
  const router = useRouter();
  const [data, setData] = useState<ITData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      const res = await fetch(`/api/reports/it-collections?${params}`);
      if (!res.ok) throw new Error("Failed to load");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    fetchData();
  }, [router, fetchData]);

  if (loading && !data) return <div className="text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const itPercent = data && data.total > 0 ? Math.round((data.totalByIT / data.total) * 100) : 0;
  function exportManagers() {
    if (!data) return;
    exportRowsToCsv("it-collections-manager-ranking.csv", [
      { header: "Manager", value: (row) => formatPersonName(row.managerName) },
      { header: "Manager ID", value: (row) => row.managerId },
      { header: "Total Items", value: (row) => row.totalUnderReports },
      { header: "Collected by Manager", value: (row) => row.collectedByManager },
      { header: "Collected by IT", value: (row) => row.collectedByIT },
      { header: "IT Rate", value: (row) => row.totalUnderReports > 0 ? `${Math.round((row.collectedByIT / row.totalUnderReports) * 100)}%` : "0%" },
    ], data.managerRanking);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">← Dashboard</Link>
      </div>

      <h1 className="text-2xl font-bold text-[var(--text)]">IT Collections — Manager Accountability</h1>
      <p className="text-[var(--muted)]">Items IT had to collect directly because the manager did not.</p>

      {/* Date filter */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => { setStartDate(""); setEndDate(""); }}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-100"
        >
          Clear Dates
        </button>
      </div>

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <p className="text-sm text-[var(--muted)]">Total Collections</p>
              <p className="text-2xl font-bold text-[var(--text)]">{data.total}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <p className="text-sm text-[var(--muted)]">By Managers</p>
              <p className="text-2xl font-bold text-emerald-600">{data.totalByManager}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <p className="text-sm text-[var(--muted)]">By IT</p>
              <p className="text-2xl font-bold text-blue-600">{data.totalByIT}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <p className="text-sm text-[var(--muted)]">IT Collection Rate</p>
              <p className={`text-2xl font-bold ${itPercent > 50 ? "text-red-600" : itPercent > 25 ? "text-amber-600" : "text-emerald-600"}`}>
                {itPercent}%
              </p>
            </div>
          </div>

          {/* Stacked bar */}
          {data.total > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-[var(--text)]">Collection Breakdown</h2>
              <div className="flex h-8 overflow-hidden rounded-full">
                <div
                  className="bg-emerald-500 transition-all"
                  style={{ width: `${((data.totalByManager / data.total) * 100).toFixed(1)}%` }}
                  title={`Manager: ${data.totalByManager}`}
                />
                <div
                  className="bg-blue-500 transition-all"
                  style={{ width: `${((data.totalByIT / data.total) * 100).toFixed(1)}%` }}
                  title={`IT: ${data.totalByIT}`}
                />
              </div>
              <div className="mt-2 flex gap-4 text-sm">
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-emerald-500" /> Manager ({data.totalByManager})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-blue-500" /> IT ({data.totalByIT})
                </span>
              </div>
            </div>
          )}

          {/* Manager ranking table */}
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
            <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[var(--text)]">Manager Ranking</h2>
                <button type="button" onClick={exportManagers} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Export Excel</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr>
                    <th className="table-header">Manager</th>
                    <th className="table-header">Total Items</th>
                    <th className="table-header">Collected by Manager</th>
                    <th className="table-header">Collected by IT</th>
                    <th className="table-header">IT Rate</th>
                    <th className="table-header">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.managerRanking.map((m) => {
                    const rate = m.totalUnderReports > 0
                      ? Math.round((m.collectedByIT / m.totalUnderReports) * 100)
                      : 0;
                    const isRepeatOffender = rate > 50 && m.collectedByIT >= 3;
                    return (
                      <tr key={m.managerId} className={`border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50 ${isRepeatOffender ? "bg-red-50/50" : ""}`}>
                        <td className="table-cell font-medium text-[var(--text)]">
                          {formatPersonName(m.managerName)}
                          {isRepeatOffender && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
                              </svg>
                              Repeat Offender
                            </span>
                          )}
                        </td>
                        <td className="table-cell text-[var(--text)]">{m.totalUnderReports}</td>
                        <td className="table-cell text-emerald-600 font-medium">{m.collectedByManager}</td>
                        <td className="table-cell text-blue-600 font-medium">{m.collectedByIT}</td>
                        <td className="table-cell">
                          <span className={`font-medium ${rate > 50 ? "text-red-600" : rate > 25 ? "text-amber-600" : "text-emerald-600"}`}>
                            {rate}%
                          </span>
                        </td>
                        <td className="table-cell">
                          {isRepeatOffender ? (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                              Needs Attention
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              Good
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.managerRanking.length === 0 && (
              <p className="py-12 text-center text-[var(--muted)]">No collection data available.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
