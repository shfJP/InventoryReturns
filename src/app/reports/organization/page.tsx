"use client";

import { useEffect, useState } from "react";
import { exportRowsToCsv } from "@/lib/csv-export";

type ReportRow = {
  organization: string;
  employeeCount: number;
  activeEmployeeCount: number;
  inactiveEmployeeCount: number;
  assetCount: number;
  purchaseValueCents: number;
  replacementValueCents: number;
  bookValueCents: number;
};

type Report = {
  generatedAt: string;
  groupBy: "division" | "department";
  rows: ReportRow[];
  totals: ReportRow;
  filters: { divisions: string[]; departments: string[] };
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default function OrganizationReportPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [groupBy, setGroupBy] = useState<Report["groupBy"]>("division");
  const [division, setDivision] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ groupBy });
    if (division) query.set("division", division);
    if (department) query.set("department", department);
    setError(null);
    fetch(`/api/reports/organization?${query}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load organizational report");
        return data;
      })
      .then(setReport)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Failed to load"));
  }, [groupBy, division, department]);

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>;
  if (!report) return <p className="text-[var(--muted)]">Loading organizational report…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Organizational equipment</h1>
          <p className="text-[var(--muted)]">Executive inventory totals and financial exposure by organization.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => exportRowsToCsv("organization-equipment.csv", [
          { header: groupBy, value: (row) => row.organization },
          { header: "Employees", value: (row) => row.employeeCount },
          { header: "Assets", value: (row) => row.assetCount },
          { header: "Purchase value", value: (row) => row.purchaseValueCents / 100 },
          { header: "Replacement value", value: (row) => row.replacementValueCents / 100 },
          { header: "Book value", value: (row) => row.bookValueCents / 100 },
        ], report.rows)}>Export Excel</button>
      </div>

      <div className="grid gap-3 rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Group by" value={groupBy} options={["division", "department"]} onChange={(value) => setGroupBy(value as Report["groupBy"])} />
        <Select label="Division" value={division} options={report.filters.divisions} onChange={setDivision} all />
        <Select label="Department" value={department} options={report.filters.departments} onChange={setDepartment} all />
      </div>

      {report.filters.divisions.length === 0 && report.filters.departments.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Division and department data is not available in the current directory snapshot. Run a directory sync after configuring the organization columns.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Summary label="Employees" value={report.totals.employeeCount.toLocaleString()} />
        <Summary label="Active employees" value={report.totals.activeEmployeeCount.toLocaleString()} />
        <Summary label="Inactive employees" value={report.totals.inactiveEmployeeCount.toLocaleString()} />
        <Summary label="Assets" value={report.totals.assetCount.toLocaleString()} />
        <Summary label="Replacement value" value={money(report.totals.replacementValueCents)} />
        <Summary label="Book value" value={money(report.totals.bookValueCents)} />
      </div>

      <div className="grid gap-3 lg:hidden">
        {report.rows.map((row) => (
          <article key={row.organization} className="card">
            <h2 className="font-semibold text-[var(--text)]">{row.organization}</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <span>{row.employeeCount} employees</span><span>{row.assetCount} assets</span>
              <span>{row.activeEmployeeCount} active</span><span>{row.inactiveEmployeeCount} inactive</span>
              <span>{money(row.replacementValueCents)} replacement</span><span>{money(row.bookValueCents)} book</span>
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm lg:block">
        <table className="w-full">
          <thead><tr>
            <th className="table-header capitalize">{groupBy}</th>
            <th className="table-header">Employees</th>
            <th className="table-header">Active</th>
            <th className="table-header">Inactive</th>
            <th className="table-header">Assets</th>
            <th className="table-header">Purchase value</th>
            <th className="table-header">Replacement value</th>
            <th className="table-header">Book value</th>
          </tr></thead>
          <tbody>{report.rows.map((row) => <tr key={row.organization}>
            <td className="table-cell font-medium">{row.organization}</td>
            <td className="table-cell">{row.employeeCount}</td>
            <td className="table-cell">{row.activeEmployeeCount}</td>
            <td className="table-cell">{row.inactiveEmployeeCount}</td>
            <td className="table-cell">{row.assetCount}</td>
            <td className="table-cell">{money(row.purchaseValueCents)}</td>
            <td className="table-cell">{money(row.replacementValueCents)}</td>
            <td className="table-cell">{money(row.bookValueCents)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Select({ label, value, options, onChange, all = false }: { label: string; value: string; options: string[]; onChange: (value: string) => void; all?: boolean }) {
  return <label className="text-sm font-medium text-[var(--text)]">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 capitalize">
      {all && <option value="">All</option>}
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="card"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-bold text-[var(--text)]">{value}</p></div>;
}
