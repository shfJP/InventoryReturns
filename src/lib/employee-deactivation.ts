import { prisma } from "./db";

type EmployeeForCollectionReview = {
  id: string;
  employeeId: string;
  displayName: string;
  email: string;
  managerId: string | null;
  manager: {
    employeeId: string;
    displayName: string;
    email: string;
  } | null;
};

/**
 * Snapshot equipment assigned to employees who are transitioning to inactive.
 * Keeping this in one helper ensures Graph and database-backed directory syncs
 * produce the same unresolved-collection records.
 */
export async function recordUnresolvedCollectionsForEmployees(
  employeeIds: string[],
  now: Date,
  source = "directory_sync",
): Promise<number> {
  if (employeeIds.length === 0) return 0;

  const uniqueEmployeeIds = Array.from(new Set(employeeIds));
  const users: EmployeeForCollectionReview[] = [];

  // Keep each IN predicate comfortably below database/driver parameter limits.
  for (let i = 0; i < uniqueEmployeeIds.length; i += 500) {
    users.push(...await prisma.user.findMany({
      where: {
        employeeId: { in: uniqueEmployeeIds.slice(i, i + 500) },
      },
      select: {
        id: true,
        employeeId: true,
        displayName: true,
        email: true,
        managerId: true,
        manager: {
          select: {
            employeeId: true,
            displayName: true,
            email: true,
          },
        },
      },
    }));
  }

  let logged = 0;
  for (const user of users) {
    const assignedItems = await prisma.equipmentAssignment.findMany({
      where: { assignedToEmployeeId: user.employeeId },
      select: { assetTag: true, catName: true, serial: true, model: true },
    });
    if (assignedItems.length === 0) continue;

    const collectionEvents = await prisma.collectionEvent.findMany({
      where: {
        assignedToEmployeeId: user.employeeId,
        status: { in: ["COLLECTED_PENDING_IT", "CLOSED_OUT"] },
      },
      select: { assetTag: true },
    });
    const collectedAssetTags = new Set(collectionEvents.map((event) => event.assetTag));
    const collectedAssetTagList = Array.from(collectedAssetTags);

    for (let i = 0; i < collectedAssetTagList.length; i += 500) {
      await prisma.unresolvedCollection.updateMany({
        where: {
          status: "UNRESOLVED",
          employeeId: user.employeeId,
          assetTag: { in: collectedAssetTagList.slice(i, i + 500) },
        },
        data: {
          status: "RESOLVED",
          resolvedAt: now,
        },
      });
    }

    for (const item of assignedItems) {
      if (collectedAssetTags.has(item.assetTag)) continue;

      const unresolvedData = {
        employeeName: user.displayName,
        employeeEmail: user.email,
        managerId: user.managerId,
        managerEmployeeId: user.manager?.employeeId ?? null,
        managerName: user.manager?.displayName ?? null,
        managerEmail: user.manager?.email ?? null,
        catName: item.catName,
        serial: item.serial,
        model: item.model,
        source,
      };
      const existing = await prisma.unresolvedCollection.findFirst({
        where: {
          employeeId: user.employeeId,
          assetTag: item.assetTag,
          status: { not: "RESOLVED" },
        },
        select: { id: true },
      });

      if (existing) {
        await prisma.unresolvedCollection.update({
          where: { id: existing.id },
          data: unresolvedData,
        });
      } else {
        await prisma.unresolvedCollection.upsert({
          where: {
            employeeId_assetTag_status: {
              employeeId: user.employeeId,
              assetTag: item.assetTag,
              status: "UNRESOLVED",
            },
          },
          update: unresolvedData,
          create: {
            employeeId: user.employeeId,
            assetTag: item.assetTag,
            status: "UNRESOLVED",
            ...unresolvedData,
          },
        });
      }
      logged++;
    }
  }

  return logged;
}
