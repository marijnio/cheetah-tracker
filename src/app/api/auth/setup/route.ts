import { NextResponse } from "next/server";
import { createUser, getUserCount } from "@/lib/db";
import {
  createSessionCookieValue,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (getUserCount() > 0) {
      return NextResponse.json(
        { error: "Setup already completed. Ask an administrator to create an account." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };

    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!/^[a-zA-Z0-9._-]{2,32}$/.test(username)) {
      return NextResponse.json(
        {
          error:
            "Username must be 2-32 characters (letters, numbers, dot, underscore, hyphen).",
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const user = createUser({
      username,
      passwordHash: hashPassword(password),
      isAdmin: true,
    });

    const token = await createSessionCookieValue(user);
    const response = NextResponse.json({ user }, { status: 201 });
    setSessionCookie(response, token, request);
    return response;
  } catch (err) {
    console.error("POST /api/auth/setup error:", err);
    return NextResponse.json(
      { error: "Failed to complete initial setup" },
      { status: 500 }
    );
  }
}
