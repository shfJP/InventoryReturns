"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PORTAL_MODULES } from "@/lib/portal-modules";

type Me = { modules?: string[] };

export default function ModulesPage() {
  const [allowed, setAllowed] = useState<string[]>(["equipment", "account-remediation"]);
  useEffect(() => {
    fetch("/api/me").then((res) => res.ok ? res.json() : null).then((data: Me | null) => {
      if (data?.modules) setAllowed(data.modules);
    }).catch(() => {});
  }, []);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-[var(--text)]">Operations apps</h1><p className="text-[var(--muted)]">Choose a separate app available to your role.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        {PORTAL_MODULES.filter((module) => allowed.includes(module.id)).map((module) => (
          <Link key={module.id} href={module.href} className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm transition hover:border-[var(--accent)] hover:shadow-md">
            <h2 className="text-lg font-semibold text-[var(--text)]">{module.title}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{module.description}</p>
            <span className="mt-4 inline-flex text-sm font-medium text-[var(--accent)]">Open app →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
