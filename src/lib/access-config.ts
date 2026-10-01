function csv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function configuredIds(name: string): string[] {
  return csv(name);
}

export function configuredFlag(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export function isPilotAccessAllowed(employeeId: string): boolean {
  if (!configuredFlag("PILOT_MODE_ENABLED")) return true;
  const allowed = configuredIds("PILOT_EMPLOYEE_IDS");
  return allowed.length > 0 && allowed.includes(employeeId.trim().toLowerCase());
}
