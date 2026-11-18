import { NextResponse } from "next/server";
import { getUserCount } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const initialized = getUserCount() > 0;
    const user = await getCurrentUser();
    return NextResponse.json({ initialized, user });
  } catch (err) {
    console.error("GET /api/auth/status error:", err);
    return NextResponse.json(
      { error: "Failed to check auth status" },
      { status: 500 }
    );
  }
}
