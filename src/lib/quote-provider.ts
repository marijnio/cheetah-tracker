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

/**
 * Fetches official ECB exchange rate (1 unit of fromCurrency -> EUR) from the free Frankfurter API.
 * Supports 'latest' or a historical 'YYYY-MM-DD' date.
 */
export async function fetchFrankfurterFxToEur(
  fromCurrency: string,
  dateStr: "latest" | string = "latest"
): Promise<number> {
  const ccy = fromCurrency.trim().toUpperCase();
  if (ccy === "EUR") return 1.0;

  const endpoint = `https://api.frankfurter.dev/v1/${dateStr}?base=${encodeURIComponent(
    ccy
  )}&symbols=EUR`;

  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Frankfurter API HTTP ${res.status} for ${ccy}->EUR (${dateStr})`
    );
  }

  const data = await res.json();
  const rate = Number(data?.rates?.EUR);
  if (Number.isNaN(rate) || rate <= 0) {
    throw new Error(`Invalid EUR rate returned from Frankfurter for ${ccy}`);
  }

  return rate;
}

/**
 * Fetches all live ECB exchange rates to EUR in a single call from Frankfurter.
 */
export async function fetchAllFrankfurterRatesToEur(
  currencies: string[]
): Promise<Record<string, number>> {
  const targets = currencies
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c && c !== "EUR");
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
