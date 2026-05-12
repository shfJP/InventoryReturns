"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut as nextAuthSignOut, useSession } from "next-auth/react";
import { logout } from "@/lib/auth-session";
import { formatPersonName } from "@/lib/display-name";

export default function TopBar() {
  const router = useRouter();
  const { data: session } = useSession();
  const [searchValue, setSearchValue] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [syncTime, setSyncTime] = useState<string | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const userName = formatPersonName(session?.user?.name) || session?.user?.email || "User";
  const userInitial = userName.trim().charAt(0).toUpperCase() || "U";
  const avatarSrc = ssoEnabled ? "/api/me/avatar" : session?.user?.image ?? null;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (helpRef.current && !helpRef.current.contains(target)) setHelpOpen(false);
      if (notifRef.current && !notifRef.current.contains(target)) setNotificationsOpen(false);
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
    fetch("/api/admin/sync-status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const ts = data.lastSyncedAt;
        if (ts) {
          const d = new Date(ts);
          const mins = Math.round((Date.now() - d.getTime()) / 60000);
          setSyncTime(mins < 1 ? "Just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`);
        }
      })
      .catch(() => {});
  }, []);

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
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--header-bg)] px-6">
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
        {syncTime && (
          <span className="mr-2 flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-[var(--muted)]">
            <SyncStatusIcon className="h-3.5 w-3.5" />
            Last synced: {syncTime}
          </span>
        )}
        <Link
          href="/collection"
          className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-gray-100"
          aria-label="Activity / Collection log"
          title="Collection log"
        >
          <ClockIcon className="h-5 w-5" />
        </Link>
        <div className="relative" ref={helpRef}>
          <button
            type="button"
            onClick={() => { setHelpOpen((o) => !o); setNotificationsOpen(false); }}
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
            onClick={() => { setNotificationsOpen((o) => !o); setHelpOpen(false); }}
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
          className="ml-2 rounded-md px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-gray-100 hover:text-[var(--text)]"
        >
          Sign out
        </button>
      </div>
    </header>
  );
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

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
