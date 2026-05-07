"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";

type TreeNode = {
  employeeId: string;
  displayName: string;
  email: string;
  isActive: boolean;
  depth: number;
  assigned: number;
  collected: number;
  outstanding: number;
  children: TreeNode[];
};

function TreeRow({ node, expanded, toggle }: { node: TreeNode; expanded: Set<string>; toggle: (id: string) => void }) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.employeeId);
  const indent = (node.depth - 1) * 24;

  return (
    <>
      <tr className="border-b border-[var(--border)] transition hover:bg-[var(--table-header-bg)]/50">
        <td className="table-cell" style={{ paddingLeft: `${16 + indent}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren && (
              <button
                type="button"
                onClick={() => toggle(node.employeeId)}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--muted)] hover:bg-gray-200"
              >
                <svg
                  className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            {!hasChildren && <span className="w-5" />}
            <span className="font-medium text-[var(--text)]">{node.displayName}</span>
            {!node.isActive && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                Inactive
              </span>
            )}
            {hasChildren && (
              <span className="inline-flex items-center rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]">
                Manager
              </span>
            )}
          </div>
        </td>
        <td className="table-cell text-[var(--text-secondary)]">{node.employeeId}</td>
        <td className="table-cell text-[var(--text)]">{node.assigned + node.collected}</td>
        <td className="table-cell text-emerald-600 font-medium">{node.collected}</td>
        <td className="table-cell text-amber-600 font-medium">{node.outstanding}</td>
        <td className="table-cell">
          <Link
            href={`/staff/${encodeURIComponent(node.employeeId)}`}
            className="text-[var(--accent)] hover:underline text-sm"
          >
            View
          </Link>
        </td>
      </tr>
      {isExpanded &&
        node.children.map((child) => (
          <TreeRow key={child.employeeId} node={child} expanded={expanded} toggle={toggle} />
        ))}
    </>
  );
}

function countAll(nodes: TreeNode[]): { assigned: number; collected: number; outstanding: number } {
  let assigned = 0, collected = 0, outstanding = 0;
  for (const n of nodes) {
    assigned += n.assigned + n.collected;
    collected += n.collected;
    outstanding += n.outstanding;
    const sub = countAll(n.children);
    assigned += sub.assigned;
    collected += sub.collected;
    outstanding += sub.outstanding;
  }
  return { assigned, collected, outstanding };
}

export default function CascadeReportsPage() {
  const router = useRouter();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [maxDepth, setMaxDepth] = useState(0); // 0 = unlimited

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/login"); return; }
    (async () => {
      try {
        const url = maxDepth > 0 ? `/api/reports/cascade?depth=${maxDepth}` : "/api/reports/cascade";
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load");
        setTree(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, maxDepth]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const allIds = new Set<string>();
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.children.length > 0) allIds.add(n.employeeId);
        walk(n.children);
      }
    }
    walk(tree);
    setExpanded(allIds);
  }

  if (loading) return <div className="text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const totals = countAll(tree);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--accent)]">← Dashboard</Link>
      </div>

      <h1 className="text-2xl font-bold text-[var(--text)]">Cascade Reports</h1>
      <p className="text-[var(--muted)]">Full hierarchy beneath you — direct reports, their reports, and so on.</p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[var(--text-secondary)]">Depth:</label>
        {[0, 1, 2, 3].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => { setMaxDepth(d); setLoading(true); }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${maxDepth === d ? "bg-[var(--accent)] text-white" : "bg-gray-100 text-[var(--text)] hover:bg-gray-200"}`}
          >
            {d === 0 ? "All" : `${d} level${d > 1 ? "s" : ""}`}
          </button>
        ))}
        <button
          type="button"
          onClick={expandAll}
          className="ml-4 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-100"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={() => setExpanded(new Set())}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-100"
        >
          Collapse all
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Total Assigned</p>
          <p className="text-2xl font-bold text-[var(--text)]">{totals.assigned}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Outstanding</p>
          <p className="text-2xl font-bold text-amber-600">{totals.outstanding}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
          <p className="text-sm text-[var(--muted)]">Collected</p>
          <p className="text-2xl font-bold text-emerald-600">{totals.collected}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                <th className="table-header">Name</th>
                <th className="table-header">Employee ID</th>
                <th className="table-header">Assigned</th>
                <th className="table-header">Collected</th>
                <th className="table-header">Outstanding</th>
                <th className="table-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tree.map((node) => (
                <TreeRow key={node.employeeId} node={node} expanded={expanded} toggle={toggle} />
              ))}
            </tbody>
          </table>
        </div>
        {tree.length === 0 && (
          <div className="px-4 py-12 text-center text-[var(--muted)]">
            <p>No reports in hierarchy.</p>
            <p className="mt-2 text-xs">
              Staff appear here only after Entra sync links users to your manager relationship. Equipment/Reftab sync is not required.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
