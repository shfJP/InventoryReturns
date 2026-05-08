"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import { exportRowsToCsv } from "@/lib/csv-export";

type CategoryValue = {
  category: string;
  estimatedValueCents: number;
};

type LossSummary = {
  knownActive: { count: number; estimatedValueCents: number };
  unknown: { count: number; estimatedValueCents: number };
  total: { count: number; estimatedValueCents: number };
};

type ApiResponse = {
  categories: CategoryValue[];
  summary: LossSummary;
};

function dollarsFromCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function centsFromInput(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function inputFromCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export default function AssetValuesPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<CategoryValue[]>([]);
  const [summary, setSummary] = useState<LossSummary | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }

    fetch("/api/admin/asset-values")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load asset values");
        return data as ApiResponse;
      })
      .then((data) => {
        setCategories(data.categories);
        setSummary(data.summary);
        setDraftValues(Object.fromEntries(data.categories.map((item) => [item.category, inputFromCents(item.estimatedValueCents)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load asset values"))
      .finally(() => setLoading(false));
  }, [router]);

  const totalConfiguredValue = useMemo(
    () => categories.reduce((sum, item) => sum + item.estimatedValueCents, 0),
    [categories]
  );

  async function saveValues() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const values = categories.map((item) => ({
        category: item.category,
        estimatedValueCents: centsFromInput(draftValues[item.category] ?? "0"),
      }));
      const res = await fetch("/api/admin/asset-values", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save asset values");
      setCategories(data.categories);
      setSummary(data.summary);
      setDraftValues(Object.fromEntries(data.categories.map((item: CategoryValue) => [item.category, inputFromCents(item.estimatedValueCents)])));
      setMessage("Asset values saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save asset values");
    } finally {
      setSaving(false);
    }
  }

  function exportValues() {
    exportRowsToCsv("asset-category-values.csv", [
      { header: "Category", value: (item) => item.category },
      { header: "Estimated Value", value: (item) => inputFromCents(centsFromInput(draftValues[item.category] ?? "0")) },
    ], categories);
  }

  if (loading) return <div className="text-[var(--muted)]">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">&larr; Dashboard</Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Asset Values</h1>
          <p className="text-[var(--muted)]">Estimated replacement cost by category for unresolved collection loss reporting.</p>
        </div>
        <button
          type="button"
          onClick={saveValues}
          disabled={saving}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {saving ? "Saving" : "Save values"}
        </button>
        <button
          type="button"
          onClick={exportValues}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-100"
        >
          Export Excel
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{message}</div>}

      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryCard
            label="Known Active Management"
            count={summary.knownActive.count}
            value={summary.knownActive.estimatedValueCents}
            tone="purple"
          />
          <SummaryCard
            label="Legacy - Unknown Manager"
            count={summary.unknown.count}
            value={summary.unknown.estimatedValueCents}
            tone="amber"
          />
          <SummaryCard
            label="Total Estimated Loss"
            count={summary.total.count}
            value={summary.total.estimatedValueCents}
            tone="red"
          />
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Category estimates</h2>
            <span className="text-sm text-[var(--muted)]">{categories.length} categories, {dollarsFromCents(totalConfiguredValue)} configured total</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr>
                <th className="table-header">Category</th>
                <th className="table-header">Estimated Value</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((item) => (
                <tr key={item.category} className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
                  <td className="table-cell font-medium text-[var(--text)]">{item.category}</td>
                  <td className="table-cell">
                    <div className="flex max-w-xs items-center gap-2">
                      <span className="text-[var(--muted)]">$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draftValues[item.category] ?? "0.00"}
                        onChange={(event) => setDraftValues((prev) => ({ ...prev, [item.category]: event.target.value }))}
                        className="w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {categories.length === 0 && (
          <p className="py-12 text-center text-[var(--muted)]">No categories found. Run Reftab sync first.</p>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  value,
  tone,
}: {
  label: string;
  count: number;
  value: number;
  tone: "purple" | "amber" | "red";
}) {
  const color = {
    purple: "text-purple-700",
    amber: "text-amber-700",
    red: "text-red-700",
  }[tone];
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{dollarsFromCents(value)}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{count} unresolved item(s)</p>
    </div>
  );
}
