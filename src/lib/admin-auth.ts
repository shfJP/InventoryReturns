import type { NextRequest } from "next/server";
import { getAccessProfile } from "./access-control";

export async function isCurrentUserAdmin(req: NextRequest): Promise<boolean> {
  return (await getAccessProfile(req))?.isAdmin ?? false;
}
