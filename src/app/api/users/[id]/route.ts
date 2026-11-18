import { NextResponse } from "next/server";
import {
  deleteUserById,
  getUserById,
  toPublicUser,
  updateUserAdminStatus,
  updateUserPassword,
} from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const targetId = Number(id);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const target = getUserById(targetId);
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = (await request.json()) as {
      newPassword?: string;
      isAdmin?: boolean;
    };

    if (body.newPassword !== undefined) {
      if (body.newPassword.length < 6) {
        return NextResponse.json(
          { error: "Password must be at least 6 characters." },
          { status: 400 }
        );
      }
      updateUserPassword(targetId, hashPassword(body.newPassword));
    }

    if (body.isAdmin !== undefined) {
      if (targetId === auth.user.id && !body.isAdmin) {
        return NextResponse.json(
          { error: "You cannot remove your own admin privileges." },
          { status: 400 }
        );
      }
      updateUserAdminStatus(targetId, Boolean(body.isAdmin));
    }

    const updated = getUserById(targetId)!;
    return NextResponse.json({ user: toPublicUser(updated) });
  } catch (err) {
    console.error("PATCH /api/users/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const { id } = await context.params;
    const targetId = Number(id);
    if (Number.isNaN(targetId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    if (targetId === auth.user.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const deleted = deleteUserById(targetId);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to delete user" },
      { status: 500 }
    );
  }
}
