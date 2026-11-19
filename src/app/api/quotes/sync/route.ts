import { NextResponse } from "next/server";
import {
  getAllSecurities,
  updateSecurityById,
  getAllForexPairs,
  updateForexPairById,
  getAllTrades,
  getLiveQuoteMap,
  getLiveFxMap,
  getCachedHistoricalFxMap,
  upsertCachedHistoricalFxBatch,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import {
  fetchYahooQuote,
  fetchYahooBatchQuotes,
  fetchFrankfurterFxDetailToEur,
  fetchAllFrankfurterRatesToEur,
  fetchYahooHistoricalFxSeriesToEur,
  getTodayUtcDateStr,
  resolveSeriesRateOnOrBefore,
  subtractDaysUtc,
} from "@/lib/quote-provider";
import { mapToYahooTicker } from "@/lib/ticker-mapper";

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

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      scope?: "OPEN_ONLY" | "ALL_SECURITIES" | "FOREX_ONLY";
      lookupSymbol?: string;
      lookupHistoricalFx?: {
        fromCurrency: string;
        date: string;
        preferLiveForToday?: boolean;
      };
      statelessBatch?: {
        symbols?: string[];
        forexCurrencies?: string[];
      };
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

    // 2. Historical / Same-Day FX lookup (fx_cache + Frankfurter ECB + Yahoo live/fallback)
    if (body.lookupHistoricalFx) {
      const { fromCurrency, date, preferLiveForToday } = body.lookupHistoricalFx;
      const ccy = (fromCurrency || "USD").trim().toUpperCase();
      const todayUtc = getTodayUtcDateStr();
      const targetDate = (date || "latest").trim();

      if (ccy === "EUR") {
        return NextResponse.json({
          rateToEur: 1.0,
          rateDate: targetDate === "latest" || targetDate > todayUtc ? todayUtc : targetDate,
          source: "EUR",
        });
      }

      const userPairs = getAllForexPairs(auth.user.id);
      const matchingPair = userPairs.find(
        (p) => p.fromCurrency.trim().toUpperCase() === ccy
      );
      const yahooSym = matchingPair?.yahooSymbol || `${ccy}EUR=X`;

      // For today/latest/future dates with preferLiveForToday, try live Yahoo quote first
      if (
        (targetDate === "latest" || targetDate >= todayUtc) &&
        preferLiveForToday
      ) {
        if (!matchingPair || matchingPair.liveProvider !== "FRANKFURTER") {
          try {
            const q = await fetchYahooQuote(yahooSym, false);
            return NextResponse.json({
              rateToEur: Number(q.regularMarketPrice.toFixed(6)),
              rateDate: todayUtc,
              source: "YAHOO",
            });
          } catch {
            // Fall through to Frankfurter ECB latest
          }
        }
        const detail = await fetchFrankfurterFxDetailToEur(ccy, "latest");
        return NextResponse.json({
          rateToEur: detail.rateToEur,
          rateDate: detail.rateDate,
          source: "FRANKFURTER",
        });
      }

      // Past date (< todayUtc): check fx_cache first
      if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate) && targetDate < todayUtc) {
        const cached = getCachedHistoricalFxMap([
          { fromCurrency: ccy, requestedDate: targetDate },
        ]);
        const hit = cached[`${ccy}:${targetDate}`];
        if (hit) {
          return NextResponse.json({
            rateToEur: hit.rateToEur,
            rateDate: hit.rateDate,
            source: "CACHE",
          });
        }
      }

      // Fetch from Frankfurter (or Yahoo chart fallback for non-ECB currencies)
      try {
        const detail = await fetchFrankfurterFxDetailToEur(
          ccy,
          targetDate || "latest"
        );
        if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate) && targetDate < todayUtc) {
          upsertCachedHistoricalFxBatch([
            {
              fromCurrency: ccy,
              requestedDate: targetDate,
              rateToEur: detail.rateToEur,
              rateDate: detail.rateDate,
            },
          ]);
        }
        return NextResponse.json({
          rateToEur: detail.rateToEur,
          rateDate: detail.rateDate,
          source: "FRANKFURTER",
        });
      } catch {
        if (/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
          const paddedStart = subtractDaysUtc(
            targetDate > todayUtc ? todayUtc : targetDate,
            10
          );
          const series = await fetchYahooHistoricalFxSeriesToEur(
            yahooSym,
            paddedStart
          );
          const resolved = resolveSeriesRateOnOrBefore(
            series,
            targetDate > todayUtc ? todayUtc : targetDate
          );
          if (resolved) {
            if (targetDate < todayUtc) {
              upsertCachedHistoricalFxBatch([
                {
                  fromCurrency: ccy,
                  requestedDate: targetDate,
                  rateToEur: resolved.rateToEur,
                  rateDate: resolved.effectiveDate,
                },
              ]);
            }
            return NextResponse.json({
              rateToEur: resolved.rateToEur,
              rateDate: resolved.effectiveDate,
              source: "YAHOO",
            });
          }
        }
        throw new Error(`Could not resolve FX rate for ${ccy} on ${targetDate}`);
      }
    }

    // 3. Stateless batch quote & FX sync for browser-local portfolio mode
    if (body.statelessBatch) {
      const symbols = body.statelessBatch.symbols || [];
      const forexCurrencies = body.statelessBatch.forexCurrencies || [];
      const batchResults = await fetchYahooBatchQuotes(symbols);
      let frankfurterMap: Record<string, number> = {};
      if (forexCurrencies.length > 0) {
        try {
          frankfurterMap = await fetchAllFrankfurterRatesToEur(forexCurrencies);
        } catch {
          // Non-blocking fallback
        }
      }
      return NextResponse.json({
        batchResults,
        frankfurterMap,
        timestamp: new Date().toISOString(),
      });
    }

    // 3. Batch sync for Forex pairs + Securities
    const scope = body.scope || "OPEN_ONLY";
    const now = new Date().toISOString();
    let syncedSecurities = 0;
    let syncedForex = 0;
    const errors: Array<{ symbol: string; error: string }> = [];

    const fxPairs = getAllForexPairs(auth.user.id);
    const allSec = getAllSecurities(auth.user.id);
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
        updateForexPairById(
          pair.id,
          {
            latestRate: entry.result.regularMarketPrice,
            previousClose: entry.result.previousClose,
            lastUpdated: now,
            syncStatus: "OK",
            syncError: null,
          },
          auth.user.id
        );
        syncedForex++;
      } else if (ecbRate) {
        updateForexPairById(
          pair.id,
          {
            latestRate: ecbRate,
            lastUpdated: now,
            syncStatus: "OK",
            syncError: null,
          },
          auth.user.id
        );
        syncedForex++;
      } else if (entry?.error) {
        updateForexPairById(
          pair.id,
          {
            syncStatus: "ERROR",
            syncError: entry.error,
          },
          auth.user.id
        );
        errors.push({ symbol: pair.yahooSymbol, error: entry.error });
      }
    }

    // Update Securities
    for (const sec of targetSec) {
      const entry =
        batchResults[sec.ticker.toUpperCase()] ||
        batchResults[sec.ticker];
      if (entry?.result) {
        updateSecurityById(
          sec.id,
          {
            latestPrice: entry.result.regularMarketPrice,
            previousClose: entry.result.previousClose,
            name:
              !sec.name || sec.name === sec.ticker
                ? entry.result.longName || entry.result.shortName || sec.name
                : sec.name,
            lastQuoteAt: now,
            quoteStatus: "OK",
            quoteError: null,
          },
          auth.user.id
        );
        syncedSecurities++;
      } else if (entry?.error) {
        updateSecurityById(
          sec.id,
          {
            quoteStatus: "ERROR",
            quoteError: entry.error,
          },
          auth.user.id
        );
        errors.push({ symbol: sec.ticker, error: entry.error });
      }
    }

    return NextResponse.json({
      syncedSecurities,
      syncedForex,
      errors: errors.length > 0 ? errors : undefined,
      ...buildFullPayload(auth.user.id),
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
