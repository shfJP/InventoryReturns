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
  checkedOutCount: number;
  percentOfCheckIns: number;
  percentOfCheckOuts: number;
  utilizationScore: number;
};

type UsageResponse = {
  rows: StaffUsageRow[];
  totals: {
    staffCount: number;
    totalCheckedIn: number;
    totalCheckedOut: number;
    unknownStaffCheckInCount: number;
    unknownStaffCheckOutCount: number;
  };
  source: {
    endpoints: string[];
    fetchedLoans: number;
    checkedInLoans: number;
    checkedOutLoans: number;
    missingReturnedByCount: number;
    missingCheckedOutByCount: number;
    checkInActorFieldHits: Record<string, number>;
    checkOutActorFieldHits: Record<string, number>;
    sampleReturnedLoanKeys: string[];
    sampleCheckedOutLoanKeys: string[];
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
    exportRowsToCsv("reftab-usage-by-staff.csv", [
      { header: "Staff", value: (row) => formatPersonName(row.displayName) },
      { header: "Email", value: (row) => row.email },
      { header: "Checked-In Items", value: (row) => row.checkedInCount },
      { header: "Checked-In Percent", value: (row) => `${row.percentOfCheckIns}%` },
      { header: "Checked-Out Items", value: (row) => row.checkedOutCount },
      { header: "Checked-Out Percent", value: (row) => `${row.percentOfCheckOuts}%` },
      { header: "Utilization Score", value: (row) => row.utilizationScore },
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
          <p className="text-[var(--muted)]">Reftab loan activity by the staff user who checked items out or back in.</p>
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
            <SummaryPill label="Reftab Checked-Out Items" value={data.totals.totalCheckedOut} />
            <SummaryPill label="Staff With Activity" value={data.totals.staffCount} />
            <SummaryPill label="Unknown Actor Items" value={data.totals.unknownStaffCheckInCount + data.totals.unknownStaffCheckOutCount} />
          </div>

          <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
            <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Reftab Activity by Staff</h2>
                <span className="text-sm text-[var(--muted)]">{filteredRows.length} shown</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th className="table-header">Staff</th>
                    <th className="table-header">Utilization Score</th>
                    <th className="table-header">Checked-In Items</th>
                    <th className="table-header">Checked-In %</th>
                    <th className="table-header">Checked-Out Items</th>
                    <th className="table-header">Checked-Out %</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.staffKey} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                      <td className="table-cell">
                        <div className="font-medium text-[var(--text)]">{formatPersonName(row.displayName)}</div>
                        <div className="text-xs text-[var(--muted)]">{row.email || "No actor email in Reftab"}</div>
                      </td>
                      <td className="table-cell">
                        <span className="rounded bg-[var(--accent)]/10 px-2 py-1 font-semibold text-[var(--accent)]">{row.utilizationScore}</span>
                      </td>
                      <td className="table-cell text-[var(--text)]">{row.checkedInCount}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(row.percentOfCheckIns, 100)}%` }} />
                          </div>
                          <span className="font-semibold text-[var(--text)]">{row.percentOfCheckIns}%</span>
                        </div>
                      </td>
                      <td className="table-cell text-[var(--text)]">{row.checkedOutCount}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full bg-blue-600" style={{ width: `${Math.min(row.percentOfCheckOuts, 100)}%` }} />
                          </div>
                          <span className="font-semibold text-[var(--text)]">{row.percentOfCheckOuts}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredRows.length === 0 && (
              <p className="py-12 text-center text-[var(--muted)]">No Reftab usage data found.</p>
            )}
          </section>
          <p className="text-xs text-[var(--muted)]">
            Source: Reftab loan history from {data.source.endpoints.join(", ")}. Fetched {data.source.fetchedLoans.toLocaleString()} loan row(s), {data.source.checkedOutLoans.toLocaleString()} checkout row(s), and {data.source.checkedInLoans.toLocaleString()} return row(s).
          </p>
          {data.totals.unknownStaffCheckInCount > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold">Returned-by data was missing from some Reftab loan rows.</div>
              <p className="mt-1">
                Check-in actor fields found: {Object.keys(data.source.checkInActorFieldHits).length > 0
                  ? Object.entries(data.source.checkInActorFieldHits).map(([field, count]) => `${field} (${count})`).join(", ")
                  : "none"}.
              </p>
              {data.source.sampleReturnedLoanKeys.length > 0 && (
                <p className="mt-1">
                  Returned loan keys seen: {data.source.sampleReturnedLoanKeys.join(", ")}.
                </p>
              )}
            </section>
          )}
          {data.totals.unknownStaffCheckOutCount > 0 && (
            <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold">Checked-out-by data was missing from some Reftab loan rows.</div>
              <p className="mt-1">
                Check-out actor fields found: {Object.keys(data.source.checkOutActorFieldHits).length > 0
                  ? Object.entries(data.source.checkOutActorFieldHits).map(([field, count]) => `${field} (${count})`).join(", ")
                  : "none"}.
              </p>
              {data.source.sampleCheckedOutLoanKeys.length > 0 && (
                <p className="mt-1">
                  Checkout loan keys seen: {data.source.sampleCheckedOutLoanKeys.join(", ")}.
                </p>
              )}
            </section>
          )}
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
