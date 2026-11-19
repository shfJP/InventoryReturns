import ExcelJS from "exceljs";
import type { ReconciliationReportItem } from "./owner-reconciliation";

export type ReportCompletion = {
  assetTag: string;
  ninjaDeviceId: string;
  action: string;
  status: string;
  completedAt: Date | null;
  actorName: string;
  decisionId?: string | null;
  evidenceSource?: string;
};

const completionActions = new Set(["reassign-owner", "add-missing-asset", "decommission-missing-asset"]);

export const historicalOwnerChangeReason = "Approved and written to Reftab";

export type HistoricalDecision = {
  id: string;
  assetTag: string;
  ninjaDeviceId: string;
  decision: string;
  reason: string | null;
  createdAt: Date;
  decidedByName: string | null;
  decidedByEmployeeId: string;
};

export function reconciliationHistoryDiagnostics(audits: ReportCompletion[], decisions: HistoricalDecision[], now: Date) {
  const groups = new Map<string, { source: string; action: string; outcome: string; reason: string; count: number; latest: Date | null }>();
  const add = (source: string, action: string, outcome: string, reason: string, date: Date | null) => {
    const key = JSON.stringify([source, action, outcome, reason]);
    const group = groups.get(key) ?? { source, action, outcome, reason, count: 0, latest: null };
    group.count++;
    if (date && (!group.latest || date > group.latest)) group.latest = date;
    groups.set(key, group);
  };
  for (const audit of audits) {
    const reason = audit.status !== "SUCCEEDED" ? "Excluded: no recorded successful write"
      : !completionActions.has(audit.action) ? "Excluded: review or secondary action"
      : !audit.completedAt ? "Excluded: completion date missing"
      : audit.completedAt > now ? "Excluded: completion date is after export time"
      : "Eligible successful write (distinct devices counted)";
    add("Audit", audit.action, audit.status, reason, audit.completedAt);
  }
  for (const decision of decisions) {
    const reason = decision.decision !== "YES" ? "Excluded: review decision, not a completed owner write"
      : decision.reason !== historicalOwnerChangeReason ? "Excluded: YES without the recorded successful-write marker"
      : decision.createdAt > now ? "Excluded: decision date is after export time"
      : "Eligible historical owner write (linked audits and devices deduplicated)";
    add("Decision", "record-decision", decision.decision, reason, decision.createdAt);
  }
  return [...groups.values()].sort((a, b) =>
    a.source.localeCompare(b.source) || a.action.localeCompare(b.action) || a.outcome.localeCompare(b.outcome) || a.reason.localeCompare(b.reason));
}

export function mergeReconciliationCompletions(audits: ReportCompletion[], decisions: HistoricalDecision[]): ReportCompletion[] {
  const linkedSuccesses = new Set(audits.filter((audit) =>
    audit.status === "SUCCEEDED" && completionActions.has(audit.action) && audit.completedAt,
  ).map((audit) => audit.decisionId).filter(Boolean));
  const historical = decisions.filter((decision) =>
    // YES alone also represented manual reviews in the earlier API. This
    // automatic reason was written only after the owner change succeeded.
    decision.decision === "YES" && decision.reason === historicalOwnerChangeReason &&
    !linkedSuccesses.has(decision.id),
  ).map((decision): ReportCompletion => ({
    assetTag: decision.assetTag,
    ninjaDeviceId: decision.ninjaDeviceId,
    decisionId: decision.id,
    action: "reassign-owner",
    status: "SUCCEEDED",
    completedAt: decision.createdAt,
    actorName: decision.decidedByName ?? decision.decidedByEmployeeId,
    evidenceSource: "Historical successful owner decision",
  }));
  return [
    ...audits.map((audit) => ({ ...audit, evidenceSource: audit.evidenceSource ?? "Successful audit completion" })),
    ...historical,
  ].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
}

export function summarizeReconciliation(items: ReconciliationReportItem[], audits: ReportCompletion[], now: Date) {
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const completions = audits.filter((audit) =>
    audit.status === "SUCCEEDED" && completionActions.has(audit.action) &&
    audit.completedAt && audit.completedAt <= now,
  );
  const distinctItems = (records: ReportCompletion[]) =>
    new Set(records.map((record) => record.ninjaDeviceId || `asset:${record.assetTag}`)).size;
  return {
    weekStart,
    outstanding: items.filter((item) => item.status !== "Aligned").length,
    aligned: items.filter((item) => item.status === "Aligned").length,
    missingNinja: items.filter((item) => item.status === "Missing from Ninja").length,
    missingReftab: items.filter((item) => item.status === "Missing from Reftab").length,
    reconciledTotal: distinctItems(completions),
    reconciledWeek: distinctItems(completions.filter((audit) => audit.completedAt! >= weekStart)),
    completions,
  };
}

export async function buildReconciliationWorkbook(input: {
  items: ReconciliationReportItem[];
  audits: ReportCompletion[];
  generatedAt: Date;
  reftabSyncedAt: Date | null;
  ninjaSyncedAt: Date | null;
  historyDiagnostics?: ReturnType<typeof reconciliationHistoryDiagnostics>;
}) {
  const totals = summarizeReconciliation(input.items, input.audits, input.generatedAt);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Inventory Returns";
  workbook.created = input.generatedAt;
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 44 }, { width: 32 }, { width: 100 }];
  summary.addRows([
    ["Reconciliation report", "Value", "Definition"],
    ["Generated at (UTC)", input.generatedAt.toISOString()],
    ["Past week begins (UTC)", totals.weekStart.toISOString(), "Rolling seven days, through the export timestamp."],
    ["Latest Reftab record sync (UTC)", input.reftabSyncedAt?.toISOString() ?? "No synced records"],
    ["Latest Ninja record sync (UTC)", input.ninjaSyncedAt?.toISOString() ?? "No synced records"],
    ["Items needing reconciliation now", totals.outstanding, "All outstanding statuses below, including deferred and rejected reviews still unresolved."],
    ["Items reconciled — all time", totals.reconciledTotal, "Distinct devices with successful owner changes, Reftab imports, or Reftab decommission imports in audit history, plus historical decisions recording successful owner writes to Reftab."],
    ["Items reconciled — past seven days", totals.reconciledWeek, "Distinct devices with a successful completion during the stated seven-day window."],
    ["Items missing from Ninja", totals.missingNinja, "Distinct Reftab asset tags with no eligible Ninja match."],
    ["Items missing from Reftab", totals.missingReftab, "Eligible Ninja devices with no Reftab match."],
    ["Items currently aligned", totals.aligned, "Matched devices whose active owner agrees between systems."],
    ["Current inventory scope", input.items.length, "One item per eligible Ninja device or unmatched Reftab asset tag."],
    ["Scope", "", "Uses the reconciliation matching rules. Windows Server, Linux and reserved decommissions are excluded from eligible Ninja devices. Unmatched Reftab items may include non-computer equipment."],
    ["Freshness", "", "Recalculated on export from the latest synced portal data; exporting does not run an external system sync."],
    ["History", "", "NO, UNSURE, DEFER, failed and pending attempts are not completed reconciliations. Historical completions can recur in today's outstanding list; these are separate measures, not an additive total."],
    ["Coverage", "", "Includes successful audit completions and earlier YES decisions marked 'Approved and written to Reftab', using their original dates. Earlier imports without a completion record and changes outside the portal cannot be counted."],
  ]);
  for (const status of ["Owner mismatch", "No owner signal", "Owner not in directory", "Inactive owner"] as const) {
    summary.addRow([status, input.items.filter((item) => item.status === status).length, "Outstanding items by current status."]);
  }

  const detail = workbook.addWorksheet("Current inventory");
  detail.columns = [
    { header: "Status", key: "status", width: 28 },
    { header: "Asset tag", key: "assetTag", width: 24 },
    { header: "Serial", key: "serial", width: 26 },
    { header: "Title", key: "title", width: 46 },
    { header: "Ninja device ID", key: "ninjaDeviceId", width: 24 },
  ];
  detail.addRows([...input.items].sort((a, b) => a.status.localeCompare(b.status) || a.assetTag.localeCompare(b.assetTag)));
  const history = workbook.addWorksheet("Completed changes");
  history.columns = [
    { header: "Asset tag", key: "assetTag", width: 24 },
    { header: "Ninja device ID", key: "ninjaDeviceId", width: 24 },
    { header: "Action", key: "action", width: 34 },
    { header: "Completed at (UTC)", key: "completed", width: 30 },
    { header: "Past seven days", key: "pastWeek", width: 20 },
    { header: "Completed by", key: "actorName", width: 30 },
    { header: "Evidence source", key: "evidenceSource", width: 44 },
  ];
  history.addRows(totals.completions.map((audit) => ({
    ...audit, completed: audit.completedAt!.toISOString(),
    evidenceSource: audit.evidenceSource ?? "Successful audit completion",
    pastWeek: audit.completedAt! >= totals.weekStart ? "Yes" : "No",
  })));
  if (input.historyDiagnostics) {
    const diagnostics = workbook.addWorksheet("History diagnostics");
    diagnostics.columns = [
      { header: "Record source", key: "source", width: 18 },
      { header: "Action", key: "action", width: 34 },
      { header: "Status / decision", key: "outcome", width: 24 },
      { header: "Saved records", key: "count", width: 18 },
      { header: "Latest date (UTC)", key: "latest", width: 30 },
      { header: "Counting rule", key: "reason", width: 90 },
    ];
    diagnostics.addRows(input.historyDiagnostics.map((group) => ({ ...group, latest: group.latest?.toISOString() ?? "No completion date" })));
    if (!input.historyDiagnostics.length) {
      diagnostics.addRow({ source: "None", count: 0, reason: "No audit or decision records exist in the database used by this export." });
    }
    summary.addRow(["History diagnostics", "", "See the History diagnostics sheet for all saved action/status groups and why they qualify or are excluded. Record counts overlap across audit and decision sources; they are not device totals."]);
  }
  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17436B" } };
    sheet.getRow(1).height = 26;
    if (sheet !== summary) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
  }
  summary.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (row.number >= 6) row.height = 44;
  });
  return workbook.xlsx.writeBuffer();
}
