import { prisma } from "../src/lib/db";

async function main(): Promise<void> {
  const demoEmployeeIds = Array.from({ length: 25 }, (_, i) => `EMP${String(i + 1).padStart(3, "0")}`);

  const collectionEvents = await prisma.collectionEvent.deleteMany({
    where: { assetTag: { startsWith: "AST-EMP" } },
  });
  const unresolved = await prisma.unresolvedCollection.deleteMany({
    where: {
      OR: [
        { assetTag: { startsWith: "AST-EMP" } },
        { employeeEmail: { endsWith: "@company.com" } },
      ],
    },
  });
  const equipment = await prisma.equipmentAssignment.deleteMany({
    where: { assetTag: { startsWith: "AST-EMP" } },
  });
  const users = await prisma.user.deleteMany({
    where: {
      employeeId: { in: demoEmployeeIds },
      email: { endsWith: "@company.com" },
    },
  });

  console.info(
    `[cleanup] Demo data removed: users=${users.count}, equipment=${equipment.count}, collectionEvents=${collectionEvents.count}, unresolved=${unresolved.count}.`
  );
}

main()
  .catch((e) => {
    console.error(`[cleanup] Demo cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
