import assert from "node:assert/strict";
import { test } from "node:test";
import { executeMaintenancePlan, maintenancePlan } from "./maintenance-plan";

test("all and inventory runs refresh inventories before ownership automation", () => {
  assert.deepEqual(maintenancePlan("all"), { directory: true, inventory: true, owners: true, snowflake: true });
  for (const mode of ["inventory", "owners"]) {
    assert.deepEqual(maintenancePlan(mode), { directory: false, inventory: true, owners: true, snowflake: false });
  }
});

test("maintenance refreshes sources in order before writing owners", async () => {
  const calls: string[] = [];
  const task = (name: string) => async () => { calls.push(name); };
  await executeMaintenancePlan("all", {
    directory: task("directory"), reftab: task("reftab"), ninjaone: task("ninjaone"),
    owners: task("owners"), snowflake: task("snowflake"),
  });
  assert.deepEqual(calls, ["directory", "reftab", "ninjaone", "owners", "snowflake"]);
});

for (const failing of ["reftab", "ninjaone"]) {
  test(`${failing} sync failure prevents automatic owner writes`, async () => {
    const calls: string[] = [];
    const task = (name: string) => async () => {
      calls.push(name);
      if (name === failing) throw new Error("source unavailable");
    };
    await assert.rejects(executeMaintenancePlan("inventory", {
      directory: task("directory"), reftab: task("reftab"), ninjaone: task("ninjaone"),
      owners: task("owners"), snowflake: task("snowflake"),
    }), /source unavailable/);
    assert.ok(!calls.includes("owners"));
  });
}
test("sync-only and individual scheduled tasks do not change ownership", () => {
  assert.deepEqual(maintenancePlan("sync"), { directory: true, inventory: true, owners: false, snowflake: false });
  assert.deepEqual(maintenancePlan("directory"), { directory: true, inventory: false, owners: false, snowflake: false });
  assert.deepEqual(maintenancePlan("snowflake"), { directory: false, inventory: false, owners: false, snowflake: true });
  assert.throws(() => maintenancePlan("inventroy"), /Expected mode/);
});
