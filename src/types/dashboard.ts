export type Staff = {
  employeeId: string;
  displayName: string;
  email: string;
  isActive?: boolean;
};

export type Equipment = {
  id: string | null;
  assetTag: string;
  aid?: string;
  serial?: string;
  model?: string;
  title?: string;
  catName?: string;
  locationName?: string;
  statusName?: string;
  details?: Record<string, string>;
  assignedToEmployeeId: string;
  source: string;
  collectionStatus?: "assigned" | "collected" | "outstanding";
};

export type Me = { employeeId: string; displayName: string; email: string; isManager: boolean };

export type DashboardData = {
  me: Me;
  staff: Staff[];
  equipment: Equipment[];
  equipmentByEmployee: Record<string, Equipment[]>;
  syncStatus?: {
    lastSyncedAt: string | null;
    reftabSyncedAt: string | null;
    entraSyncedAt: string | null;
  };
};
