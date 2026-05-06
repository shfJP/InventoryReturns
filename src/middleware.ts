import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/auth/config"];

function getPublicOrigin(req: NextRequest): string {
  const configuredOrigin = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (configuredOrigin) return configuredOrigin;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}`;
  }

  return req.nextUrl.origin;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const ssoConfigured =
    !!(process.env.AZURE_AD_TENANT_ID?.trim()) &&
    !!(process.env.AZURE_AD_CLIENT_ID?.trim()) &&
    !!(process.env.AZURE_AD_CLIENT_SECRET?.trim()) &&
    !!(process.env.NEXTAUTH_SECRET?.trim());

  if (!ssoConfigured) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    const loginUrl = new URL("/login", getPublicOrigin(req));
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
