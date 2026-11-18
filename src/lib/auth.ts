import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getUserById, toPublicUser } from "@/lib/db";
import type { PublicUser } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
} from "./auth-token";

const globalForAuth = globalThis as unknown as {
  cachedAuthSecret: string | undefined;
};

export function getAuthSecret(): string {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) {
    return process.env.AUTH_SECRET;
  }
  if (globalForAuth.cachedAuthSecret) {
    return globalForAuth.cachedAuthSecret;
  }

  const dataDir = process.env.DATABASE_URL
    ? path.dirname(process.env.DATABASE_URL)
    : path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const secretPath = path.join(dataDir, ".auth-secret");
  if (fs.existsSync(secretPath)) {
    const existing = fs.readFileSync(secretPath, "utf-8").trim();
    if (existing.length >= 32) {
      globalForAuth.cachedAuthSecret = existing;
      return existing;
    }
  }

  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretPath, generated, { mode: 0o600 });
  globalForAuth.cachedAuthSecret = generated;
  return generated;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const expected = Buffer.from(keyHex, "hex");
    const derived = crypto.scryptSync(password, salt, 64);
    if (expected.length !== derived.length) return false;
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function isHttpsRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  }
  return request.url.startsWith("https://");
}

export async function createSessionCookieValue(user: PublicUser): Promise<string> {
  return signSessionToken(
    {
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    },
    getAuthSecret()
  );
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  request: Request
): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(
  response: NextResponse,
  request: Request
): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token, getAuthSecret());
  if (!payload) return null;

  const user = getUserById(payload.userId);
  if (!user) return null;

  return toPublicUser(user);
}

export async function requireUser(): Promise<
  { user: PublicUser; error?: never } | { user?: never; error: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user };
}

export async function requireAdmin(): Promise<
  { user: PublicUser; error?: never } | { user?: never; error: NextResponse }
> {
  const auth = await requireUser();
  if (auth.error) return auth;
  if (!auth.user.isAdmin) {
    return {
      error: NextResponse.json(
        { error: "Forbidden: Admin access required" },
        { status: 403 }
      ),
    };
  }
  return auth;
}
