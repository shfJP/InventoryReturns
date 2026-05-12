"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import { exportRowsToCsv } from "@/lib/csv-export";
import { formatPersonName } from "@/lib/display-name";

type DirectReport = {
  employeeId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  assigned: number;
  collected: number;
  outstanding: number;
  totalEverAssigned: number;
};

export default function DirectReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<DirectReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    (async () => {
      try {
        const res = await fetch("/api/reports/direct");
        if (!res.ok) throw new Error("Failed to load");
        setReports(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <div className="text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const totalOutstanding = reports.reduce((sum, r) => sum + r.outstanding, 0);
  const totalCollected = reports.reduce((sum, r) => sum + r.collected, 0);

  function exportReports() {
    exportRowsToCsv("direct-reports.csv", [
      { header: "Name", value: (row) => formatPersonName(row.displayName) },
      { header: "Employee ID", value: (row) => row.employeeId },
      { header: "Email", value: (row) => row.email },
      { header: "Active", value: (row) => row.isActive ? "Yes" : "No" },
      { header: "Assigned", value: (row) => row.totalEverAssigned },
      { header: "Collected", value: (row) => row.collected },
      { header: "Outstanding", value: (row) => row.outstanding },
    ], reports);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">← Dashboard</Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Direct Reports</h1>
          <p className="text-[var(--muted)]">Equipment and collection status for your direct reports.</p>
        </div>
        <button type="button" onClick={exportReports} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
          Export Excel
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Total Reports</p>
          <p className="text-2xl font-bold text-[var(--text)]">{reports.length}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Outstanding Items</p>
          <p className="text-2xl font-bold text-amber-600">{totalOutstanding}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Collected Items</p>
          <p className="text-2xl font-bold text-emerald-600">{totalCollected}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                <th className="table-header">Name</th>
                <th className="table-header">Employee ID</th>
                <th className="table-header">Status</th>
                <th className="table-header">Assigned</th>
                <th className="table-header">Collected</th>
                <th className="table-header">Outstanding</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.employeeId} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                  <td className="table-cell font-medium text-[var(--text)]">
                    {formatPersonName(r.displayName)}
                    {!r.isActive && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="table-cell text-[var(--text-secondary)]">{r.employeeId}</td>
                  <td className="table-cell">
                    {r.totalEverAssigned === 0 && r.collected === 0 && r.outstanding === 0 ? (
                      <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                        No Equipment Assigned
                      </span>
                    ) : !r.isActive && r.outstanding > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        Pending Collection
                      </span>
                    ) : r.isActive ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        Active
                      </span>
                    ) : r.outstanding === 0 ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        ✓ All Collected
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        Inactive — Outstanding
                      </span>
                    )}
                  </td>
                  <td className="table-cell text-[var(--text)]">{r.totalEverAssigned}</td>
                  <td className="table-cell text-emerald-600 font-medium">{r.collected}</td>
                  <td className="table-cell text-amber-600 font-medium">{r.outstanding}</td>
                  <td className="table-cell">
                    <Link
                      href={`/staff/${encodeURIComponent(r.employeeId)}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                    >
                      View & collect
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reports.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">No direct reports found.</p>
        )}
      </div>
    </div>
  );
}
