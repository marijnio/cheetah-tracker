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
import { requireUser } from "@/lib/auth";
import { parsePortfolioXml } from "@/lib/portfolio-xml";
import { computePortfolioKPIs, computeTradesWithMetrics } from "@/lib/trade-math";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      xmlContent?: string;
      fileName?: string;
    };

    if (!body.xmlContent || !body.xmlContent.trim()) {
      return NextResponse.json(
        { error: "No XML content provided." },
        { status: 400 }
      );
    }

    const parsed = parsePortfolioXml(
      body.xmlContent,
      body.fileName || "portfolio.xml"
    );

    replacePortfolioForUser(auth.user.id, {
      trades: parsed.trades,
      securities: parsed.securities,
      forexPairs: parsed.forexPairs,
      cashBalance: parsed.cashBalance,
      riskPercent: parsed.riskPercent,
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
          err instanceof Error ? err.message : "Failed to parse or import XML",
      },
      { status: 400 }
    );
  }
}
