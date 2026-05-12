/** Client-only: fake pilot session (sessionStorage). */

const KEY_LOGGED_IN = "portal_logged_in";
const KEY_VIEW = "portal_dashboard_view";

export type DashboardView = "table" | "cards" | "assets";
export const DEFAULT_DASHBOARD_VIEW: DashboardView = "table";

export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(KEY_LOGGED_IN) === "true";
}

export function setLoggedIn(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY_LOGGED_IN, "true");
}

export function getDashboardView(): DashboardView | null {
  if (typeof window === "undefined") return null;
  const v = sessionStorage.getItem(KEY_VIEW);
  if (v === "table" || v === "cards" || v === "assets") return v;
  return null;
}

export function getDashboardViewOrDefault(): DashboardView {
  return getDashboardView() ?? DEFAULT_DASHBOARD_VIEW;
}

export function setDashboardView(view: DashboardView): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY_VIEW, view);
}

export function logout(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY_LOGGED_IN);
  sessionStorage.removeItem(KEY_VIEW);
}
