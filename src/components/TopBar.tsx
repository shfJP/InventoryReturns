"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut as nextAuthSignOut, useSession } from "next-auth/react";
import { logout } from "@/lib/auth-session";
import { formatPersonName } from "@/lib/display-name";

type SyncSource = "entra" | "reftab" | "ninjaone";
type SyncRunState = "idle" | "running" | "success" | "error";

type SyncRunStatus = {
  source: SyncSource;
  state: SyncRunState;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastResult: unknown | null;
};

type SyncStatusResponse = {
  lastSyncedAt: string | null;
  directorySyncedAt: string | null;
  reftabSyncedAt: string | null;
  entraSyncedAt: string | null;
  ninjaOneSyncedAt: string | null;
  entra?: SyncRunStatus;
  reftab?: SyncRunStatus;
  ninjaone?: SyncRunStatus;
};

const SYNC_SOURCES: Array<{
  source: SyncSource;
  label: string;
  endpoint: string;
}> = [
  { source: "entra", label: "Directory", endpoint: "/api/admin/sync-entra" },
  { source: "reftab", label: "Reftab", endpoint: "/api/admin/sync-reftab" },
  { source: "ninjaone", label: "NinjaOne", endpoint: "/api/admin/sync-ninjaone" },
];

export default function TopBar({ onOpenNavigation }: { onOpenNavigation?: () => void }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [searchValue, setSearchValue] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [syncingSource, setSyncingSource] = useState<SyncSource | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [, setRelativeTimeTick] = useState(0);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<HTMLDivElement>(null);

  const userName = formatPersonName(session?.user?.name) || session?.user?.email || "User";
  const userInitial = userName.trim().charAt(0).toUpperCase() || "U";
  const avatarSrc = ssoEnabled ? "/api/me/avatar" : session?.user?.image ?? null;
  const hasRunningSync = SYNC_SOURCES.some(({ source }) => syncStatus?.[source]?.state === "running");
  const syncTime = formatRelativeTime(syncStatus?.lastSyncedAt);

  const refreshSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/sync-status", { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json() as SyncStatusResponse;
      setSyncStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (helpRef.current && !helpRef.current.contains(target)) setHelpOpen(false);
      if (notifRef.current && !notifRef.current.contains(target)) setNotificationsOpen(false);
      if (syncRef.current && !syncRef.current.contains(target)) setSyncOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => setSsoEnabled(d.ssoEnabled ?? false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const admin = Boolean(data?.isAdmin);
        setIsAdmin(admin);
        if (admin) {
          void refreshSyncStatus();
        }
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshSyncStatus]);

  useEffect(() => {
    if (!isAdmin) return;
    const interval = window.setInterval(() => setRelativeTimeTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(interval);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !hasRunningSync) return;
    const interval = window.setInterval(() => {
      void refreshSyncStatus();
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [hasRunningSync, isAdmin, refreshSyncStatus]);

  async function handleSync(source: SyncSource, label: string, endpoint: string) {
    if (syncingSource || hasRunningSync) return;

    setSyncingSource(source);
    setSyncMessage(`Syncing ${label}…`);
    setSyncStatus((current) => current ? {
      ...current,
      [source]: {
        source,
        state: "running",
        lastStartedAt: new Date().toISOString(),
        lastFinishedAt: current[source]?.lastFinishedAt ?? null,
        lastError: null,
        lastResult: current[source]?.lastResult ?? null,
      },
    } : current);

    try {
      const response = await fetch(endpoint, { method: "POST" });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(data) ?? `${label} sync failed`);
      }

      setSyncMessage(`${label} sync completed. Refreshing data…`);
      await refreshSyncStatus();
      router.refresh();
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      setSyncMessage(`${label} sync failed: ${message}`);
      await refreshSyncStatus();
      setSyncingSource(null);
    }
  }

  function handleGlobalSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchValue.trim();
    router.push(q ? `/?search=${encodeURIComponent(q)}` : "/");
    setSearchValue("");
  }

  function handleSignOut() {
    logout();
    if (ssoEnabled) {
      nextAuthSignOut({ callbackUrl: "/login" });
    } else {
      router.replace("/login");
    }
  }

  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--header-bg)] px-3 py-2 sm:px-5 xl:px-6">
      <button type="button" onClick={onOpenNavigation} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-gray-100 md:hidden" aria-label="Open navigation">
        <MenuIcon className="h-5 w-5" />
      </button>
      <form onSubmit={handleGlobalSearch} className="flex min-w-0 flex-1 items-center gap-4">
        <div className="relative w-full max-w-md">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input
            type="search"
            placeholder="Global search (then press Enter)"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="input-search"
            aria-label="Global search"
          />
        </div>
      </form>
      <div className="flex shrink-0 items-center gap-1">
        {isAdmin && (
          <div className="relative" ref={syncRef}>
            <button
              type="button"
              onClick={() => {
                setSyncOpen((open) => !open);
                setHelpOpen(false);
                setNotificationsOpen(false);
                setSyncMessage(null);
                void refreshSyncStatus();
              }}
              className="mr-1 flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-2 text-xs text-[var(--muted)] transition hover:bg-gray-100 hover:text-[var(--text)]"
              aria-label={`Data source sync. Last synced: ${syncTime}`}
              aria-expanded={syncOpen}
              aria-haspopup="menu"
              title={`Data source sync — last synced: ${syncTime}`}
            >
              <SyncStatusIcon className={`h-4 w-4 ${syncIconClass(syncStatus, hasRunningSync)}`} />
              <span className="hidden whitespace-nowrap sm:inline">Last synced: {syncTime}</span>
              <ChevronDownIcon className={`hidden h-3.5 w-3.5 transition sm:block ${syncOpen ? "rotate-180" : ""}`} />
            </button>
            {syncOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-lg"
                role="menu"
                aria-label="Data source sync"
              >
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--text)]">Data source sync</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">Run an on-demand refresh from a connected source.</p>
                </div>
                <div className="p-2">
                  {SYNC_SOURCES.map(({ source, label, endpoint }) => {
                    const status = syncStatus?.[source];
                    const isRunning = syncingSource === source || status?.state === "running";
                    const disabled = Boolean(syncingSource) || hasRunningSync;
                    return (
                      <button
                        key={source}
                        type="button"
                        onClick={() => void handleSync(source, label, endpoint)}
                        disabled={disabled}
                        className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        role="menuitem"
                      >
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${syncSourceIconClass(status?.state)}`}>
                          <SyncStatusIcon className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-[var(--text)]">Sync {label}</span>
                          <span className={`block truncate text-xs ${status?.state === "error" ? "text-red-600" : "text-[var(--muted)]"}`}>
                            {syncSourceSummary(status, source, syncStatus)}
                          </span>
                        </span>
                        <span className="rounded-md border border-[var(--border)] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">
                          {isRunning ? "Running" : "Run"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {syncMessage && (
                  <div
                    className={`border-t border-[var(--border)] px-4 py-2.5 text-xs ${syncMessage.includes("failed") ? "text-red-600" : "text-[var(--muted)]"}`}
                    aria-live="polite"
                  >
                    {syncMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <Link
          href="/collection"
          className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-gray-100"
          aria-label="Activity / Collection log"
          title="Collection log"
        >
          <ClockIcon className="h-5 w-5" />
        </Link>
        <div className="relative hidden sm:block" ref={helpRef}>
          <button
            type="button"
            onClick={() => { setHelpOpen((o) => !o); setNotificationsOpen(false); setSyncOpen(false); }}
            className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-gray-100"
            aria-label="Help"
            title="Help"
          >
            <HelpIcon className="h-5 w-5" />
          </button>
          {helpOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border)] bg-white p-3 shadow-lg">
              <p className="text-sm font-medium text-[var(--text)]">Help</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                For equipment or access questions, contact your IT team or the portal administrator.
              </p>
            </div>
          )}
        </div>
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => { setNotificationsOpen((o) => !o); setHelpOpen(false); setSyncOpen(false); }}
            className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-gray-100"
            aria-label="Notifications"
            title="Notifications"
          >
            <BellIcon className="h-5 w-5" />
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--border)] bg-white p-3 shadow-lg">
              <p className="text-sm font-medium text-[var(--text)]">Notifications</p>
              <p className="mt-1 text-sm text-[var(--muted)]">No new notifications.</p>
            </div>
          )}
        </div>
        <Link
          href="/settings"
          className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-gray-100"
          aria-label="User settings"
          title="User settings"
        >
          <SettingsIcon className="h-5 w-5" />
        </Link>
        <Link
          href="/settings"
          className="ml-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-[var(--border)] bg-[var(--sidebar-bg)] text-sm font-medium text-[var(--text-secondary)]"
          aria-label={`User settings for ${userName}`}
          title={userName}
        >
          {avatarSrc && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarSrc}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span>{userInitial}</span>
          )}
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="ml-1 hidden rounded-md px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-gray-100 hover:text-[var(--text)] lg:block"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function MenuIcon({ className }: { className?: string }) {
  return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" /></svg>;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function HelpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

function SyncStatusIcon({ className }: { className?: string }) {
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

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  return typeof value.error === "string" ? value.error : null;
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return "Never";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";

  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatSyncDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function syncTimestamp(source: SyncSource, status: SyncStatusResponse | null): string | null {
  if (!status) return null;
  if (source === "entra") return status.directorySyncedAt ?? status.entraSyncedAt;
  if (source === "reftab") return status.reftabSyncedAt;
  return status.ninjaOneSyncedAt;
}

function syncSourceSummary(
  run: SyncRunStatus | undefined,
  source: SyncSource,
  status: SyncStatusResponse | null,
): string {
  if (run?.state === "running") return `Started ${formatSyncDateTime(run.lastStartedAt) ?? "recently"}`;
  if (run?.state === "error") return run.lastError ?? "Last sync failed";

  const completedAt = run?.lastFinishedAt ?? syncTimestamp(source, status);
  const formatted = formatSyncDateTime(completedAt);
  return formatted ? `Last synced ${formatted}` : "Not synced yet";
}

function syncIconClass(status: SyncStatusResponse | null, hasRunningSync: boolean): string {
  if (hasRunningSync) return "animate-spin text-amber-500";
  if (SYNC_SOURCES.some(({ source }) => status?.[source]?.state === "error")) return "text-red-600";
  return status?.lastSyncedAt ? "text-emerald-600" : "text-[var(--muted)]";
}

function syncSourceIconClass(state: SyncRunState | undefined): string {
  if (state === "running") return "bg-amber-50 text-amber-600";
  if (state === "error") return "bg-red-50 text-red-600";
  if (state === "success") return "bg-emerald-50 text-emerald-600";
  return "bg-gray-100 text-[var(--muted)]";
}
