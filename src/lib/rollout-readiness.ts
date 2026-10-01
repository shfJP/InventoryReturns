import { prisma } from "./db";
import { configuredFlag, configuredIds } from "./access-config";

const KEY = "rolloutReadiness:v1";

export type RolloutChecklist = {
  dataReviewed: boolean;
  workflowApproved: boolean;
  securityApproved: boolean;
  pilotComplete: boolean;
  trainingComplete: boolean;
  communicationsSent: boolean;
  launchApproved: boolean;
  notes: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

const DEFAULTS: RolloutChecklist = {
  dataReviewed: false,
  workflowApproved: false,
  securityApproved: false,
  pilotComplete: false,
  trainingComplete: false,
  communicationsSent: false,
  launchApproved: false,
  notes: "",
  updatedAt: null,
  updatedBy: null,
};

function normalize(value: unknown): RolloutChecklist {
  const raw = value && typeof value === "object" ? value as Partial<RolloutChecklist> : {};
  return {
    dataReviewed: raw.dataReviewed === true,
    workflowApproved: raw.workflowApproved === true,
    securityApproved: raw.securityApproved === true,
    pilotComplete: raw.pilotComplete === true,
    trainingComplete: raw.trainingComplete === true,
    communicationsSent: raw.communicationsSent === true,
    launchApproved: raw.launchApproved === true,
    notes: String(raw.notes ?? "").slice(0, 4_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  };
}

export async function getRolloutReadiness() {
  const [setting, activeUsers, inactiveWithAssets, orphanAssignments, openCorrections, undecidedMismatches] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: KEY } }),
    prisma.user.count({ where: { isActive: true, directorySource: { not: null } } }),
    prisma.user.count({ where: { isActive: false, equipmentAssignments: { some: {} } } }),
    prisma.equipmentAssignment.count({ where: { user: null } }),
    prisma.correctionRequest.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
    prisma.reconciliationDecision.count({ where: { decision: { in: ["UNSURE", "DEFER"] } } }),
  ]);
  let checklist = DEFAULTS;
  if (setting) {
    try { checklist = normalize(JSON.parse(setting.value)); } catch { checklist = DEFAULTS; }
  }
  return {
    checklist,
    data: {
      activeUsers,
      inactiveWithAssets,
      orphanAssignments,
      openCorrections,
      undecidedMismatches,
    },
    configuration: {
      pilotModeEnabled: configuredFlag("PILOT_MODE_ENABLED"),
      pilotEmployeeCount: configuredIds("PILOT_EMPLOYEE_IDS").length,
      adminGroupsConfigured: configuredIds("ADMIN_GROUP_IDS").length > 0,
      itGroupsConfigured: configuredIds("IT_GROUP_IDS").length > 0,
      notificationConfigured: Boolean(
        process.env.WEBHOOK_URL?.trim() ||
        process.env.TEAMS_WEBHOOK_URL?.trim() ||
        process.env.SMTP_HOST?.trim()
      ),
      snowflakeConfigured: Boolean(process.env.SNOWFLAKE_ACCOUNT?.trim() && process.env.SNOWFLAKE_USERNAME?.trim()),
    },
  };
}

export async function saveRolloutChecklist(value: unknown, updatedBy: string): Promise<RolloutChecklist> {
  const checklist = {
    ...normalize(value),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(checklist) },
    update: { value: JSON.stringify(checklist) },
  });
  return checklist;
}
