import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const STATUS_FILTERS = new Set(["all", "active", "terminated", "review"]);

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function canonicalStatusWhere(status: string): Prisma.DirectoryEmployeeStateWhereInput {
  if (status === "active") {
    return { isActive: true };
  }
  if (status === "terminated") {
    return {
      employmentStatus: "T",
      directoryState: "OFFBOARDING",
    };
  }
  if (status === "review") {
    return { directoryState: "NEEDS_REVIEW" };
  }
  return {};
}

export async function GET(req: NextRequest) {
  if (!(await isCurrentUserAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedStatus = req.nextUrl.searchParams.get("status")?.toLowerCase() ?? "all";
  const status = STATUS_FILTERS.has(requestedStatus) ? requestedStatus : "all";
  const search = req.nextUrl.searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const pageSize = Math.min(
    positiveInteger(req.nextUrl.searchParams.get("pageSize"), PAGE_SIZE_DEFAULT),
    PAGE_SIZE_MAX,
  );
  const requestedPage = positiveInteger(req.nextUrl.searchParams.get("page"), 1);

  const statusWhere = canonicalStatusWhere(status);
  const where: Prisma.DirectoryEmployeeStateWhereInput = {
    ...statusWhere,
    ...(search
      ? {
          OR: [
            { employeeId: { contains: search, mode: "insensitive" } },
            { displayName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { managerEmployeeId: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  try {
    const [total, active, terminated, needsReview, filteredCount, replication] = await Promise.all([
      prisma.directoryEmployeeState.count(),
      prisma.directoryEmployeeState.count({ where: { isActive: true } }),
      prisma.directoryEmployeeState.count({
        where: { employmentStatus: "T", directoryState: "OFFBOARDING" },
      }),
      prisma.directoryEmployeeState.count({ where: { directoryState: "NEEDS_REVIEW" } }),
      prisma.directoryEmployeeState.count({ where }),
      prisma.directoryEmployeeState.aggregate({
        _max: { replicatedAt: true, sourceSyncedAt: true },
      }),
    ]);

    const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const rows = await prisma.directoryEmployeeState.findMany({
      where,
      orderBy: [
        { isActive: "desc" },
        { displayName: "asc" },
        { employeeId: "asc" },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const managerIds = Array.from(
      new Set(rows.map((row) => row.managerEmployeeId).filter((value): value is string => Boolean(value))),
    );
    const managers = managerIds.length
      ? await prisma.directoryEmployeeState.findMany({
          where: { employeeId: { in: managerIds } },
          select: { employeeId: true, displayName: true, email: true, isActive: true },
        })
      : [];
    const managerByEmployeeId = new Map(managers.map((manager) => [manager.employeeId, manager]));

    return NextResponse.json({
      summary: {
        total,
        active,
        terminated,
        needsReview,
        lastReplicatedAt: replication._max.replicatedAt?.toISOString() ?? null,
        latestSourceSyncAt: replication._max.sourceSyncedAt?.toISOString() ?? null,
      },
      rows: rows.map((row) => ({
        ...row,
        terminationDate: row.terminationDate?.toISOString() ?? null,
        sourceSyncedAt: row.sourceSyncedAt?.toISOString() ?? null,
        replicatedAt: row.replicatedAt.toISOString(),
        manager: row.managerEmployeeId
          ? managerByEmployeeId.get(row.managerEmployeeId) ?? null
          : null,
      })),
      pagination: {
        page,
        pageSize,
        pageCount,
        filteredCount,
      },
      filters: {
        status,
        search,
      },
    });
  } catch (error) {
    console.error("[directory] Failed to load directory snapshot", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load directory snapshot" },
      { status: 500 },
    );
  }
}
