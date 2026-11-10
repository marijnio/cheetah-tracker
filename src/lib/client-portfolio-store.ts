import type {
  TradeRecord,
  NewTradeInput,
  SecurityRecord,
  NewSecurityInput,
  ForexPairRecord,
  NewForexPairInput,
} from "./db/schema";
import {
  computeTradesWithMetrics,
  computePortfolioKPIs,
  type ComputedTrade,
  type PortfolioKPIs,
} from "./trade-math";
import { mapToYahooTicker } from "./ticker-mapper";

export const WORKSPACE_STORAGE_KEY = "cheetah_portfolio_workspace_v1";

export const KNOWN_COMPANY_NAMES: Record<string, string> = {
  TSM: "Taiwan Semiconductor Mfg. Co.",
  NBIS: "Nebius Group N.V.",
  ASML: "ASML Holding N.V. (ADR)",
  "ASML.AS": "ASML Holding N.V.",
  "AMS:ASML": "ASML Holding N.V.",
  AVGO: "Broadcom Inc.",
  VRT: "Vertiv Holdings Co",
  SNDK: "SanDisk Corp.",
  HIG: "The Hartford Financial Services",
  ERIC: "Telefonaktiebolaget LM Ericsson",
  VIK: "Viking Holdings Ltd",
  RL: "Ralph Lauren Corporation",
  NVDA: "NVIDIA Corporation",
  ACT: "Enact Holdings, Inc.",
  MU: "Micron Technology, Inc.",
  POWL: "Powell Industries, Inc.",
  CVE: "Cenovus Energy Inc.",
  MCRI: "Monarch Casino & Resort, Inc.",
  TNK: "Teekay Tankers Ltd.",
  PR: "Permian Resources Corporation",
  FANG: "Diamondback Energy, Inc.",
  DVN: "Devon Energy Corporation",
  CBOE: "Cboe Global Markets, Inc.",
  GOOG: "Alphabet Inc. (Class C)",
  GOOGL: "Alphabet Inc. (Class A)",
  BHP: "BHP Group Limited",
  IBKR: "Interactive Brokers Group",
  MLI: "Mueller Industries, Inc.",
  "INGA.AS": "ING Groep N.V.",
  "AMS:INGA": "ING Groep N.V.",
  ING: "ING Groep N.V. (ADR)",
  BLBD: "Blue Bird Corporation",
  CF: "CF Industries Holdings, Inc.",
  VLO: "Valero Energy Corporation",
  ERO: "Ero Copper Corp.",
  REPX: "Riley Exploration Permian",
  CNQ: "Canadian Natural Resources (NYSE)",
  "CNQ.TO": "Canadian Natural Resources Ltd.",
  "TSE:CNQ": "Canadian Natural Resources Ltd.",
  XOM: "Exxon Mobil Corporation",
  "SXLEL.XC": "SPDR S&P U.S. Energy Select ETF",
  SXLE: "SPDR S&P U.S. Energy Select ETF",
  RIG: "Transocean Ltd.",
  AMR: "Alpha Metallurgical Resources",
  CROX: "Crocs, Inc.",
  VMI: "Valmont Industries, Inc.",
  HCC: "Warrior Met Coal, Inc.",
  DOCN: "DigitalOcean Holdings, Inc.",
  "IUES.L": "iShares S&P 500 Energy Sector UCITS",
  "LON:IUES": "iShares S&P 500 Energy Sector UCITS",
  MOH: "Molina Healthcare, Inc.",
  GLW: "Corning Incorporated",
  FIX: "Comfort Systems USA, Inc.",
  DHT: "DHT Holdings, Inc.",
  JPM: "JPMorgan Chase & Co.",
  "VWS.CO": "Vestas Wind Systems A/S",
  VWS: "Vestas Wind Systems A/S",
  "EVO.ST": "Evolution AB (publ)",
  "STO:EVO": "Evolution AB (publ)",
  INTC: "Intel Corporation",
  PBR: "Petróleo Brasileiro S.A. - Petrobras",
  ASX: "ASE Technology Holding Co.",
  FRSH: "Freshworks Inc.",
  SN: "SharkNinja, Inc.",
  GCT: "GigaCloud Technology Inc.",
  "INVE-B.ST": "Investor AB (Class B)",
  "STO:INVE-B": "Investor AB (Class B)",
  TXN: "Texas Instruments Incorporated",
};

const DEFAULT_FOREX_RATES: Record<string, number> = {
  EUR: 1.0,
  USD: 0.89338,
  CAD: 0.621215,
  SEK: 0.09125,
  DKK: 0.133774,
  GBP: 1.185,
};

export function getDefaultFxToEur(currency: string): number {
  const ccy = currency.trim().toUpperCase();
  return DEFAULT_FOREX_RATES[ccy] ?? 1.0;
}

export function createDefaultForexPairs(): ForexPairRecord[] {
  const now = new Date().toISOString();
  const pairs: Array<{
    id: number;
    fromCurrency: string;
    yahooSymbol: string;
    latestRate: number;
  }> = [
    { id: 1, fromCurrency: "USD", yahooSymbol: "USDEUR=X", latestRate: 0.89338 },
    { id: 2, fromCurrency: "CAD", yahooSymbol: "CADEUR=X", latestRate: 0.621215 },
    { id: 3, fromCurrency: "SEK", yahooSymbol: "SEKEUR=X", latestRate: 0.09125 },
    { id: 4, fromCurrency: "DKK", yahooSymbol: "DKKEUR=X", latestRate: 0.133774 },
    { id: 5, fromCurrency: "GBP", yahooSymbol: "GBPEUR=X", latestRate: 1.185 },
  ];

  return pairs.map((p) => ({
    id: p.id,
    fromCurrency: p.fromCurrency,
    toCurrency: "EUR",
    pairLabel: `${p.fromCurrency} / EUR`,
    liveProvider: "YAHOO",
    yahooSymbol: p.yahooSymbol,
    historicalProvider: "FRANKFURTER",
    latestRate: p.latestRate,
    previousClose: null,
    lastUpdated: now,
    syncStatus: "OK",
    syncError: null,
    createdAt: now,
    updatedAt: now,
  }));
}

export interface ClientWorkspaceData {
  fileName: string;
  lastSavedAt: string | null;
  isDirty: boolean;
  cashBalance: number;
  riskPercent: number;
  trades: TradeRecord[];
  securities: SecurityRecord[];
  forexPairs: ForexPairRecord[];
}

export interface ComputedWorkspacePayload {
  trades: ComputedTrade[];
  kpis: PortfolioKPIs;
  securities: SecurityRecord[];
  forexPairs: ForexPairRecord[];
}

/**
 * Normalizes relationships between trades, securities, and forexPairs,
 * and computes all trade metrics and portfolio KPIs.
 */
export function normalizeAndComputeWorkspace(
  rawTrades: TradeRecord[],
  rawSecurities: SecurityRecord[],
  rawForexPairs: ForexPairRecord[]
): ComputedWorkspacePayload {
  const now = new Date().toISOString();

  // 1. Ensure default Forex pairs + any trade/security currency exist
  const forexMap = new Map<string, ForexPairRecord>();
  const baseForex =
    rawForexPairs.length > 0 ? rawForexPairs : createDefaultForexPairs();

  let maxFxId = baseForex.reduce((m, f) => Math.max(m, f.id || 0), 0);
  for (const fx of baseForex) {
    forexMap.set(fx.fromCurrency.toUpperCase(), { ...fx });
  }

  const ensureCurrencyPair = (ccy: string) => {
    const upper = (ccy || "USD").trim().toUpperCase();
    if (!upper || upper === "EUR" || forexMap.has(upper)) return;
    maxFxId++;
    forexMap.set(upper, {
      id: maxFxId,
      fromCurrency: upper,
      toCurrency: "EUR",
      pairLabel: `${upper} / EUR`,
      liveProvider: "YAHOO",
      yahooSymbol: `${upper}EUR=X`,
      historicalProvider: "FRANKFURTER",
      latestRate: getDefaultFxToEur(upper),
      previousClose: null,
      lastUpdated: now,
      syncStatus: "OK",
      syncError: null,
      createdAt: now,
      updatedAt: now,
    });
  };

  // 2. Build Securities Map by ticker & id, and auto-create securities for any unlinked trade tickers
  const secByTicker = new Map<string, SecurityRecord>();
  const secById = new Map<number, SecurityRecord>();
  let maxSecId = rawSecurities.reduce((m, s) => Math.max(m, s.id || 0), 0);

  for (const sec of rawSecurities) {
    const cleanTicker = sec.ticker.trim().toUpperCase();
    const copy: SecurityRecord = {
      ...sec,
      ticker: cleanTicker,
      name: sec.name || KNOWN_COMPANY_NAMES[cleanTicker] || cleanTicker,
      tradeCount: 0,
      openTradeCount: 0,
    };
    secByTicker.set(cleanTicker, copy);
    secById.set(copy.id, copy);
    ensureCurrencyPair(copy.currency);
  }

  for (const t of rawTrades) {
    const cleanTicker = t.ticker.trim().toUpperCase();
    ensureCurrencyPair(t.currency);
    let sec =
      (t.securityId ? secById.get(t.securityId) : undefined) ||
      secByTicker.get(cleanTicker);
    if (!sec) {
      maxSecId++;
      sec = {
        id: maxSecId,
        ticker: cleanTicker,
        name: t.securityName || KNOWN_COMPANY_NAMES[cleanTicker] || cleanTicker,
        isin: null,
        gicsSector: t.gicsSector || "Uncategorized",
        currency: (t.currency || "USD").toUpperCase(),
        quoteProvider: "YAHOO",
        latestPrice: t.manualLatestPrice ?? t.sellPrice ?? t.buyPrice,
        previousClose: null,
        lastQuoteAt: now,
        quoteStatus: "OK",
        quoteError: null,
        tradingViewUrl: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
        tradeCount: 0,
        openTradeCount: 0,
      };
      secByTicker.set(cleanTicker, sec);
      secById.set(sec.id, sec);
    } else if (
      sec.latestPrice === null &&
      (t.manualLatestPrice !== null || t.sellPrice !== null || t.buyPrice > 0)
    ) {
      sec.latestPrice = t.manualLatestPrice ?? t.sellPrice ?? t.buyPrice;
    }
  }

  // 3. Enrich trades with security metadata and count trades per security
  const enrichedTrades: TradeRecord[] = rawTrades.map((t, index) => {
    const cleanTicker = t.ticker.trim().toUpperCase();
    const sec =
      (t.securityId ? secById.get(t.securityId) : undefined) ||
      secByTicker.get(cleanTicker);

    if (sec) {
      sec.tradeCount = (sec.tradeCount ?? 0) + 1;
      if (!t.endDate) {
        sec.openTradeCount = (sec.openTradeCount ?? 0) + 1;
      }
    }

    const ccy = (t.currency || sec?.currency || "USD").toUpperCase();
    const exitFx = ccy === "EUR" ? 1.0 : t.fxRateToEur || getDefaultFxToEur(ccy);
    const entryFx =
      ccy === "EUR" ? 1.0 : t.entryFxRateToEur ?? t.fxRateToEur ?? exitFx;

    return {
      ...t,
      id: t.id || index + 1,
      securityId: sec ? sec.id : t.securityId,
      ticker: sec ? sec.ticker : cleanTicker,
      securityName:
        sec?.name ||
        t.securityName ||
        KNOWN_COMPANY_NAMES[cleanTicker] ||
        cleanTicker,
      gicsSector: t.gicsSector || sec?.gicsSector || "Uncategorized",
      currency: ccy,
      entryFxRateToEur: entryFx,
      fxRateToEur: exitFx,
      lastQuoteAt: sec?.lastQuoteAt ?? t.lastQuoteAt ?? null,
      quoteStatus: sec?.quoteStatus ?? t.quoteStatus ?? "OK",
      quoteProvider: sec?.quoteProvider ?? t.quoteProvider ?? "YAHOO",
      quoteError: sec?.quoteError ?? t.quoteError ?? null,
      previousClose: sec?.previousClose ?? t.previousClose ?? null,
      tradingViewUrl: sec?.tradingViewUrl ?? t.tradingViewUrl ?? null,
    };
  });

  // Sort trades: Open positions first, then by COALESCE(endDate, startDate) DESC, startDate DESC, id DESC
  enrichedTrades.sort((a, b) => {
    const aOpen = !a.endDate ? 0 : 1;
    const bOpen = !b.endDate ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;

    const aDate = a.endDate || a.startDate || "";
    const bDate = b.endDate || b.startDate || "";
    if (aDate !== bDate) return bDate.localeCompare(aDate);

    if (a.startDate !== b.startDate) {
      return (b.startDate || "").localeCompare(a.startDate || "");
    }
    return (b.id || 0) - (a.id || 0);
  });

  // Sort securities: openTradeCount DESC, ticker ASC
  const normalizedSecurities = Array.from(secById.values()).sort((a, b) => {
    const openDiff = (b.openTradeCount ?? 0) - (a.openTradeCount ?? 0);
    if (openDiff !== 0) return openDiff;
    return a.ticker.localeCompare(b.ticker);
  });

  // Sort forex pairs: fromCurrency ASC
  const normalizedForexPairs = Array.from(forexMap.values()).sort((a, b) =>
    a.fromCurrency.localeCompare(b.fromCurrency)
  );

  // Build liveQuoteMap and liveFxMap
  const liveQuoteMap: Record<string, number> = {};
  for (const s of normalizedSecurities) {
    if (s.latestPrice !== null && s.latestPrice !== undefined) {
      liveQuoteMap[s.ticker] = s.latestPrice;
    }
  }

  const liveFxMap: Record<string, number> = { EUR: 1.0 };
  for (const f of normalizedForexPairs) {
    liveFxMap[f.fromCurrency] = f.latestRate;
  }

  const computedTrades = computeTradesWithMetrics(
    enrichedTrades,
    liveQuoteMap,
    liveFxMap
  );
  const kpis = computePortfolioKPIs(computedTrades);

  return {
    trades: computedTrades,
    kpis,
    securities: normalizedSecurities,
    forexPairs: normalizedForexPairs,
  };
}

/**
 * Strips computed metrics from ComputedTrade[] to store clean TradeRecord[] in localStorage/XML.
 */
export function stripComputedTradeFields(
  trades: Array<TradeRecord | ComputedTrade>
): TradeRecord[] {
  return trades.map((t) => ({
    id: t.id,
    securityId: t.securityId,
    ticker: t.ticker,
    securityName: t.securityName,
    gicsSector: t.gicsSector,
    startDate: t.startDate,
    endDate: t.endDate,
    shares: t.shares,
    buyPrice: t.buyPrice,
    sellPrice: t.sellPrice,
    currency: t.currency,
    initialStopLoss: t.initialStopLoss,
    stopMoved: Boolean(t.stopMoved),
    trimmedAt2R: Boolean(t.trimmedAt2R),
    manualLatestPrice: t.manualLatestPrice,
    entryFxRateToEur: t.entryFxRateToEur,
    fxRateToEur: t.fxRateToEur,
    notes: t.notes,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastQuoteAt: t.lastQuoteAt,
    quoteStatus: t.quoteStatus,
    quoteProvider: t.quoteProvider,
    quoteError: t.quoteError,
    previousClose: t.previousClose,
    tradingViewUrl: t.tradingViewUrl,
  }));
}

export function loadWorkspaceFromLocalStorage(): ClientWorkspaceData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientWorkspaceData>;
    if (!parsed || !Array.isArray(parsed.trades)) return null;

    const savedCash = localStorage.getItem("cheetah_cash_balance");
    const savedRisk = localStorage.getItem("cheetah_risk_percent");

    return {
      fileName: parsed.fileName || "cheetah-portfolio.xml",
      lastSavedAt: parsed.lastSavedAt ?? null,
      isDirty: Boolean(parsed.isDirty),
      cashBalance:
        savedCash && !Number.isNaN(Number(savedCash))
          ? Number(savedCash)
          : parsed.cashBalance ?? 25000,
      riskPercent:
        savedRisk && !Number.isNaN(Number(savedRisk))
          ? Number(savedRisk)
          : parsed.riskPercent ?? 1.0,
      trades: parsed.trades,
      securities: Array.isArray(parsed.securities) ? parsed.securities : [],
      forexPairs: Array.isArray(parsed.forexPairs)
        ? parsed.forexPairs
        : createDefaultForexPairs(),
    };
  } catch (err) {
    console.error("Failed to read workspace from localStorage:", err);
    return null;
  }
}

export function saveWorkspaceToLocalStorage(data: ClientWorkspaceData): void {
  if (typeof window === "undefined") return;
  try {
    const cleanPayload: ClientWorkspaceData = {
      ...data,
      trades: stripComputedTradeFields(data.trades),
    };
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(cleanPayload));
    localStorage.setItem("cheetah_cash_balance", String(data.cashBalance));
    localStorage.setItem("cheetah_risk_percent", String(data.riskPercent));
  } catch (err) {
    console.error("Failed to save workspace to localStorage:", err);
  }
}

// ============================================================================
// PURE CRUD MUTATORS FOR CLIENT WORKSPACE
// ============================================================================

export function clientCreateTrade(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  input: NewTradeInput
): ComputedWorkspacePayload {
  const now = new Date().toISOString();
  const nextSecurities = [...currentSecurities];
  const nextForex = [...currentForexPairs];

  let security = input.securityId
    ? nextSecurities.find((s) => s.id === input.securityId) || null
    : null;

  const tickerInfo = mapToYahooTicker(input.ticker, input.currency);
  const unifiedTicker = (
    tickerInfo.yahooTicker || tickerInfo.rawTicker
  ).toUpperCase();

  if (!security) {
    security =
      nextSecurities.find((s) => s.ticker.toUpperCase() === unifiedTicker) ||
      null;
  }

  if (!security) {
    const nextSecId =
      nextSecurities.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
    const ccy = (input.currency || tickerInfo.inferredCurrency).toUpperCase();
    security = {
      id: nextSecId,
      ticker: unifiedTicker,
      name:
        KNOWN_COMPANY_NAMES[unifiedTicker] ||
        KNOWN_COMPANY_NAMES[tickerInfo.rawTicker] ||
        tickerInfo.symbol,
      isin: null,
      gicsSector: input.gicsSector || "Uncategorized",
      currency: ccy,
      quoteProvider: "YAHOO",
      latestPrice: input.manualLatestPrice ?? input.sellPrice ?? input.buyPrice,
      previousClose: null,
      lastQuoteAt: now,
      quoteStatus: "OK",
      quoteError: null,
      tradingViewUrl: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    };
    nextSecurities.push(security);
  } else if (input.manualLatestPrice && !security.latestPrice) {
    security = {
      ...security,
      latestPrice: input.manualLatestPrice,
      updatedAt: now,
    };
    const idx = nextSecurities.findIndex((s) => s.id === security!.id);
    if (idx !== -1) nextSecurities[idx] = security;
  }

  const currency = security.currency.toUpperCase();
  const liveFx = nextForex.find((f) => f.fromCurrency === currency)?.latestRate;
  const fxRate =
    currency === "EUR"
      ? 1.0
      : input.fxRateToEur ?? liveFx ?? getDefaultFxToEur(currency);
  const entryFxRate =
    currency === "EUR" ? 1.0 : input.entryFxRateToEur ?? fxRate;

  const nextTradeId =
    currentTrades.reduce((m, t) => Math.max(m, t.id || 0), 0) + 1;

  const newTrade: TradeRecord = {
    id: nextTradeId,
    securityId: security.id,
    ticker: security.ticker,
    securityName: security.name,
    gicsSector: input.gicsSector || security.gicsSector,
    startDate: input.startDate,
    endDate: input.endDate || null,
    shares: input.shares,
    buyPrice: input.buyPrice,
    sellPrice: input.sellPrice ?? null,
    currency,
    initialStopLoss: input.initialStopLoss,
    stopMoved: Boolean(input.stopMoved),
    trimmedAt2R: Boolean(input.trimmedAt2R),
    manualLatestPrice: input.manualLatestPrice ?? null,
    entryFxRateToEur: entryFxRate,
    fxRateToEur: fxRate,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return normalizeAndComputeWorkspace(
    [newTrade, ...stripComputedTradeFields(currentTrades)],
    nextSecurities,
    nextForex
  );
}

export function clientUpdateTrade(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  id: number,
  updates: Partial<NewTradeInput>
): ComputedWorkspacePayload {
  const now = new Date().toISOString();
  const nextSecurities = [...currentSecurities];
  const rawTrades = stripComputedTradeFields(currentTrades);
  const idx = rawTrades.findIndex((t) => t.id === id);
  if (idx === -1) {
    return normalizeAndComputeWorkspace(
      rawTrades,
      nextSecurities,
      currentForexPairs
    );
  }

  const existing = rawTrades[idx];
  let securityId =
    updates.securityId !== undefined ? updates.securityId : existing.securityId;
  let nextTicker =
    updates.ticker !== undefined ? updates.ticker : existing.ticker;
  let nextCurrency = (
    updates.currency !== undefined ? updates.currency : existing.currency
  ).toUpperCase();
  let nextSector =
    updates.gicsSector !== undefined ? updates.gicsSector : existing.gicsSector;

  if (updates.securityId && updates.securityId !== existing.securityId) {
    const linkedSec = nextSecurities.find((s) => s.id === updates.securityId);
    if (linkedSec) {
      securityId = linkedSec.id;
      nextTicker = linkedSec.ticker;
      nextCurrency = linkedSec.currency;
      nextSector = linkedSec.gicsSector;
    }
  } else if (updates.ticker && updates.ticker !== existing.ticker) {
    const mapped = mapToYahooTicker(updates.ticker, nextCurrency);
    const unified = (mapped.yahooTicker || mapped.rawTicker).toUpperCase();
    let sec = nextSecurities.find((s) => s.ticker.toUpperCase() === unified);
    if (!sec) {
      const nextSecId =
        nextSecurities.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
      sec = {
        id: nextSecId,
        ticker: unified,
        name: KNOWN_COMPANY_NAMES[unified] || unified,
        isin: null,
        gicsSector: nextSector,
        currency: nextCurrency,
        quoteProvider: "YAHOO",
        latestPrice: null,
        previousClose: null,
        lastQuoteAt: null,
        quoteStatus: "PENDING",
        quoteError: null,
        tradingViewUrl: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
      };
      nextSecurities.push(sec);
    }
    securityId = sec.id;
    nextTicker = sec.ticker;
  }

  const nextFxRate =
    nextCurrency === "EUR"
      ? 1.0
      : updates.fxRateToEur !== undefined
        ? updates.fxRateToEur
        : existing.fxRateToEur;
  const nextEntryFxRate =
    nextCurrency === "EUR"
      ? 1.0
      : updates.entryFxRateToEur !== undefined
        ? updates.entryFxRateToEur
        : existing.entryFxRateToEur;

  rawTrades[idx] = {
    ...existing,
    securityId,
    ticker: nextTicker,
    gicsSector: nextSector,
    startDate:
      updates.startDate !== undefined ? updates.startDate : existing.startDate,
    endDate:
      updates.endDate !== undefined
        ? updates.endDate || null
        : existing.endDate,
    shares: updates.shares !== undefined ? updates.shares : existing.shares,
    buyPrice:
      updates.buyPrice !== undefined ? updates.buyPrice : existing.buyPrice,
    sellPrice:
      updates.sellPrice !== undefined
        ? updates.sellPrice ?? null
        : existing.sellPrice,
    currency: nextCurrency,
    initialStopLoss:
      updates.initialStopLoss !== undefined
        ? updates.initialStopLoss
        : existing.initialStopLoss,
    stopMoved:
      updates.stopMoved !== undefined ? updates.stopMoved : existing.stopMoved,
    trimmedAt2R:
      updates.trimmedAt2R !== undefined
        ? updates.trimmedAt2R
        : existing.trimmedAt2R,
    manualLatestPrice:
      updates.manualLatestPrice !== undefined
        ? updates.manualLatestPrice ?? null
        : existing.manualLatestPrice,
    entryFxRateToEur: nextEntryFxRate,
    fxRateToEur: nextFxRate,
    notes: updates.notes !== undefined ? updates.notes : existing.notes,
    updatedAt: now,
  };

  return normalizeAndComputeWorkspace(
    rawTrades,
    nextSecurities,
    currentForexPairs
  );
}

export function clientDeleteTrade(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  id: number
): ComputedWorkspacePayload {
  const remaining = stripComputedTradeFields(currentTrades).filter(
    (t) => t.id !== id
  );
  return normalizeAndComputeWorkspace(
    remaining,
    currentSecurities,
    currentForexPairs
  );
}

export function clientBulkImportTrades(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  items: NewTradeInput[],
  replaceExisting: boolean
): ComputedWorkspacePayload {
  const now = new Date().toISOString();
  const baseTrades = replaceExisting
    ? []
    : stripComputedTradeFields(currentTrades);
  let nextId = baseTrades.reduce((m, t) => Math.max(m, t.id || 0), 0);

  const imported: TradeRecord[] = items.map((item) => {
    nextId++;
    const tickerInfo = mapToYahooTicker(item.ticker, item.currency);
    const unifiedTicker = (
      tickerInfo.yahooTicker || tickerInfo.rawTicker
    ).toUpperCase();
    const currency = (
      item.currency || tickerInfo.inferredCurrency
    ).toUpperCase();
    const fxRate =
      currency === "EUR"
        ? 1.0
        : item.fxRateToEur ?? getDefaultFxToEur(currency);
    const entryFxRate =
      currency === "EUR" ? 1.0 : item.entryFxRateToEur ?? fxRate;

    return {
      id: nextId,
      securityId: null,
      ticker: unifiedTicker,
      gicsSector: item.gicsSector || "Uncategorized",
      startDate: item.startDate,
      endDate: item.endDate || null,
      shares: item.shares,
      buyPrice: item.buyPrice,
      sellPrice: item.sellPrice ?? null,
      currency,
      initialStopLoss: item.initialStopLoss,
      stopMoved: Boolean(item.stopMoved),
      trimmedAt2R: Boolean(item.trimmedAt2R),
      manualLatestPrice: item.manualLatestPrice ?? null,
      entryFxRateToEur: entryFxRate,
      fxRateToEur: fxRate,
      notes: item.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
  });

  return normalizeAndComputeWorkspace(
    [...imported, ...baseTrades],
    currentSecurities,
    currentForexPairs
  );
}

export function clientUpsertSecurity(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  input: NewSecurityInput & {
    previousClose?: number | null;
    lastQuoteAt?: string | null;
    quoteStatus?: SecurityRecord["quoteStatus"];
    quoteError?: string | null;
  }
): { security: SecurityRecord; payload: ComputedWorkspacePayload } {
  const now = new Date().toISOString();
  const nextSecurities = [...currentSecurities];
  const tickerInfo = mapToYahooTicker(input.ticker, input.currency);
  const ticker = (tickerInfo.yahooTicker || tickerInfo.rawTicker).toUpperCase();
  const currency = (
    input.currency || tickerInfo.inferredCurrency
  ).toUpperCase();
  const name =
    input.name?.trim() ||
    KNOWN_COMPANY_NAMES[ticker] ||
    KNOWN_COMPANY_NAMES[tickerInfo.rawTicker] ||
    tickerInfo.symbol;
  const gicsSector = input.gicsSector || "Uncategorized";
  const quoteProvider = input.quoteProvider || "YAHOO";

  const existingIdx = nextSecurities.findIndex(
    (s) => s.ticker.toUpperCase() === ticker
  );

  let targetSec: SecurityRecord;
  if (existingIdx !== -1) {
    const existing = nextSecurities[existingIdx];
    targetSec = {
      ...existing,
      name: input.name !== undefined ? name : existing.name,
      isin: input.isin !== undefined ? input.isin : existing.isin,
      gicsSector:
        input.gicsSector !== undefined ? gicsSector : existing.gicsSector,
      currency: input.currency !== undefined ? currency : existing.currency,
      quoteProvider:
        input.quoteProvider !== undefined
          ? quoteProvider
          : existing.quoteProvider,
      latestPrice:
        input.latestPrice !== undefined
          ? input.latestPrice
          : existing.latestPrice,
      previousClose:
        input.previousClose !== undefined
          ? input.previousClose
          : existing.previousClose,
      lastQuoteAt:
        input.lastQuoteAt !== undefined
          ? input.lastQuoteAt
          : existing.lastQuoteAt,
      quoteStatus:
        input.quoteStatus !== undefined
          ? input.quoteStatus
          : existing.quoteStatus,
      quoteError:
        input.quoteError !== undefined ? input.quoteError : existing.quoteError,
      tradingViewUrl:
        input.tradingViewUrl !== undefined
          ? input.tradingViewUrl
          : existing.tradingViewUrl,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      updatedAt: now,
    };
    nextSecurities[existingIdx] = targetSec;
  } else {
    const nextId =
      nextSecurities.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
    targetSec = {
      id: nextId,
      ticker,
      name,
      isin: input.isin ?? null,
      gicsSector,
      currency,
      quoteProvider,
      latestPrice: input.latestPrice ?? null,
      previousClose: input.previousClose ?? null,
      lastQuoteAt:
        input.lastQuoteAt ??
        (input.latestPrice !== undefined && input.latestPrice !== null
          ? now
          : null),
      quoteStatus:
        input.quoteStatus ??
        (quoteProvider === "MANUAL"
          ? "MANUAL"
          : input.latestPrice
            ? "OK"
            : "PENDING"),
      quoteError: input.quoteError ?? null,
      tradingViewUrl: input.tradingViewUrl ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    nextSecurities.push(targetSec);
  }

  const payload = normalizeAndComputeWorkspace(
    stripComputedTradeFields(currentTrades),
    nextSecurities,
    currentForexPairs
  );
  const resolvedSec =
    payload.securities.find((s) => s.id === targetSec.id) || targetSec;
  return { security: resolvedSec, payload };
}

export function clientUpdateSecurityById(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  id: number,
  updates: Partial<NewSecurityInput> & {
    previousClose?: number | null;
    lastQuoteAt?: string | null;
    quoteStatus?: SecurityRecord["quoteStatus"];
    quoteError?: string | null;
  }
): { security: SecurityRecord | null; payload: ComputedWorkspacePayload } {
  const now = new Date().toISOString();
  const nextSecurities = [...currentSecurities];
  const idx = nextSecurities.findIndex((s) => s.id === id);
  if (idx === -1) {
    return {
      security: null,
      payload: normalizeAndComputeWorkspace(
        stripComputedTradeFields(currentTrades),
        nextSecurities,
        currentForexPairs
      ),
    };
  }

  const existing = nextSecurities[idx];
  const rawTicker = (updates.ticker ?? existing.ticker).trim().toUpperCase();
  const nextTicker = mapToYahooTicker(rawTicker).yahooTicker;
  const nextCurrency = (updates.currency ?? existing.currency)
    .trim()
    .toUpperCase();
  const nextSector = updates.gicsSector ?? existing.gicsSector;
  const nextQuoteProvider = updates.quoteProvider ?? existing.quoteProvider;
  const nextLatestPrice =
    updates.latestPrice !== undefined
      ? updates.latestPrice
      : existing.latestPrice;

  const updatedSec: SecurityRecord = {
    ...existing,
    ticker: nextTicker,
    name: updates.name !== undefined ? updates.name : existing.name,
    isin: updates.isin !== undefined ? updates.isin : existing.isin,
    gicsSector: nextSector,
    currency: nextCurrency,
    quoteProvider: nextQuoteProvider,
    latestPrice: nextLatestPrice,
    previousClose:
      updates.previousClose !== undefined
        ? updates.previousClose
        : existing.previousClose,
    lastQuoteAt:
      updates.lastQuoteAt !== undefined
        ? updates.lastQuoteAt
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? now
          : existing.lastQuoteAt,
    quoteStatus:
      updates.quoteStatus !== undefined
        ? updates.quoteStatus
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? nextQuoteProvider === "MANUAL"
            ? "MANUAL"
            : "OK"
          : existing.quoteStatus,
    quoteError:
      updates.quoteError !== undefined
        ? updates.quoteError
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? null
          : existing.quoteError,
    tradingViewUrl:
      updates.tradingViewUrl !== undefined
        ? updates.tradingViewUrl
        : existing.tradingViewUrl,
    notes: updates.notes !== undefined ? updates.notes : existing.notes,
    updatedAt: now,
  };
  nextSecurities[idx] = updatedSec;

  // Propagate ticker, gicsSector, currency, and latestPrice to linked trades
  const rawTrades = stripComputedTradeFields(currentTrades).map((t) => {
    const isLinked =
      t.securityId === id ||
      (!t.securityId && t.ticker.toUpperCase() === existing.ticker);
    if (!isLinked) return t;
    return {
      ...t,
      securityId: id,
      ticker: nextTicker,
      gicsSector: nextSector,
      currency: nextCurrency,
      manualLatestPrice:
        updates.latestPrice !== undefined &&
        updates.latestPrice !== null &&
        !t.endDate
          ? updates.latestPrice
          : t.manualLatestPrice,
      updatedAt: now,
    };
  });

  const payload = normalizeAndComputeWorkspace(
    rawTrades,
    nextSecurities,
    currentForexPairs
  );
  const resolvedSec =
    payload.securities.find((s) => s.id === id) || updatedSec;
  return { security: resolvedSec, payload };
}

export function clientDeleteSecurityById(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  id: number
): ComputedWorkspacePayload {
  const nextSecurities = currentSecurities.filter((s) => s.id !== id);
  const rawTrades = stripComputedTradeFields(currentTrades).map((t) =>
    t.securityId === id ? { ...t, securityId: null } : t
  );
  return normalizeAndComputeWorkspace(
    rawTrades,
    nextSecurities,
    currentForexPairs
  );
}

export function clientUpsertForexPair(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  input: NewForexPairInput & {
    previousClose?: number | null;
    lastUpdated?: string | null;
    syncStatus?: ForexPairRecord["syncStatus"];
    syncError?: string | null;
  }
): { pair: ForexPairRecord; payload: ComputedWorkspacePayload } {
  const now = new Date().toISOString();
  const nextForex = [...currentForexPairs];
  const fromCcy = input.fromCurrency.trim().toUpperCase();
  const toCcy = (input.toCurrency || "EUR").trim().toUpperCase();
  const yahooSymbol = (
    input.yahooSymbol || `${fromCcy}${toCcy}=X`
  ).toUpperCase();
  const liveProvider = input.liveProvider || "YAHOO";
  const historicalProvider = input.historicalProvider || "FRANKFURTER";

  const idx = nextForex.findIndex((f) => f.fromCurrency === fromCcy);
  let targetPair: ForexPairRecord;

  if (idx !== -1) {
    const existing = nextForex[idx];
    targetPair = {
      ...existing,
      liveProvider,
      yahooSymbol,
      historicalProvider,
      latestRate: input.latestRate,
      previousClose:
        input.previousClose !== undefined
          ? input.previousClose
          : existing.previousClose,
      lastUpdated: input.lastUpdated ?? now,
      syncStatus: input.syncStatus ?? "OK",
      syncError: input.syncError ?? null,
      updatedAt: now,
    };
    nextForex[idx] = targetPair;
  } else {
    const nextId = nextForex.reduce((m, f) => Math.max(m, f.id || 0), 0) + 1;
    targetPair = {
      id: nextId,
      fromCurrency: fromCcy,
      toCurrency: toCcy,
      pairLabel: `${fromCcy} / ${toCcy}`,
      liveProvider,
      yahooSymbol,
      historicalProvider,
      latestRate: input.latestRate,
      previousClose: input.previousClose ?? null,
      lastUpdated: input.lastUpdated ?? now,
      syncStatus: input.syncStatus ?? "OK",
      syncError: input.syncError ?? null,
      createdAt: now,
      updatedAt: now,
    };
    nextForex.push(targetPair);
  }

  // Update open trades in this currency
  const rawTrades = stripComputedTradeFields(currentTrades).map((t) =>
    t.currency.toUpperCase() === fromCcy && !t.endDate
      ? { ...t, fxRateToEur: targetPair.latestRate, updatedAt: now }
      : t
  );

  const payload = normalizeAndComputeWorkspace(
    rawTrades,
    currentSecurities,
    nextForex
  );
  return { pair: targetPair, payload };
}

export function clientUpdateForexPairById(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  id: number,
  updates: Partial<NewForexPairInput> & {
    previousClose?: number | null;
    lastUpdated?: string | null;
    syncStatus?: ForexPairRecord["syncStatus"];
    syncError?: string | null;
  }
): { pair: ForexPairRecord | null; payload: ComputedWorkspacePayload } {
  const now = new Date().toISOString();
  const nextForex = [...currentForexPairs];
  const idx = nextForex.findIndex((f) => f.id === id);
  if (idx === -1) {
    return {
      pair: null,
      payload: normalizeAndComputeWorkspace(
        stripComputedTradeFields(currentTrades),
        currentSecurities,
        nextForex
      ),
    };
  }

  const existing = nextForex[idx];
  const nextFrom = (updates.fromCurrency ?? existing.fromCurrency)
    .trim()
    .toUpperCase();
  const nextYahoo = (updates.yahooSymbol ?? existing.yahooSymbol)
    .trim()
    .toUpperCase();
  const nextRate =
    updates.latestRate !== undefined ? updates.latestRate : existing.latestRate;

  const updatedPair: ForexPairRecord = {
    ...existing,
    fromCurrency: nextFrom,
    pairLabel: `${nextFrom} / ${existing.toCurrency}`,
    liveProvider: updates.liveProvider ?? existing.liveProvider,
    yahooSymbol: nextYahoo,
    historicalProvider:
      updates.historicalProvider ?? existing.historicalProvider,
    latestRate: nextRate,
    previousClose:
      updates.previousClose !== undefined
        ? updates.previousClose
        : existing.previousClose,
    lastUpdated:
      updates.lastUpdated !== undefined
        ? updates.lastUpdated
        : existing.lastUpdated,
    syncStatus:
      updates.syncStatus !== undefined
        ? updates.syncStatus
        : existing.syncStatus,
    syncError:
      updates.syncError !== undefined ? updates.syncError : existing.syncError,
    updatedAt: now,
  };
  nextForex[idx] = updatedPair;

  const rawTrades = stripComputedTradeFields(currentTrades).map((t) =>
    t.currency.toUpperCase() === nextFrom && !t.endDate
      ? { ...t, fxRateToEur: nextRate, updatedAt: now }
      : t
  );

  const payload = normalizeAndComputeWorkspace(
    rawTrades,
    currentSecurities,
    nextForex
  );
  return { pair: updatedPair, payload };
}

export function clientDeleteForexPairById(
  currentTrades: TradeRecord[],
  currentSecurities: SecurityRecord[],
  currentForexPairs: ForexPairRecord[],
  id: number
): ComputedWorkspacePayload {
  const nextForex = currentForexPairs.filter((f) => f.id !== id);
  return normalizeAndComputeWorkspace(
    stripComputedTradeFields(currentTrades),
    currentSecurities,
    nextForex
  );
}
