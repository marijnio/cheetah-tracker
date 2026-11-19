import { NextResponse } from "next/server";
import {
  getAllForexPairs,
  getAllSecurities,
  getAllTrades,
  getCachedHistoricalFxMap,
  getLiveFxMap,
  getLiveQuoteMap,
  upsertCachedHistoricalFxBatch,
  updateForexPairById,
  bulkUpdateTradeFxRates,
  type BulkTradeFxUpdateItem,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computePortfolioKPIs, computeTradesWithMetrics } from "@/lib/trade-math";
import {
  fetchAllFrankfurterRatesToEur,
  fetchFrankfurterFxDetailToEur,
  fetchFrankfurterTimeSeriesToEur,
  fetchYahooBatchQuotes,
  getTodayUtcDateStr,
  resolveSeriesRateOnOrBefore,
} from "@/lib/quote-provider";

export const dynamic = "force-dynamic";

const DIFF_EPS = 0.00005;

interface SyncTradesFxBody {
  mode?: "preview" | "apply";
  includeLive?: boolean;
  includeEntryFx?: boolean;
  includeExitFx?: boolean;
  selectedTradeIds?: number[];
}

export interface LivePairChangeItem {
  pairId: number;
  fromCurrency: string;
  pairLabel: string;
  oldRate: number;
  newRate: number;
  previousClose: number | null;
  source: "YAHOO" | "FRANKFURTER";
  statusChange?: string;
}

export interface TradeFxFieldChange {
  oldRate: number;
  newRate: number;
  effectiveDate: string;
  source: "YAHOO" | "FRANKFURTER" | "CACHE";
}

export interface TradeFxChangeItem {
  tradeId: number;
  ticker: string;
  currency: string;
  isOpen: boolean;
  startDate: string;
  endDate: string | null;
  entryChange?: TradeFxFieldChange;
  exitChange?: TradeFxFieldChange & { kind: "EXIT" | "LIVE" };
  oldPnlEur: number;
  newPnlEur: number;
  pnlDeltaEur: number;
}

function isIsoDate(val: string | null | undefined): val is string {
  return Boolean(val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim()));
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => ({}))) as SyncTradesFxBody;
    const mode = body.mode === "apply" ? "apply" : "preview";
    const includeLive = body.includeLive !== false;
    const includeEntryFx = body.includeEntryFx !== false;
    const includeExitFx = body.includeExitFx !== false;
    const selectedSet = Array.isArray(body.selectedTradeIds)
      ? new Set(body.selectedTradeIds.map(Number).filter((n) => !Number.isNaN(n)))
      : null;

    const userId = auth.user.id;
    const fxPairs = getAllForexPairs(userId);
    const rawTrades = getAllTrades(userId);
    const quoteMap = getLiveQuoteMap(userId);
    const currentLiveFxMap = getLiveFxMap(userId);
    const todayStr = getTodayUtcDateStr();

    const warnings: string[] = [];
    const fxPairByCurrency = new Map(
      fxPairs.map((p) => [p.fromCurrency.trim().toUpperCase(), p])
    );
    const yahooSymbolByCurrency: Record<string, string> = {};
    for (const pair of fxPairs) {
      yahooSymbolByCurrency[pair.fromCurrency.trim().toUpperCase()] =
        pair.yahooSymbol;
    }

    const nonEurTrades = rawTrades.filter(
      (t) => (t.currency || "USD").trim().toUpperCase() !== "EUR"
    );

    const hasSameDayOrFutureEntry =
      includeEntryFx &&
      nonEurTrades.some((t) => !isIsoDate(t.startDate) || t.startDate >= todayStr);
    const hasSameDayOrFutureExit =
      includeExitFx &&
      nonEurTrades.some((t) => Boolean(t.endDate && t.endDate >= todayStr));

    // 1. Resolve live FX rates (for Live pairs, open trades, and today's trades)
    const resolvedLiveMap: Record<
      string,
      { rate: number; previousClose: number | null; source: "YAHOO" | "FRANKFURTER" }
    > = {};
    const livePairChanges: LivePairChangeItem[] = [];

    if (includeLive || hasSameDayOrFutureEntry || hasSameDayOrFutureExit) {
      const nonManualPairs = fxPairs.filter((p) => p.liveProvider !== "MANUAL");
      const yahooPairs = nonManualPairs.filter((p) => p.liveProvider === "YAHOO");
      const extraTradeCurrencies = Array.from(
        new Set(
          nonEurTrades
            .map((t) => (t.currency || "USD").trim().toUpperCase())
            .filter((ccy) => ccy && ccy !== "EUR" && !fxPairByCurrency.has(ccy))
        )
      );

      const yahooBatchSymbols = [
        ...yahooPairs.map((p) => p.yahooSymbol),
        ...extraTradeCurrencies.map((ccy) => `${ccy}EUR=X`),
      ];

      let batchResults: Awaited<ReturnType<typeof fetchYahooBatchQuotes>> = {};
      if (yahooBatchSymbols.length > 0) {
        try {
          batchResults = await fetchYahooBatchQuotes(yahooBatchSymbols);
        } catch {
          // Will fall back to Frankfurter below
        }
      }

      const allLiveCurrencies = Array.from(
        new Set([
          ...nonManualPairs.map((p) => p.fromCurrency.trim().toUpperCase()),
          ...extraTradeCurrencies,
        ])
      );
      let frankfurterLiveMap: Record<string, number> = {};
      if (allLiveCurrencies.length > 0) {
        try {
          frankfurterLiveMap = await fetchAllFrankfurterRatesToEur(
            allLiveCurrencies
          );
        } catch {
          // Non-blocking fallback
        }
      }

      for (const pair of nonManualPairs) {
        const ccy = pair.fromCurrency.trim().toUpperCase();
        const entry =
          batchResults[pair.yahooSymbol.toUpperCase()] ||
          batchResults[pair.yahooSymbol];
        const ecbRate = frankfurterLiveMap[ccy];

        let resolved:
          | { rate: number; previousClose: number | null; source: "YAHOO" | "FRANKFURTER" }
          | undefined;

        if (pair.liveProvider === "YAHOO") {
          if (entry?.result) {
            resolved = {
              rate: Number(entry.result.regularMarketPrice.toFixed(6)),
              previousClose: entry.result.previousClose ?? null,
              source: "YAHOO",
            };
          } else if (ecbRate) {
            resolved = {
              rate: ecbRate,
              previousClose: pair.previousClose ?? null,
              source: "FRANKFURTER",
            };
          }
        } else if (pair.liveProvider === "FRANKFURTER") {
          if (ecbRate) {
            resolved = {
              rate: ecbRate,
              previousClose: pair.previousClose ?? null,
              source: "FRANKFURTER",
            };
          } else if (entry?.result) {
            resolved = {
              rate: Number(entry.result.regularMarketPrice.toFixed(6)),
              previousClose: entry.result.previousClose ?? null,
              source: "YAHOO",
            };
          }
        }

        if (resolved) {
          resolvedLiveMap[ccy] = resolved;
          const needsRefresh =
            pair.syncStatus !== "OK" ||
            !pair.lastUpdated ||
            Math.abs(resolved.rate - pair.latestRate) >= DIFF_EPS;

          if (includeLive && needsRefresh) {
            livePairChanges.push({
              pairId: pair.id,
              fromCurrency: ccy,
              pairLabel: pair.pairLabel,
              oldRate: pair.latestRate,
              newRate: resolved.rate,
              previousClose: resolved.previousClose,
              source: resolved.source,
              statusChange:
                pair.syncStatus !== "OK"
                  ? `${pair.syncStatus} → OK`
                  : !pair.lastUpdated
                    ? "PENDING → OK"
                    : undefined,
            });
          }
        } else if (includeLive) {
          warnings.push(
            `Could not refresh live FX rate for ${pair.pairLabel}${
              entry?.error ? ` (${entry.error})` : ""
            }.`
          );
        }
      }

      for (const ccy of extraTradeCurrencies) {
        const sym = `${ccy}EUR=X`;
        const entry = batchResults[sym.toUpperCase()] || batchResults[sym];
        const ecbRate = frankfurterLiveMap[ccy];
        if (entry?.result) {
          resolvedLiveMap[ccy] = {
            rate: Number(entry.result.regularMarketPrice.toFixed(6)),
            previousClose: entry.result.previousClose ?? null,
            source: "YAHOO",
          };
        } else if (ecbRate) {
          resolvedLiveMap[ccy] = {
            rate: ecbRate,
            previousClose: null,
            source: "FRANKFURTER",
          };
        }
      }
    }

    // 2. Resolve historical FX rates (< todayStr) using fx_cache + 1 Frankfurter time-series batch
    const resolvedHistoricalMap: Record<
      string,
      { rateToEur: number; rateDate: string; source: "FRANKFURTER" | "YAHOO" | "CACHE" }
    > = {};

    if (includeEntryFx || includeExitFx) {
      const historicalRequests: Array<{ fromCurrency: string; requestedDate: string }> = [];
      for (const trade of nonEurTrades) {
        const ccy = (trade.currency || "USD").trim().toUpperCase();
        if (includeEntryFx && isIsoDate(trade.startDate) && trade.startDate < todayStr) {
          historicalRequests.push({
            fromCurrency: ccy,
            requestedDate: trade.startDate,
          });
        }
        if (includeExitFx && isIsoDate(trade.endDate) && trade.endDate < todayStr) {
          historicalRequests.push({
            fromCurrency: ccy,
            requestedDate: trade.endDate,
          });
        }
      }

      const uniqueReqMap = new Map<
        string,
        { fromCurrency: string; requestedDate: string }
      >();
      for (const req of historicalRequests) {
        uniqueReqMap.set(`${req.fromCurrency}:${req.requestedDate}`, req);
      }
      const uniqueRequests = Array.from(uniqueReqMap.values());

      if (uniqueRequests.length > 0) {
        const cachedMap = getCachedHistoricalFxMap(uniqueRequests);
        const missedRequests: Array<{ fromCurrency: string; requestedDate: string }> = [];

        for (const req of uniqueRequests) {
          const key = `${req.fromCurrency}:${req.requestedDate}`;
          const hit = cachedMap[key];
          if (hit) {
            resolvedHistoricalMap[key] = {
              rateToEur: hit.rateToEur,
              rateDate: hit.rateDate,
              source: "CACHE",
            };
          } else {
            missedRequests.push(req);
          }
        }

        if (missedRequests.length > 0) {
          const minMissedDate = missedRequests.reduce(
            (min, r) => (r.requestedDate < min ? r.requestedDate : min),
            missedRequests[0].requestedDate
          );
          const missedCurrencies = Array.from(
            new Set(missedRequests.map((r) => r.fromCurrency))
          );

          const tsResult = await fetchFrankfurterTimeSeriesToEur(
            missedCurrencies,
            minMissedDate,
            yahooSymbolByCurrency
          );
          warnings.push(...tsResult.warnings);

          const newCacheEntries: Array<{
            fromCurrency: string;
            requestedDate: string;
            rateToEur: number;
            rateDate: string;
          }> = [];

          for (const req of missedRequests) {
            const key = `${req.fromCurrency}:${req.requestedDate}`;
            const seriesInfo = tsResult.seriesByCurrency[req.fromCurrency];
            const resolved = seriesInfo
              ? resolveSeriesRateOnOrBefore(seriesInfo.points, req.requestedDate)
              : null;

            if (resolved) {
              resolvedHistoricalMap[key] = {
                rateToEur: resolved.rateToEur,
                rateDate: resolved.effectiveDate,
                source: seriesInfo.source,
              };
              newCacheEntries.push({
                fromCurrency: req.fromCurrency,
                requestedDate: req.requestedDate,
                rateToEur: resolved.rateToEur,
                rateDate: resolved.effectiveDate,
              });
            } else {
              // Edge-case fallback: direct single-date ECB lookup
              try {
                const detail = await fetchFrankfurterFxDetailToEur(
                  req.fromCurrency,
                  req.requestedDate
                );
                resolvedHistoricalMap[key] = {
                  rateToEur: detail.rateToEur,
                  rateDate: detail.rateDate,
                  source: "FRANKFURTER",
                };
                newCacheEntries.push({
                  fromCurrency: req.fromCurrency,
                  requestedDate: req.requestedDate,
                  rateToEur: detail.rateToEur,
                  rateDate: detail.rateDate,
                });
              } catch {
                warnings.push(
                  `No historical FX rate found for ${req.fromCurrency} on ${req.requestedDate}.`
                );
              }
            }
          }

          upsertCachedHistoricalFxBatch(newCacheEntries);
        }
      }
    }

    // 3. Compute per-trade FX diffs & P&L impact
    const tradeChanges: TradeFxChangeItem[] = [];

    for (const trade of nonEurTrades) {
      const ccy = (trade.currency || "USD").trim().toUpperCase();
      const isOpen = !trade.endDate;
      const pair = fxPairByCurrency.get(ccy);

      const curEntryFx = trade.entryFxRateToEur;
      const curExitOrLiveFx = isOpen
        ? (currentLiveFxMap[ccy] ?? trade.fxRateToEur)
        : trade.fxRateToEur;

      const latestPrice = isOpen
        ? (quoteMap[trade.ticker] ?? trade.manualLatestPrice ?? trade.buyPrice)
        : (trade.sellPrice ?? trade.manualLatestPrice ?? trade.buyPrice);

      let entryChange: TradeFxFieldChange | undefined;
      if (includeEntryFx) {
        if (!isIsoDate(trade.startDate) || trade.startDate >= todayStr) {
          const live = resolvedLiveMap[ccy];
          if (live && Math.abs(live.rate - curEntryFx) >= DIFF_EPS) {
            entryChange = {
              oldRate: curEntryFx,
              newRate: live.rate,
              effectiveDate: todayStr,
              source: live.source,
            };
          }
        } else {
          const hist = resolvedHistoricalMap[`${ccy}:${trade.startDate}`];
          if (hist && Math.abs(hist.rateToEur - curEntryFx) >= DIFF_EPS) {
            entryChange = {
              oldRate: curEntryFx,
              newRate: hist.rateToEur,
              effectiveDate: hist.rateDate,
              source: hist.source,
            };
          }
        }
      }

      let exitChange:
        | (TradeFxFieldChange & { kind: "EXIT" | "LIVE" })
        | undefined;
      if (isOpen) {
        if (includeLive && pair?.liveProvider !== "MANUAL") {
          const live = resolvedLiveMap[ccy];
          if (live && Math.abs(live.rate - curExitOrLiveFx) >= DIFF_EPS) {
            exitChange = {
              kind: "LIVE",
              oldRate: curExitOrLiveFx,
              newRate: live.rate,
              effectiveDate: todayStr,
              source: live.source,
            };
          }
        }
      } else if (includeExitFx && trade.endDate) {
        if (!isIsoDate(trade.endDate) || trade.endDate >= todayStr) {
          const live = resolvedLiveMap[ccy];
          if (live && Math.abs(live.rate - curExitOrLiveFx) >= DIFF_EPS) {
            exitChange = {
              kind: "EXIT",
              oldRate: curExitOrLiveFx,
              newRate: live.rate,
              effectiveDate: todayStr,
              source: live.source,
            };
          }
        } else {
          const hist = resolvedHistoricalMap[`${ccy}:${trade.endDate}`];
          if (hist && Math.abs(hist.rateToEur - curExitOrLiveFx) >= DIFF_EPS) {
            exitChange = {
              kind: "EXIT",
              oldRate: curExitOrLiveFx,
              newRate: hist.rateToEur,
              effectiveDate: hist.rateDate,
              source: hist.source,
            };
          }
        }
      }

      if (entryChange || exitChange) {
        const oldPnlEur =
          trade.shares * latestPrice * curExitOrLiveFx -
          trade.shares * trade.buyPrice * curEntryFx;
        const nextEntryFx = entryChange ? entryChange.newRate : curEntryFx;
        const nextExitFx = exitChange ? exitChange.newRate : curExitOrLiveFx;
        const newPnlEur =
          trade.shares * latestPrice * nextExitFx -
          trade.shares * trade.buyPrice * nextEntryFx;

        tradeChanges.push({
          tradeId: trade.id,
          ticker: trade.ticker,
          currency: ccy,
          isOpen,
          startDate: trade.startDate,
          endDate: trade.endDate,
          entryChange,
          exitChange,
          oldPnlEur,
          newPnlEur,
          pnlDeltaEur: newPnlEur - oldPnlEur,
        });
      }
    }

    const dedupedWarnings = Array.from(new Set(warnings));
    const activeTradeChanges =
      mode === "apply" && selectedSet
        ? tradeChanges.filter((c) => selectedSet.has(c.tradeId))
        : tradeChanges;

    const summary = {
      totalTradesScanned: rawTrades.length,
      tradesAffected: activeTradeChanges.length,
      entryUpdatesCount: activeTradeChanges.filter((c) => Boolean(c.entryChange))
        .length,
      exitUpdatesCount: activeTradeChanges.filter(
        (c) => c.exitChange?.kind === "EXIT"
      ).length,
      liveUpdatesCount: activeTradeChanges.filter(
        (c) => c.exitChange?.kind === "LIVE"
      ).length,
      livePairUpdatesCount: livePairChanges.length,
      totalPnlDeltaEur: activeTradeChanges.reduce(
        (sum, c) => sum + c.pnlDeltaEur,
        0
      ),
    };

    if (mode === "preview") {
      return NextResponse.json({
        mode: "preview",
        livePairChanges,
        tradeChanges,
        summary,
        warnings: dedupedWarnings,
      });
    }

    // 4. Apply updates atomically
    const now = new Date().toISOString();
    if (includeLive) {
      for (const pair of fxPairs) {
        if (pair.liveProvider === "MANUAL") continue;
        const ccy = pair.fromCurrency.trim().toUpperCase();
        const resolved = resolvedLiveMap[ccy];
        if (resolved) {
          updateForexPairById(
            pair.id,
            {
              latestRate: resolved.rate,
              previousClose: resolved.previousClose,
              lastUpdated: now,
              syncStatus: "OK",
              syncError: null,
            },
            userId
          );
        }
      }
    }

    const tradeUpdates: BulkTradeFxUpdateItem[] = [];
    for (const change of activeTradeChanges) {
      const item: BulkTradeFxUpdateItem = { tradeId: change.tradeId };
      if (change.entryChange) {
        item.entryFxRateToEur = change.entryChange.newRate;
      }
      if (change.exitChange?.kind === "EXIT") {
        item.fxRateToEur = change.exitChange.newRate;
      }
      if (
        item.entryFxRateToEur !== undefined ||
        item.fxRateToEur !== undefined
      ) {
        tradeUpdates.push(item);
      }
    }

    const updatedTradesCount = bulkUpdateTradeFxRates(userId, tradeUpdates);

    const updatedRawTrades = getAllTrades(userId);
    const updatedQuoteMap = getLiveQuoteMap(userId);
    const updatedFxMap = getLiveFxMap(userId);
    const trades = computeTradesWithMetrics(
      updatedRawTrades,
      updatedQuoteMap,
      updatedFxMap
    );
    const kpis = computePortfolioKPIs(trades);
    const securities = getAllSecurities(userId);
    const updatedForexPairs = getAllForexPairs(userId);

    return NextResponse.json({
      mode: "apply",
      updatedTradesCount,
      livePairChanges,
      tradeChanges: activeTradeChanges,
      summary,
      warnings: dedupedWarnings,
      trades,
      kpis,
      securities,
      forexPairs: updatedForexPairs,
    });
  } catch (error) {
    console.error("POST /api/forex/sync-trades error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to sync trade FX rates",
      },
      { status: 500 }
    );
  }
}
