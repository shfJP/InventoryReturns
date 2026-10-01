export type DashboardView = "table" | "cards" | "assets";

export const DEFAULT_DASHBOARD_VIEW: DashboardView = "table";

export function isDashboardView(value: unknown): value is DashboardView {
  return value === "table" || value === "cards" || value === "assets";
}
