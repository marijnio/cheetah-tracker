import { NextResponse } from "next/server";
import {
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  createTrade,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import type { NewTradeInput } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function buildFullPayload() {
  const rawTrades = getAllTrades();
  const quoteMap = getLiveQuoteMap();
  const fxMap = getLiveFxMap();
  const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
  const kpis = computePortfolioKPIs(trades);
  const securities = getAllSecurities();
  const forexPairs = getAllForexPairs();
  return { trades, kpis, securities, forexPairs };
}

export async function GET() {
  try {
    return NextResponse.json(buildFullPayload());
  } catch (error) {
    console.error("GET /api/trades error:", error);
    return NextResponse.json(
      { error: "Failed to fetch trades" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as NewTradeInput;

    if (
      !body.ticker ||
      !body.startDate ||
      body.shares === undefined ||
      body.buyPrice === undefined ||
      body.initialStopLoss === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required trade fields (ticker, startDate, shares, buyPrice, initialStopLoss)",
        },
        { status: 400 }
      );
    }

    const created = createTrade({
      securityId: body.securityId ?? null,
      ticker: body.ticker,
      gicsSector: body.gicsSector || "Uncategorized",
      startDate: body.startDate,
      endDate: body.endDate || null,
      shares: Number(body.shares),
      buyPrice: Number(body.buyPrice),
      sellPrice:
        body.sellPrice !== null &&
          body.sellPrice !== undefined &&
          String(body.sellPrice) !== ""
          ? Number(body.sellPrice)
          : null,
      currency: body.currency || "USD",
      initialStopLoss: Number(body.initialStopLoss),
      stopMoved: Boolean(body.stopMoved),
      trimmedAt2R: Boolean(body.trimmedAt2R),
      manualLatestPrice:
        body.manualLatestPrice !== null &&
          body.manualLatestPrice !== undefined &&
          String(body.manualLatestPrice) !== ""
          ? Number(body.manualLatestPrice)
          : null,
      fxRateToEur:
        body.fxRateToEur !== undefined && body.fxRateToEur !== null
          ? Number(body.fxRateToEur)
          : undefined,
      notes: body.notes || null,
    });

    return NextResponse.json(
      { created, ...buildFullPayload() },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/trades error:", error);
    return NextResponse.json(
      { error: "Failed to create trade" },
      { status: 500 }
    );
  }
}
