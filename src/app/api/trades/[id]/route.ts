import { NextResponse } from "next/server";
import {
  updateTrade,
  deleteTrade,
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const tradeId = Number(id);
    if (Number.isNaN(tradeId)) {
      return NextResponse.json({ error: "Invalid trade ID" }, { status: 400 });
    }

    const body = (await request.json()) as Partial<NewTradeInput>;
    const updated = updateTrade(tradeId, body);

    if (!updated) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    return NextResponse.json({ updated, ...buildFullPayload() });
  } catch (error) {
    console.error("PATCH /api/trades/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update trade" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const tradeId = Number(id);
    if (Number.isNaN(tradeId)) {
      return NextResponse.json({ error: "Invalid trade ID" }, { status: 400 });
    }

    const deleted = deleteTrade(tradeId);
    if (!deleted) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, ...buildFullPayload() });
  } catch (error) {
    console.error("DELETE /api/trades/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete trade" },
      { status: 500 }
    );
  }
}
