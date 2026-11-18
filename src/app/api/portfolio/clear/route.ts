import { NextResponse } from "next/server";
import {
  clearPortfolioForUser,
  getAllForexPairs,
  getAllSecurities,
  getAllTrades,
  getLiveFxMap,
  getLiveQuoteMap,
  getUserById,
  toPublicUser,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computePortfolioKPIs, computeTradesWithMetrics } from "@/lib/trade-math";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      confirmUsername?: string;
    };

    if (
      (body.confirmUsername || "").trim().toLowerCase() !==
      auth.user.username.toLowerCase()
    ) {
      return NextResponse.json(
        {
          error: `Confirmation failed. Type your username "${auth.user.username}" to clear your portfolio.`,
        },
        { status: 400 }
      );
    }

    clearPortfolioForUser(auth.user.id);

    const rawTrades = getAllTrades(auth.user.id);
    const quoteMap = getLiveQuoteMap(auth.user.id);
    const fxMap = getLiveFxMap(auth.user.id);
    const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
    const kpis = computePortfolioKPIs(trades);
    const securities = getAllSecurities(auth.user.id);
    const forexPairs = getAllForexPairs(auth.user.id);
    const updatedUser = toPublicUser(getUserById(auth.user.id)!);

    return NextResponse.json({
      trades,
      kpis,
      securities,
      forexPairs,
      user: updatedUser,
    });
  } catch (err) {
    console.error("POST /api/portfolio/clear error:", err);
    return NextResponse.json(
      { error: "Failed to clear portfolio" },
      { status: 500 }
    );
  }
}
