"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn, setDashboardView, type DashboardView } from "@/lib/auth-session";

const OPTIONS: { value: DashboardView; label: string; description: string }[] = [
  { value: "table", label: "Table view", description: "Fast scanning: staff list in a table with equipment counts." },
  { value: "cards", label: "Staff cards", description: "People-centric: each report as a card with their equipment." },
  { value: "assets", label: "Asset-centric", description: "Return logistics: list all assets with assignee and actions." },
];

export default function ChooseViewPage() {
  const router = useRouter();

  useEffect(() => {
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  function handleChoose(view: DashboardView) {
    setDashboardView(view);
    router.replace("/");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-[var(--text)]">Switch dashboard view</h1>
        <p className="mt-2 text-[var(--muted)]">Pick how you want to see your reports and their equipment.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => handleChoose(opt.value)}
            className="rounded-lg border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--accent)] hover:bg-gray-50"
          >
            <span className="block font-medium text-[var(--text)]">{opt.label}</span>
            <span className="mt-1 block text-sm text-[var(--muted)]">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
