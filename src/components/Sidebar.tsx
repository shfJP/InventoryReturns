"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const mainNav = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/collection", label: "Collection log", icon: CollectionIcon },
];

const reportNav = [
  { href: "/reports/direct", label: "Direct Reports" },
  { href: "/reports/cascade", label: "Cascade Reports" },
  { href: "/reports/collection-by-period", label: "By Period" },
  { href: "/reports/it-collections", label: "IT Collections" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const isPublic = pathname === "/login" || pathname === "/choose-view";
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (isPublic) {
      setIsAdmin(false);
      return;
    }

    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setIsAdmin(Boolean(data?.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [isPublic]);

  return (
    <aside
      className="fixed left-0 top-0 z-30 flex h-full w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)]"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="flex h-16 items-center gap-2 border-b border-[var(--border)] px-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-purple-600 text-white">
          <BoxIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <span className="block truncate font-semibold text-[var(--text)]">Equipment</span>
          <span className="block truncate text-xs text-[var(--muted)]">Collection Portal</span>
        </div>
      </div>
      {!isPublic && (
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {mainNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-gray-200 hover:text-[var(--text)]"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}

          {/* Reports section */}
          <div className="mt-4 mb-1 px-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Reports</p>
          </div>
          {reportNav.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:bg-gray-200 hover:text-[var(--text)]"
                }`}
              >
                <ReportIcon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </Link>
            );
          })}

          {isAdmin && (
            <>
              <div className="mt-4 mb-1 px-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Admin</p>
              </div>
              <SyncButton label="Sync Entra" endpoint="/api/admin/sync-entra" />
              <SyncButton label="Sync Reftab" endpoint="/api/admin/sync-reftab" />
            </>
          )}

          <Link
            href="/choose-view"
            className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-200 hover:text-[var(--text)]"
          >
            <LayoutIcon className="h-5 w-5 shrink-0" />
            <span>Switch view</span>
          </Link>
        </nav>
      )}
    </aside>
  );
}

function SyncButton({ label, endpoint }: { label: string; endpoint: string }) {
  const handleSync = async () => {
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert(`${label} completed: ${JSON.stringify(data)}`);
      } else {
        alert(`${label} failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      alert(`${label} failed: Network error`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSync}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-200 hover:text-[var(--text)] transition"
    >
      <SyncIcon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

function BoxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function CollectionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function LayoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  );
}

function ReportIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function SyncIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
