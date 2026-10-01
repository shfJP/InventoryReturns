"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-session";
import {
  DEFAULT_DASHBOARD_VIEW,
  isDashboardView,
  type DashboardView,
} from "@/lib/dashboard-view";
import type { DashboardData, Equipment } from "@/types/dashboard";
import DashboardTable from "@/components/DashboardTable";
import DashboardCards from "@/components/DashboardCards";
import DashboardAssets from "@/components/DashboardAssets";

const VIEW_MAP = {
  table: DashboardTable,
  cards: DashboardCards,
  assets: DashboardAssets,
} as const;

function DashboardPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search") ?? "";
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<DashboardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const [meRes, staffRes, eqRes, syncStatusRes] = await Promise.all([
          fetch("/api/me"),
          fetch("/api/staff"),
          fetch("/api/equipment?include_collected=true"),
          fetch("/api/admin/sync-status"),
        ]);
        if (!meRes.ok) throw new Error("Not authenticated");
        const me = await meRes.json();
        setView(isDashboardView(me.dashboardView) ? me.dashboardView : DEFAULT_DASHBOARD_VIEW);
        const staff = staffRes.ok ? await staffRes.json() : [];
        const equipment = (eqRes.ok ? await eqRes.json() : []) as Equipment[];
        const syncStatus = syncStatusRes.ok ? await syncStatusRes.json() : undefined;
        const equipmentByEmployee = equipment.reduce<Record<string, Equipment[]>>((acc, e) => {
          (acc[e.assignedToEmployeeId] = acc[e.assignedToEmployeeId] ?? []).push(e);
          return acc;
        }, {});
        setData({ me, staff, equipment, equipmentByEmployee, syncStatus });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <div className="text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;
  if (!data) return <div className="text-[var(--muted)]">Loading…</div>;
  if (!data.me) return <div className="text-[var(--muted)]">Not signed in. Set CURRENT_USER_EMPLOYEE_ID or run seed.</div>;
  if (!view) return <div className="text-[var(--muted)]">Loading preferences…</div>;

  const Component = VIEW_MAP[view];
  return <Component data={data} initialSearchQuery={initialSearch} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="text-[var(--muted)]">Loading…</div>}>
      <DashboardPageInner />
    </Suspense>
  );
}
