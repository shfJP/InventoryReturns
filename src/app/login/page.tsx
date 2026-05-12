"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { isLoggedIn, setLoggedIn } from "@/lib/auth-session";

export default function LoginPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [ssoEnabled, setSsoEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => setSsoEnabled(d.ssoEnabled ?? false))
      .catch(() => setSsoEnabled(false));
  }, []);

  useEffect(() => {
    if (ssoEnabled && status === "authenticated" && session) {
      setLoggedIn();
      router.replace("/");
    }
  }, [ssoEnabled, status, session, router]);

  useEffect(() => {
    if (!ssoEnabled && isLoggedIn()) {
      router.replace("/");
    }
  }, [ssoEnabled, router]);

  function handlePilotLogin() {
    setLoggedIn();
    router.replace("/");
  }

  function handleSSOLogin() {
    setLoading(true);
    signIn("azure-ad", { callbackUrl: "/login" });
  }

  if (ssoEnabled === null) {
    return <div className="flex min-h-[60vh] items-center justify-center text-[var(--muted)]">Loading…</div>;
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-white p-6 shadow-sm space-y-6 text-center">
        <h1 className="text-xl font-semibold text-[var(--text)]">Equipment Collection Portal</h1>

        {ssoEnabled ? (
          <>
            <p className="text-sm text-[var(--muted)]">Sign in with your organization account.</p>
            <button
              type="button"
              onClick={handleSSOLogin}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              <MicrosoftIcon className="h-4 w-4" />
              {loading ? "Redirecting…" : "Sign in with Microsoft"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-[var(--muted)]">Pilot: sign in with one click to continue.</p>
            <button
              type="button"
              onClick={handlePilotLogin}
              className="w-full rounded-lg bg-[var(--accent)] py-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              Sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
