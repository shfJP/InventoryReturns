"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { formatPersonName } from "@/lib/display-name";
import {
  DEFAULT_DASHBOARD_VIEW,
  type DashboardView,
} from "@/lib/dashboard-view";

type ApiUser = {
  employeeId: string;
  displayName: string;
  email: string;
  isManager: boolean;
  isAdmin?: boolean;
  dashboardView?: DashboardView;
};

type SyncSettings = {
  autoSyncOnStartup: boolean;
  cronEnabled: boolean;
  syncEntra: boolean;
  entraIntervalMinutes: number;
  syncReftab: boolean;
  reftabIntervalMinutes: number;
  syncNinjaOne: boolean;
  ninjaOneIntervalMinutes: number;
};

type SyncRunStatus = {
  state: "idle" | "running" | "success" | "error";
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
  lastResult: unknown | null;
};

type SyncStatusResponse = {
  entra?: SyncRunStatus;
  reftab?: SyncRunStatus;
  ninjaone?: SyncRunStatus;
  daemon?: {
    startedAt: string | null;
    lastHeartbeatAt: string | null;
    pid: number | null;
  };
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [savingSyncSettings, setSavingSyncSettings] = useState(false);
  const [syncSettingsMessage, setSyncSettingsMessage] = useState<string | null>(null);
  const [dashboardView, setDashboardView] = useState<DashboardView>(DEFAULT_DASHBOARD_VIEW);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => setSsoEnabled(d.ssoEnabled ?? false))
      .catch(() => setSsoEnabled(false));

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setUser(data);
        setDashboardView(data?.dashboardView ?? DEFAULT_DASHBOARD_VIEW);
        if (data?.isAdmin) {
          fetch("/api/admin/sync-settings")
            .then((r) => (r.ok ? r.json() : null))
            .then((settings) => setSyncSettings(settings))
            .catch(() => setSyncSettings(null));
          fetch("/api/admin/sync-status")
            .then((r) => (r.ok ? r.json() : null))
            .then((status) => setSyncStatus(status))
            .catch(() => setSyncStatus(null));
        }
      })
      .catch(() => setUser(null));
  }, []);

  const name = formatPersonName(user?.displayName ?? session?.user?.name) || "User";
  const email = user?.email ?? session?.user?.email ?? "";
  const employeeId = user?.employeeId ?? "";

  async function savePreferences() {
    setSavingPreferences(true);
    setPreferencesMessage(null);
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardView }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save preferences");
      setDashboardView(data.dashboardView);
      setPreferencesMessage("Dashboard preference saved to your profile.");
    } catch (e) {
      setPreferencesMessage(e instanceof Error ? e.message : "Failed to save preferences");
    } finally {
      setSavingPreferences(false);
    }
  }

  async function saveSyncSettings() {
    if (!syncSettings) return;
    setSavingSyncSettings(true);
    setSyncSettingsMessage(null);
    try {
      const res = await fetch("/api/admin/sync-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(syncSettings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save sync settings");
      setSyncSettings(data);
      setSyncSettingsMessage("Sync settings saved.");
    } catch (e) {
      setSyncSettingsMessage(e instanceof Error ? e.message : "Failed to save sync settings");
    } finally {
      setSavingSyncSettings(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">User settings</h1>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--sidebar-bg)] text-xl font-semibold text-[var(--text-secondary)]">
            {ssoEnabled ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/api/me/avatar"
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              name.trim().charAt(0).toUpperCase() || "U"
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-[var(--text)]">{name}</p>
            {email && <p className="truncate text-sm text-[var(--muted)]">{email}</p>}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-[var(--muted)]">Employee ID</dt>
            <dd className="mt-1 text-sm text-[var(--text)]">{employeeId || "Not available"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--muted)]">Access</dt>
            <dd className="mt-1 text-sm text-[var(--text)]">{user?.isManager ? "Manager" : "Standard user"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-[var(--muted)]">Sign-in mode</dt>
            <dd className="mt-1 text-sm text-[var(--text)]">
              {ssoEnabled === null ? "Loading" : ssoEnabled ? "Microsoft Entra ID" : "Pilot mode"}
            </dd>
          </div>
        </dl>
      </section>

      <section id="dashboard-preferences" className="scroll-mt-20 rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Dashboard preferences</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Choose the default Equipment Returns dashboard view stored with your user profile.
            </p>
          </div>
          <button
            type="button"
            onClick={savePreferences}
            disabled={savingPreferences}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {savingPreferences ? "Saving" : "Save preference"}
          </button>
        </div>

        <fieldset className="mt-4 grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Default dashboard view</legend>
          {([
            ["table", "Table view", "Fast scanning of staff and equipment counts."],
            ["cards", "Staff cards", "People-focused cards with assigned equipment."],
            ["assets", "Asset-centric", "Return logistics organized by individual asset."],
          ] as const).map(([value, label, description]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border p-3 transition ${
                dashboardView === value
                  ? "border-[var(--accent)] bg-purple-50"
                  : "border-[var(--border)] hover:bg-gray-50"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="dashboardView"
                  value={value}
                  checked={dashboardView === value}
                  onChange={() => {
                    setDashboardView(value);
                    setPreferencesMessage(null);
                  }}
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium text-[var(--text)]">{label}</span>
              </span>
              <span className="mt-2 block text-xs text-[var(--muted)]">{description}</span>
            </label>
          ))}
        </fieldset>

        {preferencesMessage && (
          <p className="mt-3 text-sm text-[var(--muted)]">{preferencesMessage}</p>
        )}
      </section>

      {user?.isAdmin && syncSettings && (
        <section className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Sync automation</h2>
            </div>
            <button
              type="button"
              onClick={saveSyncSettings}
              disabled={savingSyncSettings}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {savingSyncSettings ? "Saving" : "Save"}
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SyncDaemonCard status={syncStatus?.daemon} />
              <SyncStatusCard label="Directory" status={syncStatus?.entra} />
              <SyncStatusCard label="Reftab" status={syncStatus?.reftab} />
              <SyncStatusCard label="NinjaOne" status={syncStatus?.ninjaone} />
            </div>

            <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] px-3 py-2">
              <span>
                <span className="block text-sm font-medium text-[var(--text)]">Sync on startup</span>
                <span className="block text-xs text-[var(--muted)]">Run selected syncs when the app container starts.</span>
              </span>
              <input
                type="checkbox"
                checked={syncSettings.autoSyncOnStartup}
                onChange={(e) => setSyncSettings({ ...syncSettings, autoSyncOnStartup: e.target.checked })}
                className="h-4 w-4"
              />
            </label>

            <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] px-3 py-2">
              <span>
                <span className="block text-sm font-medium text-[var(--text)]">Scheduled sync</span>
                <span className="block text-xs text-[var(--muted)]">Run selected syncs repeatedly in the background.</span>
              </span>
              <input
                type="checkbox"
                checked={syncSettings.cronEnabled}
                onChange={(e) => setSyncSettings({ ...syncSettings, cronEnabled: e.target.checked })}
                className="h-4 w-4"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={syncSettings.syncEntra}
                    onChange={(e) => setSyncSettings({ ...syncSettings, syncEntra: e.target.checked })}
                  />
                  Sync Directory
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-[var(--muted)]">Directory interval minutes</span>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={syncSettings.entraIntervalMinutes}
                    onChange={(e) => setSyncSettings({ ...syncSettings, entraIntervalMinutes: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-[var(--border)] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={syncSettings.syncReftab}
                    onChange={(e) => setSyncSettings({ ...syncSettings, syncReftab: e.target.checked })}
                  />
                  Sync Reftab
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-[var(--muted)]">Reftab interval minutes</span>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={syncSettings.reftabIntervalMinutes}
                    onChange={(e) => setSyncSettings({ ...syncSettings, reftabIntervalMinutes: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="rounded-lg border border-[var(--border)] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={syncSettings.syncNinjaOne}
                    onChange={(e) => setSyncSettings({ ...syncSettings, syncNinjaOne: e.target.checked })}
                  />
                  Sync NinjaOne
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-[var(--muted)]">NinjaOne interval minutes</span>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={syncSettings.ninjaOneIntervalMinutes}
                    onChange={(e) => setSyncSettings({ ...syncSettings, ninjaOneIntervalMinutes: Number(e.target.value) })}
                    className="mt-1 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>

            {syncSettingsMessage && (
              <p className="text-sm text-[var(--muted)]">{syncSettingsMessage}</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SyncStatusCard({ label, status }: { label: string; status: SyncRunStatus | undefined }) {
  const state = status?.state ?? "idle";
  const badgeClassName = {
    idle: "bg-gray-100 text-gray-700",
    running: "bg-amber-100 text-amber-800",
    success: "bg-emerald-100 text-emerald-800",
    error: "bg-red-100 text-red-800",
  }[state];

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">{label}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClassName}`}>{state}</span>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="font-medium text-[var(--muted)]">Last started</dt>
          <dd className="text-[var(--text)]">{formatDate(status?.lastStartedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--muted)]">Last finished</dt>
          <dd className="text-[var(--text)]">{formatDate(status?.lastFinishedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--muted)]">Last error</dt>
          <dd className="break-words text-[var(--text)]">{status?.lastError ?? "None"}</dd>
        </div>
      </dl>
    </div>
  );
}

function SyncDaemonCard({ status }: { status: SyncStatusResponse["daemon"] | undefined }) {
  const heartbeatTime = status?.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).getTime() : 0;
  const isAlive = heartbeatTime > 0 && Date.now() - heartbeatTime < 180_000;
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">Background worker</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isAlive ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
          {isAlive ? "alive" : "not detected"}
        </span>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <div>
          <dt className="font-medium text-[var(--muted)]">Started</dt>
          <dd className="text-[var(--text)]">{formatDate(status?.startedAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--muted)]">Last heartbeat</dt>
          <dd className="text-[var(--text)]">{formatDate(status?.lastHeartbeatAt)}</dd>
        </div>
        <div>
          <dt className="font-medium text-[var(--muted)]">Process ID</dt>
          <dd className="text-[var(--text)]">{status?.pid ?? "Not available"}</dd>
        </div>
      </dl>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Never";
}
