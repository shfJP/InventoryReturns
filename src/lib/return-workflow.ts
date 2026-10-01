import { prisma } from "./db";

const KEY = "returnWorkflow:v1";

export const RETURN_RECIPIENT_ROLES = ["supervisor", "hr", "it", "designated"] as const;
export type ReturnRecipientRole = (typeof RETURN_RECIPIENT_ROLES)[number];

export type ReturnWorkflowConfig = {
  defaultRecipientRole: ReturnRecipientRole;
  enabledRecipientRoles: ReturnRecipientRole[];
  designatedRecipientLabel: string;
  returnInstructions: string;
  requireLocation: boolean;
};

const DEFAULT_CONFIG: ReturnWorkflowConfig = {
  defaultRecipientRole: "it",
  enabledRecipientRoles: ["supervisor", "hr", "it"],
  designatedRecipientLabel: "Designated recipient",
  returnInstructions: "Managers mark equipment collected, then the selected recipient physically receives it and IT completes close-out.",
  requireLocation: false,
};

function isRole(value: unknown): value is ReturnRecipientRole {
  return typeof value === "string" && RETURN_RECIPIENT_ROLES.includes(value as ReturnRecipientRole);
}

function normalize(value: unknown): ReturnWorkflowConfig {
  const raw = value && typeof value === "object" ? value as Partial<ReturnWorkflowConfig> : {};
  const enabled = Array.isArray(raw.enabledRecipientRoles)
    ? raw.enabledRecipientRoles.filter(isRole)
    : DEFAULT_CONFIG.enabledRecipientRoles;
  const enabledRecipientRoles = enabled.length > 0 ? Array.from(new Set(enabled)) : DEFAULT_CONFIG.enabledRecipientRoles;
  const defaultRecipientRole =
    isRole(raw.defaultRecipientRole) && enabledRecipientRoles.includes(raw.defaultRecipientRole)
      ? raw.defaultRecipientRole
      : enabledRecipientRoles[0];
  return {
    defaultRecipientRole,
    enabledRecipientRoles,
    designatedRecipientLabel: String(raw.designatedRecipientLabel ?? DEFAULT_CONFIG.designatedRecipientLabel).slice(0, 120),
    returnInstructions: String(raw.returnInstructions ?? DEFAULT_CONFIG.returnInstructions).slice(0, 2_000),
    requireLocation: raw.requireLocation === true,
  };
}

export async function getReturnWorkflowConfig(): Promise<ReturnWorkflowConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_CONFIG;
  try {
    return normalize(JSON.parse(row.value));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveReturnWorkflowConfig(value: unknown): Promise<ReturnWorkflowConfig> {
  const config = normalize(value);
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
  return config;
}
