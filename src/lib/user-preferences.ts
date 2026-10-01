import { prisma } from "./db";
import {
  DEFAULT_DASHBOARD_VIEW,
  isDashboardView,
  type DashboardView,
} from "./dashboard-view";

export type UserPreferences = {
  dashboardView: DashboardView;
};

const USER_PREFERENCES_KEY_PREFIX = "userPreferences:";

function preferenceKey(employeeId: string): string {
  return `${USER_PREFERENCES_KEY_PREFIX}${employeeId.trim().toLowerCase()}`;
}

export async function getUserPreferences(employeeId: string): Promise<UserPreferences> {
  const row = await prisma.appSetting.findUnique({
    where: { key: preferenceKey(employeeId) },
    select: { value: true },
  });
  if (!row) return { dashboardView: DEFAULT_DASHBOARD_VIEW };

  try {
    const parsed = JSON.parse(row.value) as Partial<UserPreferences>;
    return {
      dashboardView: isDashboardView(parsed.dashboardView)
        ? parsed.dashboardView
        : DEFAULT_DASHBOARD_VIEW,
    };
  } catch {
    return { dashboardView: DEFAULT_DASHBOARD_VIEW };
  }
}

export async function saveUserPreferences(
  employeeId: string,
  preferences: UserPreferences,
): Promise<UserPreferences> {
  const normalized: UserPreferences = {
    dashboardView: isDashboardView(preferences.dashboardView)
      ? preferences.dashboardView
      : DEFAULT_DASHBOARD_VIEW,
  };

  await prisma.appSetting.upsert({
    where: { key: preferenceKey(employeeId) },
    update: { value: JSON.stringify(normalized) },
    create: {
      key: preferenceKey(employeeId),
      value: JSON.stringify(normalized),
    },
  });

  return normalized;
}
