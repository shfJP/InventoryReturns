"use client";

import { useEffect, useState } from "react";
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
  serial: string | null;
  model: string | null;
  detectedAt: string;
  status: string;
};

export default function UnresolvedCollectionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<UnresolvedCollection[]>([]);
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
      .then((data) => setItems(data))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load unresolved collections"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">&larr; Dashboard</Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">Unresolved Collections</h1>
        <p className="text-[var(--muted)]">Terminated employees with equipment still assigned and not collected.</p>
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

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <th className="table-header">Employee</th>
                <th className="table-header">Manager Responsible</th>
                <th className="table-header">Asset Tag</th>
                <th className="table-header">Serial</th>
                <th className="table-header">Model</th>
                <th className="table-header">Detected</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{item.employeeName}</div>
                    <div className="text-xs text-[var(--muted)]">{item.employeeEmail ?? item.employeeId}</div>
                  </td>
                  <td className="table-cell">
                    <div className="font-medium text-[var(--text)]">{item.managerName ?? "Unknown"}</div>
                    <div className="text-xs text-[var(--muted)]">{item.managerEmail ?? item.managerEmployeeId ?? ""}</div>
                  </td>
                  <td className="table-cell font-medium text-[var(--text)]">{item.assetTag}</td>
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
        {items.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">No unresolved collections.</p>
        )}
      </div>
    </div>
  );
}
