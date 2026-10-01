"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Me = { modules?: string[] };

const MODULES = [
  { id: "equipment", href: "/", title: "Equipment returns", description: "Direct reports, equipment collection, and IT close-out." },
  { id: "reconciliation", href: "/admin/owner-reconciliation", title: "Inventory reconciliation", description: "Compare Reftab and NinjaOne ownership and route corrections." },
  { id: "organization-analytics", href: "/reports/organization", title: "Organization analytics", description: "Division, department, subdivision, and equipment-value reporting." },
  { id: "account-remediation", href: "/modules/account-remediation", title: "Account remediation", description: "Report and resolve failed provisioning or account access." },
] as const;

export default function ModulesPage() {
  const [allowed, setAllowed] = useState<string[]>(["equipment", "account-remediation"]);
  useEffect(() => {
    fetch("/api/me").then((res) => res.ok ? res.json() : null).then((data: Me | null) => {
      if (data?.modules) setAllowed(data.modules);
    }).catch(() => {});
  }, []);
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-[var(--text)]">Operations portal</h1><p className="text-[var(--muted)]">Choose a module available to your role.</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        {MODULES.filter((module) => allowed.includes(module.id)).map((module) => (
          <Link key={module.id} href={module.href} className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-sm transition hover:border-[var(--accent)] hover:shadow-md">
            <h2 className="text-lg font-semibold text-[var(--text)]">{module.title}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{module.description}</p>
            <span className="mt-4 inline-flex text-sm font-medium text-[var(--accent)]">Open module →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
