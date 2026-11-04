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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

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
 * Parses market quote directly from Yahoo Finance web page.
 * This route is robust against the HTTP 429 rate-limiting that Yahoo applies
 * to its unofficial v8/chart JSON endpoint.
 */
async function fetchFromYahooWeb(
  targetSymbol: string
): Promise<YahooQuoteResult> {
  const url = `https://finance.yahoo.com/quote/${encodeURIComponent(targetSymbol)}/`;
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    cache: "no-store",
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];

  for (const s of scripts) {
    if (s[1].includes("quoteResponse")) {
      try {
        const obj = JSON.parse(s[1]);
        const body =
          typeof obj.body === "string" ? JSON.parse(obj.body) : obj.body;
        const results = body?.quoteResponse?.result || [];
        const match = results.find(
          (q: { symbol?: string }) =>
            q.symbol?.toUpperCase() === targetSymbol.toUpperCase()
        );

        if (
          match &&
          (match.regularMarketPrice !== undefined ||
            match.fulldayPrice !== undefined)
        ) {
          const rawPrice =
            match.regularMarketPrice?.raw ??
            match.regularMarketPrice ??
            match.fulldayPrice?.raw ??
            match.fulldayPrice;
          const rawPrev =
            match.regularMarketPreviousClose?.raw ??
            match.regularMarketPreviousClose;

          const numPrice = Number(rawPrice);
          if (!Number.isNaN(numPrice) && numPrice > 0) {
            return {
              symbol: match.symbol || targetSymbol,
              regularMarketPrice: numPrice,
              previousClose:
                rawPrev && !Number.isNaN(Number(rawPrev))
                  ? Number(rawPrev)
                  : null,
              currency: match.currency
                ? String(match.currency).toUpperCase()
                : null,
              shortName: match.shortName || null,
              longName: match.longName || null,
              sector: null,
              exchangeName: match.fullExchangeName || match.exchange || null,
            };
          }
        }
      } catch {
        // Continue searching other script tags
      }
    }
  }

  // Fallback: search regex in HTML for fin-streamer or data attributes
  const priceMatch =
    html.match(/data-field="regularMarketPrice"[^>]*data-value="([\d.]+)"/) ||
    html.match(/data-field="regularMarketPrice"[^>]*value="([\d.]+)"/) ||
    html.match(/data-value="([\d.]+)"[^>]*data-field="regularMarketPrice"/) ||
    html.match(/"regularMarketPrice":\s*\{\s*"raw":\s*([\d.]+)/);

  if (priceMatch) {
    const numPrice = Number(priceMatch[1]);
    if (!Number.isNaN(numPrice) && numPrice > 0) {
      const prevMatch =
        html.match(
          /data-field="regularMarketPreviousClose"[^>]*data-value="([\d.]+)"/
        ) ||
        html.match(
          /data-value="([\d.]+)"[^>]*data-field="regularMarketPreviousClose"/
        );
      return {
        symbol: targetSymbol,
        regularMarketPrice: numPrice,
        previousClose:
          prevMatch && !Number.isNaN(Number(prevMatch[1]))
            ? Number(prevMatch[1])
            : null,
        currency: null,
        shortName: null,
        longName: null,
        sector: null,
        exchangeName: null,
      };
    }
  }

  throw new Error(`Quote data not found on Yahoo page for '${targetSymbol}'`);
}

/**
 * Fetches live quote data from Yahoo Finance.
 * Uses a primary web-scraping strategy with browser headers, and falls back to
 * chart API and Frankfurter ECB (for Forex).
 */
export async function fetchYahooQuote(
  symbol: string,
  includeMetadata = false
): Promise<YahooQuoteResult> {
  const targetSymbol = cleanSymbol(symbol);
  let lastError = "";

  // 1. Primary Strategy: Yahoo Finance Web Quote Page (reliable against HTTP 429)
  try {
    const webResult = await fetchFromYahooWeb(targetSymbol);
    return webResult;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Web page failed";
  }

  // 2. Secondary Strategy: Yahoo Finance v8 Chart API with browser headers
  const encoded = encodeURIComponent(targetSymbol);
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encoded}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        const meta = result?.meta;

        if (
          meta &&
          meta.regularMarketPrice !== undefined &&
          meta.regularMarketPrice !== null
        ) {
          const regularMarketPrice = Number(meta.regularMarketPrice);
          if (!Number.isNaN(regularMarketPrice) && regularMarketPrice > 0) {
            const previousClose =
              meta.chartPreviousClose !== undefined &&
                meta.chartPreviousClose !== null
                ? Number(meta.chartPreviousClose)
                : meta.previousClose !== undefined &&
                  meta.previousClose !== null
                  ? Number(meta.previousClose)
                  : null;

            return {
              symbol: meta.symbol || targetSymbol,
              regularMarketPrice,
              previousClose:
                previousClose && !Number.isNaN(previousClose)
                  ? previousClose
                  : null,
              currency: meta.currency
                ? String(meta.currency).toUpperCase()
                : null,
              shortName: meta.shortName || meta.longName || null,
              longName: meta.longName || meta.shortName || null,
              sector: null,
              exchangeName: meta.fullExchangeName || meta.exchangeName || null,
            };
          }
        }
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Network error";
    }
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
 * Fetches quotes for an array of symbols sequentially with a small delay to respect rate limits.
 */
export async function fetchYahooBatchQuotes(
  symbols: string[]
): Promise<Record<string, { result?: YahooQuoteResult; error?: string }>> {
  const unique = Array.from(
    new Set(symbols.map(cleanSymbol).filter(Boolean))
  );
  const output: Record<string, { result?: YahooQuoteResult; error?: string }> = {};

  for (const sym of unique) {
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
    // Polite 80ms pause between queries
    await new Promise((r) => setTimeout(r, 80));
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
