import type { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { prisma } from "./db";

const TENANT_ID = (process.env.AZURE_AD_TENANT_ID ?? "").trim();
const CLIENT_ID = (process.env.AZURE_AD_CLIENT_ID ?? "").trim();
const CLIENT_SECRET = (process.env.AZURE_AD_CLIENT_SECRET ?? "").trim();

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getGroupsFromClaims(claims: Record<string, unknown> | null): string[] {
  const groups = claims?.groups;
  if (!Array.isArray(groups)) return [];
  return groups.filter((group): group is string => typeof group === "string");
}

export function isSSOConfigured(): boolean {
  return !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && process.env.NEXTAUTH_SECRET);
}

export const authOptions: NextAuthOptions = {
  providers: [
    ...(isSSOConfigured()
      ? [
          AzureADProvider({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            tenantId: TENANT_ID,
            authorization: {
              params: {
                scope: "openid profile email User.Read",
              },
            },
            profile(profile) {
              return {
                id: profile.sub ?? profile.oid,
                name: profile.name,
                email: profile.email ?? profile.preferred_username,
                oid: profile.oid,
                employeeId: profile.employeeId ?? null,
                upn: profile.preferred_username ?? profile.upn ?? null,
              };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, profile, account }) {
      if (account?.access_token) {
        (token as Record<string, unknown>).accessToken = account.access_token;
      }
      const tokenClaims = decodeJwtPayload(account?.id_token);
      const groups = getGroupsFromClaims(tokenClaims);
      if (groups.length > 0) {
        (token as Record<string, unknown>).groups = groups;
      }
      if (profile) {
        const azureProfile = profile as Record<string, unknown>;
        token.oid = (azureProfile.oid as string) ?? undefined;
        token.upn =
          (azureProfile.preferred_username as string) ??
          (azureProfile.upn as string) ??
          undefined;
        token.employeeId = (azureProfile.employeeId as string) ?? undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).oid = token.oid;
        (session.user as Record<string, unknown>).upn = token.upn;
        (session.user as Record<string, unknown>).employeeId = token.employeeId;
      }
      return session;
    },
    async signIn({ profile }) {
      if (!profile) return true;
      const azureProfile = profile as Record<string, unknown>;
      const upn =
        (azureProfile.preferred_username as string) ??
        (azureProfile.upn as string) ??
        "";
      const employeeId = (azureProfile.employeeId as string) ?? upn;
      if (!employeeId) return true;

      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            { employeeId },
            { upn },
            { email: upn },
          ],
        },
      });

      if (!existing) {
        await prisma.user.create({
          data: {
            employeeId,
            displayName: (azureProfile.name as string) ?? employeeId,
            email: (azureProfile.email as string) ?? upn,
            upn,
          },
        });
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
};
