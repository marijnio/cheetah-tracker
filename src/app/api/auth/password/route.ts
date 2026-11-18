import { NextResponse } from "next/server";
import { getUserById, updateUserPassword } from "@/lib/db";
import { hashPassword, requireUser, verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    const currentPassword = body.currentPassword || "";
    const newPassword = body.newPassword || "";

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const fullUser = getUserById(auth.user.id);
    if (!fullUser || !verifyPassword(currentPassword, fullUser.passwordHash)) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 }
      );
    }

    updateUserPassword(auth.user.id, hashPassword(newPassword));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/auth/password error:", err);
    return NextResponse.json(
      { error: "Failed to update password" },
      { status: 500 }
    );
  }
}
