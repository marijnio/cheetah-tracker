import { NextResponse } from "next/server";
import { getUserByUsername, toPublicUser } from "@/lib/db";
import {
  createSessionCookieValue,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 }
      );
    }

    const userRecord = getUserByUsername(username);
    if (!userRecord || !verifyPassword(password, userRecord.passwordHash)) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401 }
      );
    }

    const publicUser = toPublicUser(userRecord);
    const token = await createSessionCookieValue(publicUser);
    const response = NextResponse.json({ user: publicUser });
    setSessionCookie(response, token, request);
    return response;
  } catch (err) {
    console.error("POST /api/auth/login error:", err);
    return NextResponse.json(
      { error: "Failed to sign in" },
      { status: 500 }
    );
  }
}
