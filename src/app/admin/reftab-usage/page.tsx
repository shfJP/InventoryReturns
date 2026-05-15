"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import { exportRowsToCsv } from "@/lib/csv-export";
import { formatPersonName } from "@/lib/display-name";

type StaffUsageRow = {
  staffKey: string;
  displayName: string;
  email: string;
  checkedInCount: number;
  percentOfTotal: number;
};

type UsageResponse = {
  rows: StaffUsageRow[];
  totals: {
    staffCount: number;
    totalCheckedIn: number;
    unknownStaffCheckInCount: number;
  };
  source: {
    endpoints: string[];
    fetchedLoans: number;
    checkedInLoans: number;
    missingReturnedByCount: number;
  };
};

export default function ReftabUsagePage() {
  const router = useRouter();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }

    fetch("/api/admin/reftab-usage")
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load usage report");
        setData(payload as UsageResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load usage report"))
      .finally(() => setLoading(false));
  }, [router]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!data || !normalized) return data?.rows ?? [];
    return data.rows.filter((row) =>
      [row.displayName, row.email].some((value) => value.toLowerCase().includes(normalized))
    );
  }, [data, query]);

  function exportReport() {
    exportRowsToCsv("reftab-check-ins-by-staff.csv", [
      { header: "Staff", value: (row) => formatPersonName(row.displayName) },
      { header: "Email", value: (row) => row.email },
      { header: "Checked-In Items", value: (row) => row.checkedInCount },
      { header: "Percent of Total", value: (row) => `${row.percentOfTotal}%` },
    ], filteredRows);
  }

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">&larr; Dashboard</Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Reftab Usage</h1>
          <p className="text-[var(--muted)]">Reftab returned equipment by the staff user who checked the item in.</p>
        </div>
        <div className="flex w-full max-w-xl flex-wrap gap-2 sm:flex-nowrap">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search staff"
            className="input-search"
          />
          <button
            type="button"
            onClick={exportReport}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Export Excel
          </button>
        </div>
      </div>

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryPill label="Reftab Checked-In Items" value={data.totals.totalCheckedIn} />
            <SummaryPill label="Staff Who Checked In" value={data.totals.staffCount} />
            <SummaryPill label="Returned Loan Rows" value={data.source.checkedInLoans} />
            <SummaryPill label="Unknown Staff Items" value={data.totals.unknownStaffCheckInCount} />
          </div>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
            <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Checked-In Items by Staff</h2>
                <span className="text-sm text-[var(--muted)]">{filteredRows.length} shown</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th className="table-header">Staff</th>
                    <th className="table-header">Checked-In Items</th>
                    <th className="table-header">Percent of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.staffKey} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                      <td className="table-cell">
                        <div className="font-medium text-[var(--text)]">{formatPersonName(row.displayName)}</div>
                        <div className="text-xs text-[var(--muted)]">{row.email || "No returned-by email in Reftab"}</div>
                      </td>
                      <td className="table-cell text-[var(--text)]">{row.checkedInCount}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(row.percentOfTotal, 100)}%` }} />
                          </div>
                          <span className="font-semibold text-[var(--text)]">{row.percentOfTotal}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredRows.length === 0 && (
              <p className="py-12 text-center text-[var(--muted)]">No checked-in item data found.</p>
            )}
          </section>
          <p className="text-xs text-[var(--muted)]">
            Source: Reftab loan history from {data.source.endpoints.join(", ")}. Fetched {data.source.fetchedLoans.toLocaleString()} loan row(s).
          </p>
        </>
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
