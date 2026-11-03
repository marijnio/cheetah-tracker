import type { TradeRecord } from "./db/schema";

export interface ComputedTrade extends TradeRecord {
  isOpen: boolean;
  entryValueLocal: number;
  entryValueEur: number;
  entrySizePercentOfMax: number; // 0 to 100 for the inline horizontal sizing bar
  initialRiskPercent: number; // e.g., 0.06 for 6.0%
  tradingDaysHeld: number;
  latestPrice: number;
  latestValueLocal: number;
  latestValueEur: number;
  gainLossPercent: number; // e.g., 0.187 for 18.7%
  gainLossLocal: number;
  gainLossEur: number;
  rateToEur: number;
  rMultiple: number;
  moveStopAt: number; // 2R price level: Buy Price * (1 + 2 * Initial Risk %)
  percentLeftBeforeMove: number | null; // null when Stop Moved is true or Latest Price >= Move Stop At
}

export interface PortfolioKPIs {
  totalTrades: number;
  closedTrades: number;
  openPositions: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // e.g., 0.515 for 51.5%
  avgWinPercent: number; // e.g., 0.095 for 9.5%
  avgLossPercent: number; // e.g., -0.038 for -3.8%
  gainLossRatio: number; // Avg Win % / ABS(Avg Loss %)
  totalGainLossEur: number;
  realizedGainLossEur: number;
  unrealizedGainLossEur: number;
  totalGainLossUsdEquivalent: number;
  mathExpectancy: number; // (Win Rate * Avg Win %) - (Loss Rate * ABS(Avg Loss %))
  avgRMultiple: number;
  avgWinR: number;
  avgLossR: number;
  openExposureEur: number;
  openRiskEur: number;
}

/**
 * Counts business days (Mon-Fri) between two YYYY-MM-DD dates.
 * Matches Google Sheets `NETWORKDAYS(start, end) - 1` where same-day trade = 0 days held.
 */
export function calculateTradingDaysHeld(startDateStr: string, endDateStr?: string | null, todayStr?: string): number {
  const startParts = startDateStr.split("-").map(Number);
  const endTarget = endDateStr || todayStr || new Date().toISOString().slice(0, 10);
  const endParts = endTarget.split("-").map(Number);

  if (startParts.length !== 3 || endParts.length !== 3) return 0;

  const start = new Date(Date.UTC(startParts[0], startParts[1] - 1, startParts[2]));
  const end = new Date(Date.UTC(endParts[0], endParts[1] - 1, endParts[2]));

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return 0;
  }

  let businessDays = 0;
  const cursor = new Date(start);
  cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor <= end) {
    const dayOfWeek = cursor.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return businessDays;
}

/**
 * Enriches raw trade records with all SEPA calculated fields and relative sizing bar widths.
 */
export function computeTradesWithMetrics(
  rawTrades: TradeRecord[],
  liveQuoteMap: Record<string, number> = {},
  liveFxMap: Record<string, number> = {},
  referenceToday?: string
): ComputedTrade[] {
  const firstPass = rawTrades.map((trade) => {
    const isOpen = !trade.endDate;
    const currency = (trade.currency || "USD").toUpperCase();

    // Determine active FX rate to EUR
    // For EUR trades, rate is always 1.0.
    // For closed trades, use locked fxRateToEur.
    // For open trades, use liveFxMap if available, fallback to trade.fxRateToEur.
    const rateToEur =
      currency === "EUR"
        ? 1.0
        : isOpen
          ? (liveFxMap[currency] ?? trade.fxRateToEur ?? 1.0)
          : (trade.fxRateToEur ?? 1.0);

    // Determine Latest Price
    // Closed trades always use sellPrice (with fallback to manualLatestPrice or buyPrice)
    // Open trades use liveQuoteMap -> manualLatestPrice -> buyPrice
    const latestPrice = isOpen
      ? (liveQuoteMap[trade.yahooTicker] ?? trade.manualLatestPrice ?? trade.buyPrice)
      : (trade.sellPrice ?? trade.manualLatestPrice ?? trade.buyPrice);

    const entryValueLocal = trade.shares * trade.buyPrice;
    const entryValueEur = entryValueLocal * rateToEur;

    const latestValueLocal = trade.shares * latestPrice;
    const latestValueEur = latestValueLocal * rateToEur;

    const initialRiskPerShare = trade.buyPrice - trade.initialStopLoss;
    const initialRiskPercent = trade.buyPrice > 0 ? initialRiskPerShare / trade.buyPrice : 0;

    const tradingDaysHeld = calculateTradingDaysHeld(trade.startDate, trade.endDate, referenceToday);

    const gainLossLocal = latestValueLocal - entryValueLocal;
    const gainLossEur = gainLossLocal * rateToEur;
    const gainLossPercent = trade.buyPrice > 0 ? (latestPrice - trade.buyPrice) / trade.buyPrice : 0;

    // R-Multiple = Gain/Loss % / Initial Risk %
    const rMultiple =
      initialRiskPercent > 0 ? gainLossPercent / initialRiskPercent : 0;

    // Move Stop At = 2R Target Price = Buy Price * (1 + 2 * Initial Risk %)
    const moveStopAt = trade.buyPrice * (1 + 2 * initialRiskPercent);

    // % Left Before Move = (Move Stop At - Latest Price) / Latest Price
    // Hidden (null) once Stop Moved is checked OR once price has already reached/exceeded Move Stop At
    const percentLeftBeforeMove =
      trade.stopMoved || latestPrice >= moveStopAt || latestPrice <= 0
        ? null
        : (moveStopAt - latestPrice) / latestPrice;

    return {
      ...trade,
      isOpen,
      entryValueLocal,
      entryValueEur,
      entrySizePercentOfMax: 0, // populated in second pass
      initialRiskPercent,
      tradingDaysHeld,
      latestPrice,
      latestValueLocal,
      latestValueEur,
      gainLossPercent,
      gainLossLocal,
      gainLossEur,
      rateToEur,
      rMultiple,
      moveStopAt,
      percentLeftBeforeMove,
    };
  });

  // Compute max Entry Value € for the inline visual position-sizing bar
  const maxEntryEur = firstPass.reduce(
    (max, t) => (t.entryValueEur > max ? t.entryValueEur : max),
    0
  );

  return firstPass.map((t) => ({
    ...t,
    entrySizePercentOfMax:
      maxEntryEur > 0 ? Math.min(100, Math.max(4, (t.entryValueEur / maxEntryEur) * 100)) : 0,
  }));
}

/**
 * Computes top-level SEPA KPI summary metrics across a list of computed trades.
 */
export function computePortfolioKPIs(trades: ComputedTrade[]): PortfolioKPIs {
  const totalTrades = trades.length;
  const openTrades = trades.filter((t) => t.isOpen);
  const closedTradesList = trades.filter((t) => !t.isOpen);

  const openPositions = openTrades.length;
  const closedTrades = closedTradesList.length;

  // In Minervini's SEPA tracking (and matching the Google Sheet), Win Rate, Avg Win %, Avg Loss %
  // evaluate all trades with a non-zero outcome or all trades in the ledger.
  // Let's check: in the Google Sheet, 68 wins / 132 total = 51.515% (51.5%).
  const winners = trades.filter((t) => t.gainLossPercent > 0);
  const losers = trades.filter((t) => t.gainLossPercent <= 0);

  const winningTrades = winners.length;
  const losingTrades = losers.length;

  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  const lossRate = totalTrades > 0 ? 1 - winRate : 0;

  const avgWinPercent =
    winners.length > 0
      ? winners.reduce((sum, t) => sum + t.gainLossPercent, 0) / winners.length
      : 0;

  const avgLossPercent =
    losers.length > 0
      ? losers.reduce((sum, t) => sum + t.gainLossPercent, 0) / losers.length
      : 0;

  const absAvgLoss = Math.abs(avgLossPercent);
  const gainLossRatio = absAvgLoss > 0 ? avgWinPercent / absAvgLoss : 0;

  // Mathematical Expectancy = (Win Rate * Avg Win %) - (Loss Rate * ABS(Avg Loss %))
  const mathExpectancy = winRate * avgWinPercent - lossRate * absAvgLoss;

  const totalGainLossEur = trades.reduce((sum, t) => sum + t.gainLossEur, 0);
  const realizedGainLossEur = closedTradesList.reduce((sum, t) => sum + t.gainLossEur, 0);
  const unrealizedGainLossEur = openTrades.reduce((sum, t) => sum + t.gainLossEur, 0);

  // Also compute USD-only / local sum for reference
  const totalGainLossUsdEquivalent = trades.reduce((sum, t) => sum + t.gainLossLocal, 0);

  const avgRMultiple =
    totalTrades > 0 ? trades.reduce((sum, t) => sum + t.rMultiple, 0) / totalTrades : 0;

  const avgWinR =
    winners.length > 0 ? winners.reduce((sum, t) => sum + t.rMultiple, 0) / winners.length : 0;

  const avgLossR =
    losers.length > 0 ? losers.reduce((sum, t) => sum + t.rMultiple, 0) / losers.length : 0;

  const openExposureEur = openTrades.reduce((sum, t) => sum + t.latestValueEur, 0);
  const openRiskEur = openTrades.reduce((sum, t) => {
    if (t.stopMoved) return sum; // Stop moved to breakeven = 0 initial capital at risk
    const riskLocal = Math.max(0, (t.buyPrice - t.initialStopLoss) * t.shares);
    return sum + riskLocal * t.rateToEur;
  }, 0);

  return {
    totalTrades,
    closedTrades,
    openPositions,
    winningTrades,
    losingTrades,
    winRate,
    avgWinPercent,
    avgLossPercent,
    gainLossRatio,
    totalGainLossEur,
    realizedGainLossEur,
    unrealizedGainLossEur,
    totalGainLossUsdEquivalent,
    mathExpectancy,
    avgRMultiple,
    avgWinR,
    avgLossR,
    openExposureEur,
    openRiskEur,
  };
}

