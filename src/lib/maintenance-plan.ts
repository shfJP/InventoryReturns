export function maintenancePlan(mode: string) {
  if (!["all", "inventory", "owners", "sync", "directory", "snowflake"].includes(mode)) {
    throw new Error("Expected mode: all, inventory, owners, sync, directory, or snowflake.");
  }
  return {
    directory: ["all", "sync", "directory"].includes(mode),
    inventory: ["all", "sync", "inventory", "owners"].includes(mode),
    owners: ["all", "inventory", "owners"].includes(mode),
    snowflake: ["all", "snowflake"].includes(mode),
  };
}

export async function executeMaintenancePlan(mode: string, tasks: {
  directory: () => Promise<void>;
  reftab: () => Promise<void>;
  ninjaone: () => Promise<void>;
  owners: () => Promise<void>;
  snowflake: () => Promise<void>;
}) {
  const plan = maintenancePlan(mode);
  if (plan.directory) await tasks.directory();
  if (plan.inventory) {
    await tasks.reftab();
    await tasks.ninjaone();
  }
  if (plan.owners) await tasks.owners();
  if (plan.snowflake) await tasks.snowflake();
}
