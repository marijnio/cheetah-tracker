import YahooFinance from "yahoo-finance2";
import { mapToYahooTicker } from "./ticker-mapper";

export interface YahooQuoteResult {
  symbol: string;
  regularMarketPrice: number;
  previousClose: number | null;
  currency: string | null;
  shortName: string | null;
  longName: string | null;
  sector: string | null;
  exchangeName: string | null;
}

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  versionCheck: false,
  validation: {
    logErrors: false,
    logOptionsErrors: false,
  },
});

/**
 * Normalizes Yahoo ticker symbol. If a Google Finance colon-prefix is passed
 * (e.g. 'STO:INVE-B' or 'AMS:ASML'), maps to proper Yahoo suffix ('INVE-B.ST', 'ASML.AS').
 */
function cleanSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes(":")) {
    return mapToYahooTicker(s).yahooTicker;
  }
  return s;
}

/**
 * Maps Yahoo Finance sector names to standard GICS sectors used in the application.
 */
function normalizeGicsSector(rawSector: string | null | undefined): string | null {
  if (!rawSector) return null;
  const s = rawSector.trim();
  const map: Record<string, string> = {
    Technology: "Information Technology",
    "Information Technology": "Information Technology",
    "Financial Services": "Financials",
    Financial: "Financials",
    Financials: "Financials",
    Energy: "Energy",
    Industrials: "Industrials",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Discretionary": "Consumer Discretionary",
    "Communication Services": "Communication Services",
    "Basic Materials": "Materials",
    Materials: "Materials",
    Healthcare: "Health Care",
    "Health Care": "Health Care",
    "Consumer Defensive": "Consumer Staples",
    "Consumer Staples": "Consumer Staples",
    Utilities: "Utilities",
    "Real Estate": "Real Estate",
  };
  return map[s] || s;
}

/**
 * Converts a raw quote object from yahoo-finance2 into a normalized YahooQuoteResult.
 */
function parseQuoteItem(
  raw: Record<string, unknown>,
  fallbackSymbol: string
): YahooQuoteResult | null {
  const rawPrice =
    raw.regularMarketPrice ?? raw.fulldayPrice ?? raw.postMarketPrice;
  const numPrice = Number(rawPrice);
  if (Number.isNaN(numPrice) || numPrice <= 0) {
    return null;
  }

  const rawPrev = raw.regularMarketPreviousClose;
  const numPrev =
    rawPrev !== undefined && rawPrev !== null && !Number.isNaN(Number(rawPrev))
      ? Number(rawPrev)
      : null;

  return {
    symbol: typeof raw.symbol === "string" ? raw.symbol : fallbackSymbol,
    regularMarketPrice: numPrice,
    previousClose: numPrev,
    currency:
      typeof raw.currency === "string" ? raw.currency.toUpperCase() : null,
    shortName: typeof raw.shortName === "string" ? raw.shortName : null,
    longName: typeof raw.longName === "string" ? raw.longName : null,
    sector: normalizeGicsSector(
      typeof raw.sector === "string" ? raw.sector : null
    ),
    exchangeName:
      typeof raw.fullExchangeName === "string"
        ? raw.fullExchangeName
        : typeof raw.exchange === "string"
          ? raw.exchange
          : null,
  };
}

/**
 * Enriches quote result with company sector and name metadata via quoteSummary / search.
 */
async function enrichQuoteMetadata(
  targetSymbol: string,
  baseQuote: YahooQuoteResult
): Promise<YahooQuoteResult> {
  if (baseQuote.sector) return baseQuote;

  // 1. Try quoteSummary (assetProfile / summaryProfile)
  try {
    const summary = (await yahooFinance.quoteSummary(
      targetSymbol,
      { modules: ["assetProfile", "summaryProfile"] },
      { validateResult: false }
    )) as Record<string, Record<string, unknown> | undefined> | undefined;

    const rawSector =
      (summary?.assetProfile?.sector as string | undefined) ||
      (summary?.summaryProfile?.sector as string | undefined);
    if (rawSector) {
      return {
        ...baseQuote,
        sector: normalizeGicsSector(rawSector),
      };
    }
  } catch {
    // Fall through to search
  }

  // 2. Fallback to Yahoo search metadata
  try {
    const searchRes = (await yahooFinance.search(
      targetSymbol,
      { quotesCount: 5, newsCount: 0 },
      { validateResult: false }
    )) as { quotes?: Array<Record<string, unknown>> } | undefined;

    const quotes = searchRes?.quotes || [];
    const match =
      quotes.find(
        (q) =>
          typeof q.symbol === "string" &&
          q.symbol.toUpperCase() === targetSymbol.toUpperCase()
      ) || quotes[0];

    if (match) {
      const rawSector =
        (match.sectorDisp as string | undefined) ||
        (match.sector as string | undefined) ||
        null;
      return {
        ...baseQuote,
        shortName:
          baseQuote.shortName ||
          (typeof match.shortname === "string" ? match.shortname : null),
        longName:
          baseQuote.longName ||
          (typeof match.longname === "string" ? match.longname : null),
        sector: normalizeGicsSector(rawSector) || baseQuote.sector,
      };
    }
  } catch {
    // Metadata enrichment is non-blocking
  }

  return baseQuote;
}

/**
 * Fetches live quote data from Yahoo Finance using yahoo-finance2.
 * Automatically manages Yahoo session cookies & crumbs, with fallback to chart
 * and Frankfurter ECB (for Forex).
 */
export async function fetchYahooQuote(
  symbol: string,
  includeMetadata = false
): Promise<YahooQuoteResult> {
  const targetSymbol = cleanSymbol(symbol);
  let lastError = "";

  // 1. Primary Strategy: yahoo-finance2 v7 quote (handles cookies/crumbs automatically)
  try {
    const raw = (await yahooFinance.quote(
      targetSymbol,
      {},
      { validateResult: false }
    )) as Record<string, unknown> | undefined;

    if (raw) {
      const parsed = parseQuoteItem(raw, targetSymbol);
      if (parsed) {
        return includeMetadata
          ? await enrichQuoteMetadata(targetSymbol, parsed)
          : parsed;
      }
    }
    lastError = `No quote data returned for '${targetSymbol}'`;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Quote request failed";
  }

  // 2. Secondary Strategy: yahoo-finance2 v8 chart module
  try {
    const period1 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const chartData = (await yahooFinance.chart(
      targetSymbol,
      { period1, interval: "1d" },
      { validateResult: false }
    )) as { meta?: Record<string, unknown> } | undefined;

    const meta = chartData?.meta;
    if (
      meta &&
      meta.regularMarketPrice !== undefined &&
      meta.regularMarketPrice !== null
    ) {
      const regularMarketPrice = Number(meta.regularMarketPrice);
      if (!Number.isNaN(regularMarketPrice) && regularMarketPrice > 0) {
        const prevRaw = meta.chartPreviousClose ?? meta.previousClose;
        const previousClose =
          prevRaw !== undefined &&
          prevRaw !== null &&
          !Number.isNaN(Number(prevRaw))
            ? Number(prevRaw)
            : null;

        const baseQuote: YahooQuoteResult = {
          symbol:
            typeof meta.symbol === "string" ? meta.symbol : targetSymbol,
          regularMarketPrice,
          previousClose,
          currency:
            typeof meta.currency === "string"
              ? meta.currency.toUpperCase()
              : null,
          shortName:
            typeof meta.shortName === "string"
              ? meta.shortName
              : typeof meta.longName === "string"
                ? meta.longName
                : null,
          longName:
            typeof meta.longName === "string"
              ? meta.longName
              : typeof meta.shortName === "string"
                ? meta.shortName
                : null,
          sector: null,
          exchangeName:
            typeof meta.fullExchangeName === "string"
              ? meta.fullExchangeName
              : typeof meta.exchangeName === "string"
                ? meta.exchangeName
                : null,
        };

        return includeMetadata
          ? await enrichQuoteMetadata(targetSymbol, baseQuote)
          : baseQuote;
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : lastError;
  }

  // 3. Fallback for Forex pairs (e.g. USDEUR=X, CADEUR=X) via Frankfurter ECB API
  if (targetSymbol.endsWith("EUR=X")) {
    const fromCcy = targetSymbol.replace("EUR=X", "");
    if (fromCcy && fromCcy.length === 3) {
      try {
        const rate = await fetchFrankfurterFxToEur(fromCcy);
        return {
          symbol: targetSymbol,
          regularMarketPrice: rate,
          previousClose: null,
          currency: "EUR",
          shortName: `${fromCcy}/EUR`,
          longName: `${fromCcy} to EUR Exchange Rate`,
          sector: null,
          exchangeName: "Frankfurter ECB",
        };
      } catch {
        // proceed to throw
      }
    }
  }

  throw new Error(
    `Failed to fetch live quote for '${targetSymbol}' from Yahoo Finance (${lastError || "no response"})`
  );
}

/**
 * Fetches quotes for an array of symbols in a single batch call via yahoo-finance2,
 * falling back to individual lookups for any symbol missed in the batch.
 */
export async function fetchYahooBatchQuotes(
  symbols: string[]
): Promise<Record<string, { result?: YahooQuoteResult; error?: string }>> {
  const unique = Array.from(
    new Set(symbols.map(cleanSymbol).filter(Boolean))
  );
  const output: Record<string, { result?: YahooQuoteResult; error?: string }> =
    {};

  if (unique.length === 0) {
    return output;
  }

  const resolvedSymbols = new Set<string>();

  // 1. Batch fetch all symbols in a single Yahoo Finance request
  try {
    const rawList = (await yahooFinance.quote(
      unique,
      {},
      { validateResult: false }
    )) as Array<Record<string, unknown>> | undefined;

    if (Array.isArray(rawList)) {
      for (const raw of rawList) {
        const sym = typeof raw?.symbol === "string" ? raw.symbol : "";
        if (!sym) continue;
        const parsed = parseQuoteItem(raw, sym);
        if (parsed) {
          const res = { result: parsed };
          const upper = parsed.symbol.toUpperCase();
          output[parsed.symbol] = res;
          output[upper] = res;
          resolvedSymbols.add(upper);
        }
      }
    }
  } catch {
    // If the batch call fails, individual fallbacks below will handle each symbol
  }

  // 2. Fallback individually for any requested symbol not resolved in the batch
  const missing = unique.filter(
    (sym) => !resolvedSymbols.has(sym.toUpperCase())
  );

  for (const sym of missing) {
    try {
      const quote = await fetchYahooQuote(sym, false);
      const res = { result: quote };
      output[sym] = res;
      output[sym.toUpperCase()] = res;
      output[quote.symbol.toUpperCase()] = res;
    } catch (err) {
      const errRes = {
        error: err instanceof Error ? err.message : "Failed to fetch quote",
      };
      output[sym] = errRes;
      output[sym.toUpperCase()] = errRes;
    }
  }

  return output;
}

export interface HistoricalFxPoint {
  date: string; // YYYY-MM-DD ascending
  rateToEur: number;
}

export function getTodayUtcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Pure UTC date arithmetic subtracting `days` calendar days from a YYYY-MM-DD string.
 */
export function subtractDaysUtc(dateStr: string, days: number): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    const d = new Date(Date.now() - days * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Binary-searches a sorted ascending HistoricalFxPoint[] for the latest point on or before `targetDate`.
 */
export function resolveSeriesRateOnOrBefore(
  series: HistoricalFxPoint[],
  targetDate: string
): { rateToEur: number; effectiveDate: string } | null {
  if (!series || series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let matchIndex = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= targetDate) {
      matchIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (matchIndex === -1) return null;
  return {
    rateToEur: series[matchIndex].rateToEur,
    effectiveDate: series[matchIndex].date,
  };
}

/**
 * Fetches official ECB exchange rate (1 unit of fromCurrency -> EUR) plus actual ECB fixing date.
 * Clamps future dates to 'latest' and standardizes 6-decimal EUR-base inversion.
 */
export async function fetchFrankfurterFxDetailToEur(
  fromCurrency: string,
  dateStr: "latest" | string = "latest"
): Promise<{ rateToEur: number; rateDate: string }> {
  const ccy = fromCurrency.trim().toUpperCase();
  const today = getTodayUtcDateStr();
  if (ccy === "EUR") {
    return {
      rateToEur: 1.0,
      rateDate: dateStr === "latest" || dateStr > today ? today : dateStr,
    };
  }

  const effectiveDate =
    !dateStr || dateStr === "latest" || dateStr > today ? "latest" : dateStr;

  // 1. Preferred: EUR-base lookup inverted to 6 decimals (matches batch & time-series precision)
  try {
    const endpoint = `https://api.frankfurter.dev/v1/${effectiveDate}?base=EUR&symbols=${encodeURIComponent(
      ccy
    )}`;
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      const eurToCcy = Number(data?.rates?.[ccy]);
      if (!Number.isNaN(eurToCcy) && eurToCcy > 0) {
        return {
          rateToEur: Number((1 / eurToCcy).toFixed(6)),
          rateDate: typeof data?.date === "string" ? data.date : effectiveDate === "latest" ? today : effectiveDate,
        };
      }
    }
  } catch {
    // Fall through to direct base=ccy query
  }

  // 2. Fallback: direct base=${ccy}&symbols=EUR lookup
  const fallbackEndpoint = `https://api.frankfurter.dev/v1/${effectiveDate}?base=${encodeURIComponent(
    ccy
  )}&symbols=EUR`;

  const res = await fetch(fallbackEndpoint, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Frankfurter API HTTP ${res.status} for ${ccy}->EUR (${effectiveDate})`
    );
  }

  const data = await res.json();
  const rate = Number(data?.rates?.EUR);
  if (Number.isNaN(rate) || rate <= 0) {
    throw new Error(`Invalid EUR rate returned from Frankfurter for ${ccy}`);
  }

  return {
    rateToEur: Number(rate.toFixed(6)),
    rateDate: typeof data?.date === "string" ? data.date : effectiveDate === "latest" ? today : effectiveDate,
  };
}

/**
 * Fetches official ECB exchange rate (1 unit of fromCurrency -> EUR) from the free Frankfurter API.
 * Supports 'latest' or a historical 'YYYY-MM-DD' date.
 */
export async function fetchFrankfurterFxToEur(
  fromCurrency: string,
  dateStr: "latest" | string = "latest"
): Promise<number> {
  const detail = await fetchFrankfurterFxDetailToEur(fromCurrency, dateStr);
  return detail.rateToEur;
}

/**
 * Fetches all live ECB exchange rates to EUR in a single call from Frankfurter.
 */
export async function fetchAllFrankfurterRatesToEur(
  currencies: string[]
): Promise<Record<string, number>> {
  const targets = Array.from(
    new Set(
      currencies
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c && c !== "EUR")
    )
  );
  const result: Record<string, number> = { EUR: 1.0 };
  if (targets.length === 0) return result;

  const res = await fetch(
    `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${encodeURIComponent(
      targets.join(",")
    )}`,
    {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(`Frankfurter batch HTTP ${res.status}`);
  }

  const data = await res.json();
  const rates = data?.rates || {};
  for (const ccy of targets) {
    const eurToCcy = Number(rates[ccy]);
    if (!Number.isNaN(eurToCcy) && eurToCcy > 0) {
      result[ccy] = Number((1 / eurToCcy).toFixed(6));
    }
  }
  return result;
}

/**
 * Fetches daily historical FX rates from Yahoo Finance chart API (fallback for non-ECB currencies).
 */
export async function fetchYahooHistoricalFxSeriesToEur(
  yahooSymbol: string,
  startDate: string
): Promise<HistoricalFxPoint[]> {
  const sym = cleanSymbol(yahooSymbol);
  const period1 = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(period1.getTime())) {
    return [];
  }

  const chartData = (await yahooFinance.chart(
    sym,
    { period1, interval: "1d" },
    { validateResult: false }
  )) as
    | {
        quotes?: Array<{
          date?: Date | string | number;
          close?: number | null;
        }>;
      }
    | undefined;

  const quotes = chartData?.quotes;
  if (!Array.isArray(quotes)) return [];

  const byDate = new Map<string, number>();
  for (const q of quotes) {
    if (q?.close === null || q?.close === undefined) continue;
    const closeNum = Number(q.close);
    if (Number.isNaN(closeNum) || closeNum <= 0 || !q.date) continue;
    const d = q.date instanceof Date ? q.date : new Date(q.date);
    if (Number.isNaN(d.getTime())) continue;
    const iso = d.toISOString().slice(0, 10);
    byDate.set(iso, Number(closeNum.toFixed(6)));
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rateToEur]) => ({ date, rateToEur }));
}

function parseFrankfurterRangeResponse(
  data: { rates?: Record<string, Record<string, number>> } | undefined,
  targets: string[]
): Record<string, HistoricalFxPoint[]> {
  const perCcy: Record<string, Map<string, number>> = {};
  for (const ccy of targets) {
    perCcy[ccy] = new Map<string, number>();
  }

  const ratesByDate = data?.rates || {};
  for (const [dateStr, dayRates] of Object.entries(ratesByDate)) {
    if (!dayRates || typeof dayRates !== "object") continue;
    for (const ccy of targets) {
      const eurToCcy = Number(dayRates[ccy]);
      if (!Number.isNaN(eurToCcy) && eurToCcy > 0) {
        perCcy[ccy].set(dateStr, Number((1 / eurToCcy).toFixed(6)));
      }
    }
  }

  const out: Record<string, HistoricalFxPoint[]> = {};
  for (const ccy of targets) {
    const entries = Array.from(perCcy[ccy].entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rateToEur]) => ({ date, rateToEur }));
    if (entries.length > 0) {
      out[ccy] = entries;
    }
  }
  return out;
}

/**
 * Fetches historical daily FX rates to EUR from Frankfurter (with 10-day backward padding for
 * weekends/holidays), retrying individually and falling back to Yahoo Finance for non-ECB currencies.
 */
export async function fetchFrankfurterTimeSeriesToEur(
  currencies: string[],
  minDate: string,
  yahooSymbolByCurrency?: Record<string, string>
): Promise<{
  seriesByCurrency: Record<
    string,
    { points: HistoricalFxPoint[]; source: "FRANKFURTER" | "YAHOO" }
  >;
  warnings: string[];
}> {
  const targets = Array.from(
    new Set(
      currencies
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c && c !== "EUR")
    )
  );
  const seriesByCurrency: Record<
    string,
    { points: HistoricalFxPoint[]; source: "FRANKFURTER" | "YAHOO" }
  > = {};
  const warnings: string[] = [];

  if (targets.length === 0) {
    return { seriesByCurrency, warnings };
  }

  const today = getTodayUtcDateStr();
  const clampedMin = minDate > today ? today : minDate;
  const paddedStart = subtractDaysUtc(clampedMin, 10);

  // 1. Try single multi-currency Frankfurter range request
  let batchSucceeded = false;
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/${paddedStart}..?base=EUR&symbols=${encodeURIComponent(
        targets.join(",")
      )}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );

    if (res.ok) {
      const data = await res.json();
      const parsed = parseFrankfurterRangeResponse(data, targets);
      for (const [ccy, points] of Object.entries(parsed)) {
        seriesByCurrency[ccy] = { points, source: "FRANKFURTER" };
      }
      batchSucceeded = true;
    }
  } catch {
    // Fall through to per-currency retry
  }

  // 2. If batch call failed (e.g. contains unsupported non-ECB currency), retry individually on Frankfurter
  if (!batchSucceeded) {
    for (const ccy of targets) {
      try {
        const res = await fetch(
          `https://api.frankfurter.dev/v1/${paddedStart}..?base=EUR&symbols=${encodeURIComponent(
            ccy
          )}`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
          }
        );
        if (res.ok) {
          const data = await res.json();
          const parsed = parseFrankfurterRangeResponse(data, [ccy]);
          if (parsed[ccy]?.length) {
            seriesByCurrency[ccy] = { points: parsed[ccy], source: "FRANKFURTER" };
          }
        }
      } catch {
        // Proceed to Yahoo fallback below
      }
    }
  }

  // 3. Fallback to Yahoo Finance historical chart for any currency missing from Frankfurter
  const missing = targets.filter((ccy) => !seriesByCurrency[ccy]);
  for (const ccy of missing) {
    const yahooSym = yahooSymbolByCurrency?.[ccy] || `${ccy}EUR=X`;
    try {
      const points = await fetchYahooHistoricalFxSeriesToEur(yahooSym, paddedStart);
      if (points.length > 0) {
        seriesByCurrency[ccy] = { points, source: "YAHOO" };
      } else {
        warnings.push(
          `No historical FX rates available for ${ccy}/EUR from ECB or Yahoo (${yahooSym}).`
        );
      }
    } catch (err) {
      warnings.push(
        `Failed to fetch historical FX for ${ccy}/EUR: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    }
  }

  return { seriesByCurrency, warnings };
}
