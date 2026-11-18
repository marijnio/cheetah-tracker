import { NextResponse } from "next/server";
import {
  createUser,
  getAllUsersWithTradeCounts,
  getUserByUsername,
} from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const users = getAllUsersWithTradeCounts();
    return NextResponse.json({ users });
  } catch (err) {
    console.error("GET /api/users error:", err);
    return NextResponse.json(
      { error: "Failed to list users" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
      isAdmin?: boolean;
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

    if (getUserByUsername(username)) {
      return NextResponse.json(
        { error: `Username "${username}" already exists.` },
        { status: 409 }
      );
    }

    const user = createUser({
      username,
      passwordHash: hashPassword(password),
      isAdmin: Boolean(body.isAdmin),
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    console.error("POST /api/users error:", err);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
