import { NextResponse } from "next/server";
import {
  getForexPairById,
  updateForexPairById,
  deleteForexPairById,
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import {
  fetchYahooQuote,
  fetchFrankfurterFxToEur,
} from "@/lib/quote-provider";
import type { NewForexPairInput } from "@/lib/db/schema";

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
    const fxId = Number(id);
    if (Number.isNaN(fxId)) {
      return NextResponse.json({ error: "Invalid forex ID" }, { status: 400 });
    }

    const body = (await request.json()) as Partial<NewForexPairInput> & {
      syncNow?: boolean;
    };

    let pair = getForexPairById(fxId);
    if (!pair) {
      return NextResponse.json(
        { error: "Forex pair not found" },
        { status: 404 }
      );
    }

    if (Object.keys(body).some((k) => k !== "syncNow")) {
      pair = updateForexPairById(fxId, {
        ...body,
        syncStatus:
          body.liveProvider === "MANUAL" ? "MANUAL" : pair.syncStatus,
      });
    }

    if (body.syncNow && pair) {
      try {
        if (pair.liveProvider === "YAHOO") {
          const q = await fetchYahooQuote(pair.yahooSymbol, false);
          pair = updateForexPairById(fxId, {
            latestRate: q.regularMarketPrice,
            previousClose: q.previousClose,
            lastUpdated: new Date().toISOString(),
            syncStatus: "OK",
            syncError: null,
          });
        } else if (pair.liveProvider === "FRANKFURTER") {
          const rate = await fetchFrankfurterFxToEur(
            pair.fromCurrency,
            "latest"
          );
          pair = updateForexPairById(fxId, {
            latestRate: rate,
            lastUpdated: new Date().toISOString(),
            syncStatus: "OK",
            syncError: null,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "FX sync failed";
        pair = updateForexPairById(fxId, {
          syncStatus: "ERROR",
          syncError: msg,
        });
      }
    }

    return NextResponse.json({ pair, ...buildFullPayload() });
  } catch (error) {
    console.error("PATCH /api/forex/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update forex pair" },
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
    const fxId = Number(id);
    if (Number.isNaN(fxId)) {
      return NextResponse.json({ error: "Invalid forex ID" }, { status: 400 });
    }

    const deleted = deleteForexPairById(fxId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Forex pair not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true, ...buildFullPayload() });
  } catch (error) {
    console.error("DELETE /api/forex/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete forex pair" },
      { status: 500 }
    );
  }
}

