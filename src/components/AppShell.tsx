"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  if (pathname === "/login") return <main className="min-h-screen">{children}</main>;
  return (
    <>
      <Sidebar mobileOpen={navigationOpen} onClose={() => setNavigationOpen(false)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col md:pl-[var(--sidebar-width)]">
        <TopBar onOpenNavigation={() => setNavigationOpen(true)} />
        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 xl:px-6 xl:py-6">{children}</main>
      </div>
    </>
  );
}
