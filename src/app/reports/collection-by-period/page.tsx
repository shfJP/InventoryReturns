"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";

type PeriodData = {
  total: number;
  byModel: Record<string, number>;
  byDate: Record<string, number>;
  events: {
    id: string;
    assetTag: string;
    serial: string | null;
    assignedToEmployeeId: string;
    markedByManager: string;
    markedCollectedAt: string;
    notes: string | null;
    status: string;
    collectedByRole: string;
  }[];
};

function getPresetDates(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().split("T")[0];
  let startDate: Date;

  switch (preset) {
    case "week":
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    case "month":
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    case "quarter":
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 3);
      break;
    case "30days":
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 30);
      break;
    default:
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
  }
  return { start: startDate.toISOString().split("T")[0], end };
}

export default function CollectionByPeriodPage() {
  const router = useRouter();
  const [data, setData] = useState<PeriodData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => getPresetDates("month").start);
  const [endDate, setEndDate] = useState(() => getPresetDates("month").end);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      const res = await fetch(`/api/reports/collection-by-period?${params}`);
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

  function applyPreset(preset: string) {
    const { start, end } = getPresetDates(preset);
    setStartDate(start);
    setEndDate(end);
  }

  function exportCSV() {
    if (!data) return;
    const headers = ["Asset Tag", "Serial", "Assigned To", "Marked By", "Date", "Status", "Collected By", "Notes"];
    const rows = data.events.map((e) => [
      e.assetTag,
      e.serial ?? "",
      e.assignedToEmployeeId,
      e.markedByManager,
      new Date(e.markedCollectedAt).toLocaleString(),
      e.status,
      e.collectedByRole,
      e.notes ?? "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collection-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !data) return <div className="text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const maxBarValue = data ? Math.max(...Object.values(data.byDate), 1) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">← Dashboard</Link>
      </div>

      <h1 className="text-2xl font-bold text-[var(--text)]">Collection by Period</h1>
      <p className="text-[var(--muted)]">Equipment collected within a specified time period.</p>

      {/* Date controls */}
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
        <div className="flex gap-2">
          {[
            { key: "week", label: "This Week" },
            { key: "month", label: "This Month" },
            { key: "quarter", label: "This Quarter" },
            { key: "30days", label: "Last 30 Days" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-100"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={exportCSV}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
        >
          Export Excel
        </button>
      </div>

      {data && (
        <>
          {/* Summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <p className="text-sm text-[var(--muted)]">Total Collected</p>
              <p className="text-2xl font-bold text-[var(--text)]">{data.total}</p>
            </div>
            {Object.entries(data.byModel).slice(0, 3).map(([model, count]) => (
              <div key={model} className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
                <p className="text-sm text-[var(--muted)]">{model}</p>
                <p className="text-2xl font-bold text-[var(--text)]">{count}</p>
              </div>
            ))}
          </div>

          {/* Bar chart */}
          {Object.keys(data.byDate).length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-[var(--text)]">Collection Volume Over Time</h2>
              <div className="flex items-end gap-1" style={{ height: "200px" }}>
                {Object.entries(data.byDate)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, count]) => (
                    <div
                      key={date}
                      className="group relative flex-1 min-w-[8px] rounded-t bg-gradient-to-t from-[var(--accent)] to-purple-400 transition-all hover:opacity-80"
                      style={{ height: `${(count / maxBarValue) * 100}%`, minHeight: "4px" }}
                    >
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden rounded bg-gray-800 px-2 py-1 text-xs text-white group-hover:block whitespace-nowrap">
                        {date}: {count} item{count !== 1 ? "s" : ""}
                      </div>
                    </div>
                  ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-[var(--muted)]">
                <span>{Object.keys(data.byDate).sort()[0]}</span>
                <span>{Object.keys(data.byDate).sort().slice(-1)[0]}</span>
              </div>
            </div>
          )}

          {/* Event list */}
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
            <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
              <h2 className="text-lg font-semibold text-[var(--text)]">Collection Events ({data.events.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr>
                    <th className="table-header">Asset</th>
                    <th className="table-header">Assigned To</th>
                    <th className="table-header">Marked By</th>
                    <th className="table-header">When</th>
                    <th className="table-header">By</th>
                    <th className="table-header">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id} className="border-b border-[var(--border)] hover:bg-[var(--table-header-bg)]/50">
                      <td className="table-cell font-medium text-[var(--text)]">{e.assetTag} {e.serial ? `(${e.serial})` : ""}</td>
                      <td className="table-cell text-[var(--text-secondary)]">{e.assignedToEmployeeId}</td>
                      <td className="table-cell text-[var(--text)]">{e.markedByManager}</td>
                      <td className="table-cell text-[var(--muted)]">{new Date(e.markedCollectedAt).toLocaleString()}</td>
                      <td className="table-cell">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${e.collectedByRole === "it" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-700"}`}>
                          {e.collectedByRole === "it" ? "IT" : "Manager"}
                        </span>
                      </td>
                      <td className="table-cell text-[var(--muted)]">{e.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.events.length === 0 && (
              <p className="py-12 text-center text-[var(--muted)]">No collection events in this period.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
