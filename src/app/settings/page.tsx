"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

type ApiUser = {
  employeeId: string;
  displayName: string;
  email: string;
  isManager: boolean;
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const [user, setUser] = useState<ApiUser | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => setSsoEnabled(d.ssoEnabled ?? false))
      .catch(() => setSsoEnabled(false));

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data))
      .catch(() => setUser(null));
  }, []);

  const name = user?.displayName ?? session?.user?.name ?? "User";
  const email = user?.email ?? session?.user?.email ?? "";
  const employeeId = user?.employeeId ?? "";

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
    </div>
  );
}
