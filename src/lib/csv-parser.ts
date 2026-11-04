import Papa from "papaparse";
import type { NewTradeInput } from "./db/schema";
import { mapToYahooTicker } from "./ticker-mapper";

// Fallback historical ECB FX rates to EUR for dates that had #N/A in the original Google Sheet
const HISTORICAL_FX_FALLBACKS: Record<string, number> = {
  "SEK:2026-09-25": 0.09105, // ~10.98 SEK per EUR
  "USD:2026-09-28": 0.8795,
  USD: 0.89338,
  CAD: 0.621215,
  SEK: 0.09125,
  DKK: 0.133774,
  GBP: 1.185,
  EUR: 1.0,
};

/**
 * Parses formatted numbers from Google Sheets CSV:
 * e.g., '"1,236.36"' -> 1236.36, '(44.61)' -> -44.61, '€3,620.51' -> 3620.51, '#N/A' -> null
 */
function parseNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  if (!raw || raw === "#N/A" || raw === "#VALUE!" || raw === "#REF!" || raw === "-") {
    return null;
  }

  const isAccountingNegative = raw.startsWith("(") && raw.endsWith(")");
  const cleaned = raw.replace(/[€$£,\s()%\u00A0]/g, "");
  const num = Number(cleaned);
  if (Number.isNaN(num)) return null;

  return isAccountingNegative ? -Math.abs(num) : num;
}

/**
 * Parses Google Sheets trading performance tracker CSV into normalized NewTradeInput rows.
 * Handles both the 3-row summary header format and direct 1-row column header CSVs.
 */
export function parseTradesCsv(csvContent: string): NewTradeInput[] {
  const parsed = Papa.parse<string[]>(csvContent, {
    skipEmptyLines: true,
  });

  const rows = parsed.data;
  if (!rows || rows.length === 0) return [];

  // Find the header row (looks for 'Ticker' in first column)
  let headerRowIndex = rows.findIndex(
    (row) => row[0]?.trim().toLowerCase() === "ticker"
  );

  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  const headers = rows[headerRowIndex].map((h) => h.trim().toLowerCase());
  const dataRows = rows.slice(headerRowIndex + 1);

  const colIdx = (names: string[]): number => {
    for (const name of names) {
      const idx = headers.indexOf(name.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxTicker = colIdx(["ticker", "symbol"]);
  const idxSector = colIdx(["gcis sector", "gics sector", "sector"]);
  const idxStartDate = colIdx(["start date", "entry date"]);
  const idxEndDate = colIdx(["end date", "exit date"]);
  const idxShares = colIdx(["shares", "quantity", "qty"]);
  const idxBuyPrice = colIdx(["buy price", "entry price"]);
  const idxSellPrice = colIdx(["sell price", "exit price"]);
  const idxCurrency = colIdx(["currency", "ccy"]);
  const idxStopLoss = colIdx(["initial stop loss", "stop loss", "initial stop"]);
  const idxLatestPrice = colIdx(["latest price", "current price"]);
  const idxEntryRateToEur = colIdx([
    "rate to € at start",
    "rate to eur at start",
    "entry fx rate",
  ]);
  const idxRateToEur = colIdx(["rate to € at end", "rate to eur at end", "fx rate"]);
  const idxStopMoved = colIdx(["stop moved"]);
  const idxTrimmed = colIdx(["trimmed at 2r", "trimmed"]);
  const idxEntryValueLocal = colIdx(["entry value"]);
  const idxEntryValueEur = colIdx(["entry value €", "entry value eur"]);

  const results: NewTradeInput[] = [];

  for (const row of dataRows) {
    const rawTicker = idxTicker !== -1 ? row[idxTicker]?.trim() : "";
    if (!rawTicker) continue;

    const rawCurrency =
      (idxCurrency !== -1 ? row[idxCurrency]?.trim().toUpperCase() : "") || "USD";
    const tickerInfo = mapToYahooTicker(rawTicker, rawCurrency);
    const currency = tickerInfo.inferredCurrency;

    const gicsSector =
      (idxSector !== -1 ? row[idxSector]?.trim() : "") || "Uncategorized";

    const startDate =
      (idxStartDate !== -1 ? row[idxStartDate]?.trim() : "") ||
      new Date().toISOString().slice(0, 10);
    const rawEndDate = idxEndDate !== -1 ? row[idxEndDate]?.trim() : "";
    const endDate = rawEndDate ? rawEndDate : null;

    const shares = parseNumber(idxShares !== -1 ? row[idxShares] : null);
    const buyPrice = parseNumber(idxBuyPrice !== -1 ? row[idxBuyPrice] : null);
    let sellPrice = parseNumber(idxSellPrice !== -1 ? row[idxSellPrice] : null);
    const latestPriceFromSheet = parseNumber(
      idxLatestPrice !== -1 ? row[idxLatestPrice] : null
    );
    const initialStopLoss = parseNumber(
      idxStopLoss !== -1 ? row[idxStopLoss] : null
    );

    if (shares === null || buyPrice === null || initialStopLoss === null) {
      continue;
    }

    // Heal anomaly (e.g. Row 89 ERO): if trade has an End Date (closed) but Sell Price is missing,
    // use the sheet's Latest Price so the closed trade has its exit price properly recorded.
    if (endDate && sellPrice === null && latestPriceFromSheet !== null) {
      sellPrice = latestPriceFromSheet;
    }

    const entryLocal = parseNumber(
      idxEntryValueLocal !== -1 ? row[idxEntryValueLocal] : null
    );
    const entryEur = parseNumber(
      idxEntryValueEur !== -1 ? row[idxEntryValueEur] : null
    );

    // Parse End/Latest FX Rate to EUR, healing #N/A values automatically
    let fxRateToEur = parseNumber(idxRateToEur !== -1 ? row[idxRateToEur] : null);
    if (currency === "EUR") {
      fxRateToEur = 1.0;
    } else if (fxRateToEur === null || fxRateToEur <= 0) {
      const dateKey = endDate ? `${currency}:${endDate}` : currency;

      if (HISTORICAL_FX_FALLBACKS[dateKey]) {
        fxRateToEur = HISTORICAL_FX_FALLBACKS[dateKey];
      } else if (entryLocal && entryEur && entryLocal > 0) {
        fxRateToEur = Number((entryEur / entryLocal).toFixed(6));
      } else {
        fxRateToEur = HISTORICAL_FX_FALLBACKS[currency] ?? 1.0;
      }
    }

    // Parse Start Date (Entry) FX Rate to EUR
    let entryFxRateToEur = parseNumber(
      idxEntryRateToEur !== -1 ? row[idxEntryRateToEur] : null
    );
    if (currency === "EUR") {
      entryFxRateToEur = 1.0;
    } else if (entryFxRateToEur === null || entryFxRateToEur <= 0) {
      const startDateKey = `${currency}:${startDate}`;
      if (entryLocal && entryEur && entryLocal > 0) {
        entryFxRateToEur = Number((entryEur / entryLocal).toFixed(6));
      } else if (HISTORICAL_FX_FALLBACKS[startDateKey]) {
        entryFxRateToEur = HISTORICAL_FX_FALLBACKS[startDateKey];
      } else {
        entryFxRateToEur = HISTORICAL_FX_FALLBACKS[currency] ?? fxRateToEur ?? 1.0;
      }
    }

    const rawStopMoved =
      idxStopMoved !== -1 ? row[idxStopMoved]?.trim().toLowerCase() : "";
    const stopMoved =
      rawStopMoved === "done" ||
      rawStopMoved === "true" ||
      rawStopMoved === "1" ||
      rawStopMoved === "yes";

    const rawTrimmed =
      idxTrimmed !== -1 ? row[idxTrimmed]?.trim().toLowerCase() : "";
    const trimmedAt2R =
      rawTrimmed === "trimmed" ||
      rawTrimmed === "true" ||
      rawTrimmed === "1" ||
      rawTrimmed === "yes";

    results.push({
      ticker: tickerInfo.yahooTicker || tickerInfo.rawTicker,
      gicsSector,
      startDate,
      endDate,
      shares,
      buyPrice,
      sellPrice,
      currency,
      initialStopLoss,
      stopMoved,
      trimmedAt2R,
      manualLatestPrice: !endDate ? latestPriceFromSheet : null,
      entryFxRateToEur,
      fxRateToEur,
      notes: null,
    });
  }

  return results;
}

