"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isLoggedIn } from "@/lib/auth-session";
import { exportRowsToCsv } from "@/lib/csv-export";

type Event = {
  id: string;
  assetTag: string;
  serial: string | null;
  assignedToEmployeeId: string;
  markedByManager: string;
  markedByManagerId: string;
  markedCollectedAt: string;
  notes: string | null;
  status: string;
  closedOutAt: string | null;
  closedOutBy: string | null;
};

export default function CollectionPage() {
  const router = useRouter();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/collection");
        if (!res.ok) throw new Error("Failed to load");
        setEvents(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function closeOut(eventId: string) {
    setClosing(eventId);
    try {
      const res = await fetch("/api/closeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed");
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, status: "CLOSED_OUT", closedOutAt: new Date().toISOString(), closedOutBy: "You" }
            : e
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Close-out failed");
    } finally {
      setClosing(null);
    }
  }

  if (loading) return <div className="text-[var(--muted)]">Loading…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>;

  const pending = events.filter((e) => e.status === "COLLECTED_PENDING_IT");
  const closed = events.filter((e) => e.status === "CLOSED_OUT");
  const collectionColumns = [
    { header: "Asset Tag", value: (e: Event) => e.assetTag },
    { header: "Serial", value: (e: Event) => e.serial },
    { header: "Assigned To", value: (e: Event) => e.assignedToEmployeeId },
    { header: "Marked By", value: (e: Event) => e.markedByManager },
    { header: "Marked At", value: (e: Event) => new Date(e.markedCollectedAt).toLocaleString() },
    { header: "Notes", value: (e: Event) => e.notes },
    { header: "Status", value: (e: Event) => e.status },
    { header: "Closed By", value: (e: Event) => e.closedOutBy },
    { header: "Closed At", value: (e: Event) => e.closedOutAt ? new Date(e.closedOutAt).toLocaleString() : "" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[var(--text)]">Collection log</h1>
      <p className="text-[var(--muted)]">Items marked collected by you or your reports. IT can close out when physically received.</p>

      {pending.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
          <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-[var(--warning)]">Pending IT pickup ({pending.length})</h2>
              <button type="button" onClick={() => exportRowsToCsv("pending-collections.csv", collectionColumns, pending)} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Export Excel</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th className="table-header">Asset</th>
                  <th className="table-header">Assigned to</th>
                  <th className="table-header">Marked by</th>
                  <th className="table-header">When</th>
                  <th className="table-header">Notes</th>
                  <th className="table-header">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border)] hover:bg-[var(--table-header-bg)]/50">
                    <td className="table-cell font-medium">{e.assetTag} {e.serial ? `(${e.serial})` : ""}</td>
                    <td className="table-cell text-[var(--text-secondary)]">{e.assignedToEmployeeId}</td>
                    <td className="table-cell text-[var(--text)]">{e.markedByManager}</td>
                    <td className="table-cell text-[var(--muted)]">{new Date(e.markedCollectedAt).toLocaleString()}</td>
                    <td className="table-cell text-[var(--muted)]">{e.notes ?? "—"}</td>
                    <td className="table-cell">
                      <button
                        type="button"
                        className="rounded-lg bg-[var(--success)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        disabled={closing === e.id}
                        onClick={() => closeOut(e.id)}
                      >
                        {closing === e.id ? "Closing…" : "Close out (IT)"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-sm">
        <div className="border-b border-[var(--border)] bg-[var(--table-header-bg)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--success)]">Closed out ({closed.length})</h2>
            <button type="button" onClick={() => exportRowsToCsv("closed-collections.csv", collectionColumns, closed)} className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Export Excel</button>
          </div>
        </div>
        {closed.length === 0 ? (
          <p className="p-6 text-[var(--muted)]">No closed-out events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr>
                  <th className="table-header">Asset</th>
                  <th className="table-header">Assigned to</th>
                  <th className="table-header">Marked by</th>
                  <th className="table-header">Closed by</th>
                  <th className="table-header">Closed at</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border)] hover:bg-[var(--table-header-bg)]/50">
                    <td className="table-cell font-medium text-[var(--text)]">{e.assetTag}</td>
                    <td className="table-cell text-[var(--text-secondary)]">{e.assignedToEmployeeId}</td>
                    <td className="table-cell text-[var(--text)]">{e.markedByManager}</td>
                    <td className="table-cell text-[var(--muted)]">{e.closedOutBy ?? "—"}</td>
                    <td className="table-cell text-[var(--muted)]">
                      {e.closedOutAt ? new Date(e.closedOutAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
