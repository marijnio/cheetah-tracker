import { NextResponse } from "next/server";
import {
  getAllForexPairs,
  getAllSecurities,
  getAllTrades,
  getLiveFxMap,
  getLiveQuoteMap,
  getUserById,
  replacePortfolioForUser,
  toPublicUser,
} from "@/lib/db";
import type {
  ForexPairRecord,
  SecurityRecord,
  TradeRecord,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { computePortfolioKPIs, computeTradesWithMetrics } from "@/lib/trade-math";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      trades?: TradeRecord[];
      securities?: SecurityRecord[];
      forexPairs?: ForexPairRecord[];
      cashBalance?: number;
      riskPercent?: number;
    };

    if (!Array.isArray(body.trades)) {
      return NextResponse.json(
        { error: "Invalid portfolio payload: trades array is required." },
        { status: 400 }
      );
    }

    replacePortfolioForUser(auth.user.id, {
      trades: body.trades,
      securities: Array.isArray(body.securities) ? body.securities : [],
      forexPairs: Array.isArray(body.forexPairs) ? body.forexPairs : [],
      cashBalance:
        typeof body.cashBalance === "number" && !Number.isNaN(body.cashBalance)
          ? body.cashBalance
          : 25000,
      riskPercent:
        typeof body.riskPercent === "number" && !Number.isNaN(body.riskPercent)
          ? body.riskPercent
          : 1.0,
    });

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
      importedCount: trades.length,
    });
  } catch (err) {
    console.error("POST /api/portfolio/import-xml error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to import portfolio",
      },
      { status: 400 }
    );
  }
}
