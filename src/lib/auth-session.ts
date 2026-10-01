/** Client-only: fake pilot session (sessionStorage). */

const KEY_LOGGED_IN = "portal_logged_in";

export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(KEY_LOGGED_IN) === "true";
}

export function setLoggedIn(): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY_LOGGED_IN, "true");
}

export function logout(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY_LOGGED_IN);
}
