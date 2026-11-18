import { NextResponse } from "next/server";
import { updateUserPreferences } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      cashBalance?: number;
      riskPercent?: number;
    };

    const cashBalance =
      body.cashBalance !== undefined ? Number(body.cashBalance) : undefined;
    const riskPercent =
      body.riskPercent !== undefined ? Number(body.riskPercent) : undefined;

    if (cashBalance !== undefined && (Number.isNaN(cashBalance) || cashBalance < 0)) {
      return NextResponse.json(
        { error: "Cash balance must be a non-negative number." },
        { status: 400 }
      );
    }
    if (
      riskPercent !== undefined &&
      (Number.isNaN(riskPercent) || riskPercent <= 0 || riskPercent > 100)
    ) {
      return NextResponse.json(
        { error: "Risk percent must be between 0 and 100." },
        { status: 400 }
      );
    }

    const updated = updateUserPreferences(auth.user.id, {
      cashBalance,
      riskPercent,
    });
    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error("PATCH /api/portfolio/preferences error:", err);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}
