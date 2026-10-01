"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  PORTAL_MODULES,
  portalModuleForPath,
  type PortalModule,
} from "@/lib/portal-modules";

const equipmentNav = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/collection", label: "Collection log", icon: CollectionIcon },
];

const equipmentReportNav = [
  { href: "/reports/direct", label: "Direct Reports" },
  { href: "/reports/cascade", label: "Cascade Reports" },
  { href: "/reports/collection-by-period", label: "By Period" },
  { href: "/reports/it-collections", label: "IT Collections" },
  { href: "/reports/unresolved-collections", label: "Unresolved" },
];

type SyncState = "unknown" | "good" | "syncing" | "error";
type SyncSource = "entra" | "reftab" | "ninjaone";

export default function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeModule = portalModuleForPath(pathname);
  const isPublic = pathname === "/login";
  const [isAdmin, setIsAdmin] = useState(false);
  const [modules, setModules] = useState<PortalModule[]>(["equipment", "account-remediation"]);
  const [syncStates, setSyncStates] = useState<Record<SyncSource, SyncState>>({
    entra: "unknown",
    reftab: "unknown",
    ninjaone: "unknown",
  });

  useEffect(() => {
    if (isPublic) {
      setIsAdmin(false);
      return;
    }

    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setIsAdmin(Boolean(data?.isAdmin));
        setModules(Array.isArray(data?.modules) ? data.modules : ["equipment", "account-remediation"]);
      })
      .catch(() => setIsAdmin(false));
  }, [isPublic]);

  useEffect(() => {
    if (!isAdmin) return;

    fetch("/api/admin/sync-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setSyncStates({
          entra: statusToSyncState(data.entra?.state, data.directorySyncedAt ?? data.entraSyncedAt),
          reftab: statusToSyncState(data.reftab?.state, data.reftabSyncedAt),
          ninjaone: statusToSyncState(data.ninjaone?.state, data.ninjaOneSyncedAt),
        });
      })
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !Object.values(syncStates).includes("syncing")) return;

    const interval = window.setInterval(() => {
      fetch("/api/admin/sync-status")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          const nextStates = {
            entra: statusToSyncState(data.entra?.state, data.directorySyncedAt ?? data.entraSyncedAt),
            reftab: statusToSyncState(data.reftab?.state, data.reftabSyncedAt),
            ninjaone: statusToSyncState(data.ninjaone?.state, data.ninjaOneSyncedAt),
          };
          const finished =
            (syncStates.entra === "syncing" && nextStates.entra !== "syncing") ||
            (syncStates.reftab === "syncing" && nextStates.reftab !== "syncing") ||
            (syncStates.ninjaone === "syncing" && nextStates.ninjaone !== "syncing");
          setSyncStates(nextStates);
          if (finished) {
            router.refresh();
            window.location.reload();
          }
        })
        .catch(() => {});
    }, 5_000);

    return () => window.clearInterval(interval);
  }, [isAdmin, router, syncStates]);

  return (
    <>
    {mobileOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />}
    <aside
      className={`fixed left-0 top-0 z-40 flex h-full w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--sidebar-bg)] transition-transform md:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="relative flex h-16 items-center gap-2 border-b border-[var(--border)] px-4 transition hover:bg-gray-100 focus-within:ring-2 focus-within:ring-inset focus-within:ring-[var(--accent)]">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-purple-600 text-white">
          <BoxIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <span className="block truncate font-semibold text-[var(--text)]">{activeModule.shortTitle}</span>
          <span className="block truncate text-xs text-[var(--muted)]">{activeModule.subtitle}</span>
        </div>
        <ChevronDownIcon className="pointer-events-none absolute right-4 h-4 w-4 text-[var(--muted)]" />
        <select
          aria-label="Select app"
          value={activeModule.id}
          onChange={(event) => {
            const destination = PORTAL_MODULES.find((module) => module.id === event.target.value);
            if (destination) {
              router.push(destination.href);
              onClose?.();
            }
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          {PORTAL_MODULES.filter((module) => modules.includes(module.id) || module.id === activeModule.id).map((module) => (
            <option key={module.id} value={module.id}>{module.title}</option>
          ))}
        </select>
      </div>
      {!isPublic && (
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {activeModule.id === "equipment" && (
            <>
              {equipmentNav.map(({ href, label, icon: Icon }) => (
                <SidebarLink
                  key={href}
                  href={href}
                  label={label}
                  active={pathname === href}
                  onClose={onClose}
                  icon={<Icon className="h-5 w-5 shrink-0" />}
                  roomy
                />
              ))}

              <div className="mb-1 mt-4 px-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Reports</p>
              </div>
              {equipmentReportNav.map(({ href, label }) => (
                <AdminLink key={href} href={href} label={label} active={pathname === href} onClose={onClose} />
              ))}

              {isAdmin && (
                <>
                  <div className="mb-1 mt-4 px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Equipment admin</p>
                  </div>
                  <SyncButton
                    label="Sync Directory"
                    endpoint="/api/admin/sync-entra"
                    state={syncStates.entra}
                    onStateChange={(state) => setSyncStates((prev) => ({ ...prev, entra: state }))}
                    onComplete={() => {
                      router.refresh();
                      window.location.reload();
                    }}
                  />
                  <SyncButton
                    label="Sync Reftab"
                    endpoint="/api/admin/sync-reftab"
                    state={syncStates.reftab}
                    onStateChange={(state) => setSyncStates((prev) => ({ ...prev, reftab: state }))}
                    onComplete={() => {
                      router.refresh();
                      window.location.reload();
                    }}
                  />
                  <SyncButton
                    label="Sync NinjaOne"
                    endpoint="/api/admin/sync-ninjaone"
                    state={syncStates.ninjaone}
                    onStateChange={(state) => setSyncStates((prev) => ({ ...prev, ninjaone: state }))}
                    onComplete={() => {
                      router.refresh();
                      window.location.reload();
                    }}
                  />
                  <AdminLink href="/admin/asset-values" label="Asset Values" active={pathname === "/admin/asset-values"} onClose={onClose} />
                  <AdminLink href="/admin/asset-valuations" label="Asset Valuations" active={pathname === "/admin/asset-valuations"} onClose={onClose} />
                  <AdminLink href="/admin/directory" label="Directory" active={pathname === "/admin/directory"} onClose={onClose} />
                  <AdminLink href="/admin/reftab-usage" label="Reftab Usage" active={pathname === "/admin/reftab-usage"} onClose={onClose} />
                  <AdminLink href="/admin/return-workflow" label="Return Workflow" active={pathname === "/admin/return-workflow"} onClose={onClose} />
                  <AdminLink href="/admin/rollout" label="Rollout Readiness" active={pathname === "/admin/rollout"} onClose={onClose} />
                </>
              )}
            </>
          )}

          {activeModule.id === "reconciliation" && (
            <>
              <SidebarLink
                href="/admin/owner-reconciliation"
                label="Ownership Review"
                active={pathname === "/admin/owner-reconciliation"}
                onClose={onClose}
                icon={<ReconcileIcon className="h-5 w-5 shrink-0" />}
                roomy
              />
              <SidebarLink
                href="/corrections"
                label="Correction Requests"
                active={pathname === "/corrections"}
                onClose={onClose}
                icon={<CollectionIcon className="h-5 w-5 shrink-0" />}
                roomy
              />
              {isAdmin && (
                <>
                  <div className="mb-1 mt-4 px-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">Data sources</p>
                  </div>
                  <SyncButton
                    label="Sync Reftab"
                    endpoint="/api/admin/sync-reftab"
                    state={syncStates.reftab}
                    onStateChange={(state) => setSyncStates((prev) => ({ ...prev, reftab: state }))}
                    onComplete={() => {
                      router.refresh();
                      window.location.reload();
                    }}
                  />
                  <SyncButton
                    label="Sync NinjaOne"
                    endpoint="/api/admin/sync-ninjaone"
                    state={syncStates.ninjaone}
                    onStateChange={(state) => setSyncStates((prev) => ({ ...prev, ninjaone: state }))}
                    onComplete={() => {
                      router.refresh();
                      window.location.reload();
                    }}
                  />
                </>
              )}
            </>
          )}

          {activeModule.id === "organization-analytics" && (
            <SidebarLink
              href="/reports/organization"
              label="Organization Analytics"
              active={pathname === "/reports/organization"}
              onClose={onClose}
              icon={<ReportIcon className="h-5 w-5 shrink-0" />}
              roomy
            />
          )}

          {activeModule.id === "account-remediation" && (
            <SidebarLink
              href="/modules/account-remediation"
              label="Account Remediation"
              active={pathname === "/modules/account-remediation"}
              onClose={onClose}
              icon={<AccountIcon className="h-5 w-5 shrink-0" />}
              roomy
            />
          )}
        </nav>
      )}
    </aside>
    </>
  );
}

function SidebarLink({
  href,
  label,
  active,
  onClose,
  icon,
  roomy = false,
}: {
  href: string;
  label: string;
  active: boolean;
  onClose?: () => void;
  icon: React.ReactNode;
  roomy?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={`flex items-center gap-3 rounded-lg px-3 ${roomy ? "py-2.5" : "py-2"} text-sm font-medium transition ${
        active
          ? "bg-[var(--accent)] text-white"
          : "text-[var(--text-secondary)] hover:bg-gray-200 hover:text-[var(--text)]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function AdminLink({ href, label, active, onClose }: { href: string; label: string; active: boolean; onClose?: () => void }) {
  return (
    <SidebarLink
      href={href}
      label={label}
      active={active}
      onClose={onClose}
      icon={<ReportIcon className="h-4 w-4 shrink-0" />}
    />
  );
}

function statusToSyncState(state: string | undefined, fallbackSyncedAt: string | null | undefined): SyncState {
  if (state === "running") return "syncing";
  if (state === "error") return "error";
  if (state === "success") return "good";
  return fallbackSyncedAt ? "good" : "unknown";
}

function SyncButton({
  label,
  endpoint,
  state,
  onStateChange,
  onComplete,
}: {
  label: string;
  endpoint: string;
  state: SyncState;
  onStateChange: (state: SyncState) => void;
  onComplete: () => void;
}) {
  const iconClassName = {
    unknown: "text-[var(--muted)]",
    good: "text-emerald-600",
    syncing: "text-amber-500",
    error: "text-red-600",
  }[state];

  const handleSync = async () => {
    onStateChange("syncing");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        onStateChange("good");
        alert(`${label} completed: ${JSON.stringify(data)}`);
        onComplete();
      } else {
        onStateChange("error");
        alert(`${label} failed: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      onStateChange("error");
      alert(`${label} failed: Network error`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleSync}
      disabled={state === "syncing"}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-gray-200 hover:text-[var(--text)] transition"
      title={state === "syncing" ? `${label} is running` : state === "good" ? `${label} last completed successfully` : state === "error" ? `${label} last failed` : `${label} has not synced yet`}
    >
      <SyncIcon className={`h-4 w-4 shrink-0 ${iconClassName} ${state === "syncing" ? "animate-spin" : ""}`} />
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

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ReconcileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10m0 0l-3-3m3 3l-3 3M17 17H7m0 0l3 3m-3-3l3-3" />
    </svg>
  );
}

function AccountIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM5 21a7 7 0 0114 0" />
    </svg>
  );
}
