export type PortalModule =
  | "equipment"
  | "reconciliation"
  | "organization-analytics"
  | "account-remediation";

export type PortalModuleDefinition = {
  id: PortalModule;
  title: string;
  shortTitle: string;
  subtitle: string;
  href: string;
  description: string;
};

export const PORTAL_MODULES: readonly PortalModuleDefinition[] = [
  {
    id: "equipment",
    title: "Equipment Returns",
    shortTitle: "Equipment",
    subtitle: "Returns & Collection",
    href: "/",
    description: "Direct reports, equipment collection, and IT close-out.",
  },
  {
    id: "reconciliation",
    title: "Inventory Reconciliation",
    shortTitle: "Inventory",
    subtitle: "Reconciliation",
    href: "/admin/owner-reconciliation",
    description: "Compare Reftab and NinjaOne ownership and resolve discrepancies.",
  },
  {
    id: "organization-analytics",
    title: "Organization Analytics",
    shortTitle: "Organization",
    subtitle: "Analytics",
    href: "/reports/organization",
    description: "Division, department, headcount, and equipment-value reporting.",
  },
  {
    id: "account-remediation",
    title: "Account Remediation",
    shortTitle: "Account",
    subtitle: "Remediation",
    href: "/modules/account-remediation",
    description: "Report and resolve failed provisioning or account access.",
  },
] as const;

export function getPortalModule(id: string | null | undefined): PortalModuleDefinition | undefined {
  return PORTAL_MODULES.find((module) => module.id === id);
}

export function portalModuleForPath(pathname: string): PortalModuleDefinition {
  if (pathname.startsWith("/admin/owner-reconciliation")) {
    return getPortalModule("reconciliation")!;
  }
  if (pathname.startsWith("/reports/organization")) {
    return getPortalModule("organization-analytics")!;
  }
  if (pathname.startsWith("/modules/account-remediation")) {
    return getPortalModule("account-remediation")!;
  }
  return getPortalModule("equipment")!;
}
