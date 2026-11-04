import { NextResponse } from "next/server";
import {
  getAllSecurities,
  updateSecurityById,
  getAllForexPairs,
  updateForexPairById,
  getAllTrades,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/sepa-math";
import {
  fetchYahooQuote,
  fetchYahooBatchQuotes,
  fetchFrankfurterFxToEur,
  fetchAllFrankfurterRatesToEur,
} from "@/lib/quote-provider";
import { mapToYahooTicker } from "@/lib/ticker-mapper";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scope?: "OPEN_ONLY" | "ALL_SECURITIES" | "FOREX_ONLY";
      lookupSymbol?: string;
      lookupHistoricalFx?: { fromCurrency: string; date: string };
    };

    // 1. Single symbol metadata lookup (used in Security Modal / Trade Modal)
    if (body.lookupSymbol) {
      const mapped = mapToYahooTicker(body.lookupSymbol);
      const quote = await fetchYahooQuote(mapped.yahooTicker, true);
      const resolvedTicker = quote.symbol || mapped.yahooTicker;
      return NextResponse.json({
        lookup: {
          ticker: resolvedTicker,
          symbol: resolvedTicker,
          name: quote.longName || quote.shortName || mapped.symbol,
          gicsSector: quote.sector || "Uncategorized",
          currency: quote.currency || mapped.inferredCurrency,
          latestPrice: quote.regularMarketPrice,
          previousClose: quote.previousClose,
          exchangeName: quote.exchangeName,
        },
      });
    }

    // 2. Historical FX lookup on a specific End Date (Frankfurter ECB)
    if (body.lookupHistoricalFx) {
      const { fromCurrency, date } = body.lookupHistoricalFx;
      const rate = await fetchFrankfurterFxToEur(
        fromCurrency,
        date || "latest"
      );
      return NextResponse.json({ rateToEur: rate });
    }

    // 3. Batch sync for Forex pairs + Securities
    const scope = body.scope || "OPEN_ONLY";
    const now = new Date().toISOString();
    let syncedSecurities = 0;
    let syncedForex = 0;
    const errors: Array<{ symbol: string; error: string }> = [];

    const fxPairs = getAllForexPairs();
    const allSec = getAllSecurities();
    const targetSec =
      scope === "FOREX_ONLY"
        ? []
        : allSec.filter((s) => {
          if (s.quoteProvider === "MANUAL") return false;
          if (scope === "OPEN_ONLY") return (s.openTradeCount ?? 0) > 0;
          return true;
        });

    // Collect symbols
    const yahooFxPairs = fxPairs.filter((p) => p.liveProvider === "YAHOO");
    const symbolsToBatch = [
      ...targetSec.map((s) => s.ticker),
      ...yahooFxPairs.map((p) => p.yahooSymbol),
    ];

    const batchResults = await fetchYahooBatchQuotes(symbolsToBatch);

    // Also fetch Frankfurter ECB rates in 1 request as backup for Forex pairs
    let frankfurterMap: Record<string, number> = {};
    try {
      frankfurterMap = await fetchAllFrankfurterRatesToEur(
        fxPairs.map((p) => p.fromCurrency)
      );
    } catch {
      // Non-blocking
    }

    // Update Forex pairs
    for (const pair of fxPairs) {
      if (pair.liveProvider === "MANUAL") continue;
      const entry =
        batchResults[pair.yahooSymbol.toUpperCase()] ||
        batchResults[pair.yahooSymbol];
      const ecbRate = frankfurterMap[pair.fromCurrency.toUpperCase()];

      if (entry?.result) {
        updateForexPairById(pair.id, {
          latestRate: entry.result.regularMarketPrice,
          previousClose: entry.result.previousClose,
          lastUpdated: now,
          syncStatus: "OK",
          syncError: null,
        });
        syncedForex++;
      } else if (ecbRate) {
        updateForexPairById(pair.id, {
          latestRate: ecbRate,
          lastUpdated: now,
          syncStatus: "OK",
          syncError: null,
        });
        syncedForex++;
      } else if (entry?.error) {
        updateForexPairById(pair.id, {
          syncStatus: "ERROR",
          syncError: entry.error,
        });
        errors.push({ symbol: pair.yahooSymbol, error: entry.error });
      }
    }

    // Update Securities
    for (const sec of targetSec) {
      const entry =
        batchResults[sec.ticker.toUpperCase()] ||
        batchResults[sec.ticker];
      if (entry?.result) {
        updateSecurityById(sec.id, {
          latestPrice: entry.result.regularMarketPrice,
          previousClose: entry.result.previousClose,
          name:
            !sec.name || sec.name === sec.ticker
              ? entry.result.longName || entry.result.shortName || sec.name
              : sec.name,
          lastQuoteAt: now,
          quoteStatus: "OK",
          quoteError: null,
        });
        syncedSecurities++;
      } else if (entry?.error) {
        updateSecurityById(sec.id, {
          quoteStatus: "ERROR",
          quoteError: entry.error,
        });
        errors.push({ symbol: sec.ticker, error: entry.error });
      }
    }

    return NextResponse.json({
      syncedSecurities,
      syncedForex,
      errors: errors.length > 0 ? errors : undefined,
      ...buildFullPayload(),
    });
  } catch (error) {
    console.error("POST /api/quotes/sync error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to sync quotes",
      },
      { status: 500 }
    );
  }
}
