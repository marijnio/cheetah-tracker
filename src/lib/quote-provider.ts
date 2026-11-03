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

/**
 * Normalizes Yahoo ticker symbol (e.g. cleans accidental colons or prefixes)
 */
function cleanSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (s.includes(":")) {
    const parts = s.split(":");
    return parts[1] || s;
  }
  return s;
}

/**
 * Fetches live quote data from Yahoo Finance v8 chart API.
 * Uses clean headers to prevent Yahoo's bot rate-limiter (HTTP 429).
 */
export async function fetchYahooQuote(
  providerSymbol: string,
  includeMetadata = false
): Promise<YahooQuoteResult> {
  const targetSymbol = cleanSymbol(providerSymbol);
  const encoded = encodeURIComponent(targetSymbol);

  // Rotate between query1 and query2 hosts
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let response: Response | null = null;
  let lastError = "";

  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encoded}?interval=1d&range=1d`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (res.ok) {
        response = res;
        break;
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Network error";
    }
  }

  if (!response || !response.ok) {
    throw new Error(
      `Yahoo Finance lookup failed for '${targetSymbol}' (${lastError || "no response"})`
    );
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta || meta.regularMarketPrice === undefined || meta.regularMarketPrice === null) {
    throw new Error(
      `No quote data found on Yahoo Finance for symbol '${targetSymbol}'. Please verify the provider symbol.`
    );
  }

  const regularMarketPrice = Number(meta.regularMarketPrice);
  if (Number.isNaN(regularMarketPrice) || regularMarketPrice <= 0) {
    throw new Error(
      `Invalid market price returned for '${targetSymbol}': ${meta.regularMarketPrice}`
    );
  }

  const previousClose =
    meta.chartPreviousClose !== undefined && meta.chartPreviousClose !== null
      ? Number(meta.chartPreviousClose)
      : meta.previousClose !== undefined && meta.previousClose !== null
        ? Number(meta.previousClose)
        : null;

  let shortName: string | null = meta.shortName || meta.longName || null;
  let longName: string | null = meta.longName || meta.shortName || null;
  let sector: string | null = null;

  // Attempt lightweight metadata search if requested
  if (includeMetadata) {
    try {
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&quotesCount=3&newsCount=0`;
      const searchRes = await fetch(searchUrl, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const quotes = searchData?.quotes || [];
        const match =
          quotes.find(
            (q: { symbol?: string }) =>
              q.symbol?.toUpperCase() === targetSymbol
          ) || quotes[0];
        if (match) {
          shortName = match.shortname || shortName;
          longName = match.longname || longName;
          sector = normalizeGicsSector(match.sectorDisp || match.sector || null);
        }
      }
    } catch {
      // Metadata enrichment is non-blocking
    }
  }

  return {
    symbol: meta.symbol || targetSymbol,
    regularMarketPrice,
    previousClose:
      previousClose && !Number.isNaN(previousClose) ? previousClose : null,
    currency: meta.currency ? String(meta.currency).toUpperCase() : null,
    shortName,
    longName,
    sector,
    exchangeName: meta.fullExchangeName || meta.exchangeName || null,
  };
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
      output[sym] = { result: quote };
    } catch (err) {
      output[sym] = {
        error: err instanceof Error ? err.message : "Failed to fetch quote",
      };
    }
    // Minimal 50ms pause between queries to avoid burst-limiting
    await new Promise((r) => setTimeout(r, 60));
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

function normalizeGicsSector(rawSector: string | null): string | null {
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
