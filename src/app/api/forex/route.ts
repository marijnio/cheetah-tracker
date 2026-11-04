import { NextResponse } from "next/server";
import {
  getAllForexPairs,
  upsertForexPair,
  updateForexPairById,
  getAllTrades,
  getAllSecurities,
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

export async function GET() {
  try {
    return NextResponse.json(buildFullPayload());
  } catch (error) {
    console.error("GET /api/forex error:", error);
    return NextResponse.json(
      { error: "Failed to fetch forex pairs" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as NewForexPairInput & {
      syncNow?: boolean;
    };

    if (!body.fromCurrency) {
      return NextResponse.json(
        { error: "fromCurrency is required" },
        { status: 400 }
      );
    }

    let pair = upsertForexPair({
      ...body,
      latestRate: Number(body.latestRate) || 1.0,
    });

    if (body.syncNow && pair.liveProvider !== "MANUAL") {
      try {
        if (pair.liveProvider === "YAHOO") {
          const q = await fetchYahooQuote(pair.yahooSymbol, false);
          pair =
            updateForexPairById(pair.id, {
              latestRate: q.regularMarketPrice,
              previousClose: q.previousClose,
              lastUpdated: new Date().toISOString(),
              syncStatus: "OK",
              syncError: null,
            }) || pair;
        } else if (pair.liveProvider === "FRANKFURTER") {
          const rate = await fetchFrankfurterFxToEur(
            pair.fromCurrency,
            "latest"
          );
          pair =
            updateForexPairById(pair.id, {
              latestRate: rate,
              lastUpdated: new Date().toISOString(),
              syncStatus: "OK",
              syncError: null,
            }) || pair;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "FX sync failed";
        pair =
          updateForexPairById(pair.id, {
            syncStatus: "ERROR",
            syncError: msg,
          }) || pair;
      }
    }

    return NextResponse.json({ pair, ...buildFullPayload() }, { status: 201 });
  } catch (error) {
    console.error("POST /api/forex error:", error);
    return NextResponse.json(
      { error: "Failed to create forex pair" },
      { status: 500 }
    );
  }
}

