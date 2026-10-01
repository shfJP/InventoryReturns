"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ChooseViewPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings#dashboard-preferences");
  }, [router]);

  return (
    <div className="text-[var(--muted)]">
      Opening your dashboard preferences…
    </div>
  );
}
