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
import { requireUser } from "@/lib/auth";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import {
  fetchYahooQuote,
  fetchFrankfurterFxToEur,
} from "@/lib/quote-provider";
import type { NewForexPairInput } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function buildFullPayload(userId: number) {
  const rawTrades = getAllTrades(userId);
  const quoteMap = getLiveQuoteMap(userId);
  const fxMap = getLiveFxMap(userId);
  const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
  const kpis = computePortfolioKPIs(trades);
  const securities = getAllSecurities(userId);
  const forexPairs = getAllForexPairs(userId);
  return { trades, kpis, securities, forexPairs };
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    return NextResponse.json(buildFullPayload(auth.user.id));
  } catch (error) {
    console.error("GET /api/forex error:", error);
    return NextResponse.json(
      { error: "Failed to fetch forex pairs" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

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

    let pair = upsertForexPair(
      {
        ...body,
        latestRate: Number(body.latestRate) || 1.0,
      },
      auth.user.id
    );

    if (body.syncNow && pair.liveProvider !== "MANUAL") {
      try {
        if (pair.liveProvider === "YAHOO") {
          const q = await fetchYahooQuote(pair.yahooSymbol, false);
          pair =
            updateForexPairById(
              pair.id,
              {
                latestRate: q.regularMarketPrice,
                previousClose: q.previousClose,
                lastUpdated: new Date().toISOString(),
                syncStatus: "OK",
                syncError: null,
              },
              auth.user.id
            ) || pair;
        } else if (pair.liveProvider === "FRANKFURTER") {
          const rate = await fetchFrankfurterFxToEur(
            pair.fromCurrency,
            "latest"
          );
          pair =
            updateForexPairById(
              pair.id,
              {
                latestRate: rate,
                lastUpdated: new Date().toISOString(),
                syncStatus: "OK",
                syncError: null,
              },
              auth.user.id
            ) || pair;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "FX sync failed";
        pair =
          updateForexPairById(
            pair.id,
            {
              syncStatus: "ERROR",
              syncError: msg,
            },
            auth.user.id
          ) || pair;
      }
    }

    return NextResponse.json(
      { pair, ...buildFullPayload(auth.user.id) },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/forex error:", error);
    return NextResponse.json(
      { error: "Failed to create forex pair" },
      { status: 500 }
    );
  }
}

