import type {
  TradeRecord,
  SecurityRecord,
  ForexPairRecord,
  QuoteProviderType,
  FxProviderType,
} from "./db/schema";
import { mapToYahooTicker } from "./ticker-mapper";

export interface PortfolioFileState {
  version: string;
  exportedAt: string;
  fileName: string;
  cashBalance: number;
  riskPercent: number;
  trades: TradeRecord[];
  securities: SecurityRecord[];
  forexPairs: ForexPairRecord[];
}

function escapeXml(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseOptionalNumber(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isNaN(num) ? null : num;
}

function parseRequiredNumber(
  val: string | null | undefined,
  fallback: number
): number {
  const parsed = parseOptionalNumber(val);
  return parsed !== null ? parsed : fallback;
}

function parseBoolean(val: string | null | undefined): boolean {
  if (!val) return false;
  const normalized = val.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "done" ||
    normalized === "trimmed"
  );
}

/**
 * Serializes the complete Cheetah Tracker portfolio state into a human-readable XML document.
 */
export function serializePortfolioToXml(
  state: {
    cashBalance: number;
    riskPercent?: number;
    trades: TradeRecord[];
    securities: SecurityRecord[];
    forexPairs: ForexPairRecord[];
  },
  appVersion = "1.0.0"
): string {
  const exportedAt = new Date().toISOString();
  const riskPercent = state.riskPercent ?? 1.0;

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<CheetahPortfolio version="1.0" appVersion="${escapeXml(
      appVersion
    )}" exportedAt="${escapeXml(exportedAt)}">`
  );

  // 1. Account Settings
  lines.push(`  <Account>`);
  lines.push(`    <BaseCurrency>EUR</BaseCurrency>`);
  lines.push(`    <CashBalance>${escapeXml(state.cashBalance)}</CashBalance>`);
  lines.push(`    <RiskPercent>${escapeXml(riskPercent)}</RiskPercent>`);
  lines.push(`  </Account>`);

  // 2. Forex Pairs
  lines.push(`  <ForexPairs>`);
  for (const fx of state.forexPairs) {
    lines.push(
      `    <ForexPair` +
        ` id="${escapeXml(fx.id)}"` +
        ` fromCurrency="${escapeXml(fx.fromCurrency)}"` +
        ` toCurrency="${escapeXml(fx.toCurrency)}"` +
        ` pairLabel="${escapeXml(fx.pairLabel)}"` +
        ` liveProvider="${escapeXml(fx.liveProvider)}"` +
        ` yahooSymbol="${escapeXml(fx.yahooSymbol)}"` +
        ` historicalProvider="${escapeXml(fx.historicalProvider)}"` +
        ` latestRate="${escapeXml(fx.latestRate)}"` +
        ` previousClose="${escapeXml(fx.previousClose ?? "")}"` +
        ` lastUpdated="${escapeXml(fx.lastUpdated ?? "")}"` +
        ` syncStatus="${escapeXml(fx.syncStatus)}"` +
        ` syncError="${escapeXml(fx.syncError ?? "")}"` +
        ` createdAt="${escapeXml(fx.createdAt)}"` +
        ` updatedAt="${escapeXml(fx.updatedAt)}"` +
        ` />`
    );
  }
  lines.push(`  </ForexPairs>`);

  // 3. Securities Master
  lines.push(`  <Securities>`);
  for (const sec of state.securities) {
    const hasNotes = Boolean(sec.notes && sec.notes.trim().length > 0);
    const attrs =
      ` id="${escapeXml(sec.id)}"` +
      ` ticker="${escapeXml(sec.ticker)}"` +
      ` name="${escapeXml(sec.name)}"` +
      ` isin="${escapeXml(sec.isin ?? "")}"` +
      ` gicsSector="${escapeXml(sec.gicsSector)}"` +
      ` currency="${escapeXml(sec.currency)}"` +
      ` quoteProvider="${escapeXml(sec.quoteProvider)}"` +
      ` latestPrice="${escapeXml(sec.latestPrice ?? "")}"` +
      ` previousClose="${escapeXml(sec.previousClose ?? "")}"` +
      ` lastQuoteAt="${escapeXml(sec.lastQuoteAt ?? "")}"` +
      ` quoteStatus="${escapeXml(sec.quoteStatus)}"` +
      ` quoteError="${escapeXml(sec.quoteError ?? "")}"` +
      ` tradingViewUrl="${escapeXml(sec.tradingViewUrl ?? "")}"` +
      ` createdAt="${escapeXml(sec.createdAt)}"` +
      ` updatedAt="${escapeXml(sec.updatedAt)}"`;

    if (hasNotes) {
      lines.push(`    <Security${attrs}>`);
      lines.push(`      <Notes>${escapeXml(sec.notes)}</Notes>`);
      lines.push(`    </Security>`);
    } else {
      lines.push(`    <Security${attrs} />`);
    }
  }
  lines.push(`  </Securities>`);

  // 4. Trades Ledger
  lines.push(`  <Trades>`);
  for (const t of state.trades) {
    const hasNotes = Boolean(t.notes && t.notes.trim().length > 0);
    const attrs =
      ` id="${escapeXml(t.id)}"` +
      ` securityId="${escapeXml(t.securityId ?? "")}"` +
      ` ticker="${escapeXml(t.ticker)}"` +
      ` gicsSector="${escapeXml(t.gicsSector)}"` +
      ` startDate="${escapeXml(t.startDate)}"` +
      ` endDate="${escapeXml(t.endDate ?? "")}"` +
      ` shares="${escapeXml(t.shares)}"` +
      ` buyPrice="${escapeXml(t.buyPrice)}"` +
      ` sellPrice="${escapeXml(t.sellPrice ?? "")}"` +
      ` currency="${escapeXml(t.currency)}"` +
      ` initialStopLoss="${escapeXml(t.initialStopLoss)}"` +
      ` stopMoved="${escapeXml(t.stopMoved)}"` +
      ` trimmedAt2R="${escapeXml(t.trimmedAt2R)}"` +
      ` manualLatestPrice="${escapeXml(t.manualLatestPrice ?? "")}"` +
      ` entryFxRateToEur="${escapeXml(t.entryFxRateToEur)}"` +
      ` fxRateToEur="${escapeXml(t.fxRateToEur)}"` +
      ` createdAt="${escapeXml(t.createdAt)}"` +
      ` updatedAt="${escapeXml(t.updatedAt)}"`;

    if (hasNotes) {
      lines.push(`    <Trade${attrs}>`);
      lines.push(`      <Notes>${escapeXml(t.notes)}</Notes>`);
      lines.push(`    </Trade>`);
    } else {
      lines.push(`    <Trade${attrs} />`);
    }
  }
  lines.push(`  </Trades>`);

  lines.push(`</CheetahPortfolio>`);
  return lines.join("\n") + "\n";
}

/**
 * Helper to read either an attribute or a child tag from a DOM Element.
 */
function getAttrOrChild(el: Element, name: string): string | null {
  const attr = el.getAttribute(name);
  if (attr !== null) return attr;
  // Also check case-insensitive or PascalCase child tag
  const pascal = name.charAt(0).toUpperCase() + name.slice(1);
  const child =
    el.querySelector(`:scope > ${name}`) ||
    el.querySelector(`:scope > ${pascal}`);
  return child ? child.textContent : null;
}

/**
 * Parses a CheetahPortfolio XML string into a normalized PortfolioFileState.
 * Works in browser via DOMParser (with fallback regex parsing for non-DOM environments).
 */
export function parsePortfolioXml(
  xmlText: string,
  fileName = "cheetah-portfolio.xml"
): PortfolioFileState {
  const trimmed = xmlText.trim();
  if (!trimmed) {
    throw new Error("The XML file is empty.");
  }

  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(
        `Invalid XML file format: ${
          parserError.textContent?.slice(0, 140) || "Parse error"
        }`
      );
    }

    const root = doc.documentElement;
    if (
      !root ||
      (root.tagName !== "CheetahPortfolio" &&
        root.tagName.toLowerCase() !== "cheetahportfolio" &&
        root.tagName.toLowerCase() !== "portfolio")
    ) {
      throw new Error(
        `Unrecognized root XML element <${
          root?.tagName || "unknown"
        }>. Expected <CheetahPortfolio>.`
      );
    }

    const now = new Date().toISOString();
    const version = root.getAttribute("version") || "1.0";
    const exportedAt = root.getAttribute("exportedAt") || now;

    // 1. Account
    const accountEl = root.querySelector("Account, account");
    const cashBalance = parseRequiredNumber(
      accountEl
        ? getAttrOrChild(accountEl, "cashBalance") ??
            getAttrOrChild(accountEl, "CashBalance")
        : null,
      25000
    );
    const riskPercent = parseRequiredNumber(
      accountEl
        ? getAttrOrChild(accountEl, "riskPercent") ??
            getAttrOrChild(accountEl, "RiskPercent")
        : null,
      1.0
    );

    // 2. ForexPairs
    const forexEls = Array.from(
      root.querySelectorAll("ForexPairs > ForexPair, forexPairs > forexPair")
    );
    const forexPairs: ForexPairRecord[] = forexEls.map((el, idx) => {
      const fromCurrency = (
        getAttrOrChild(el, "fromCurrency") || "USD"
      ).toUpperCase();
      const toCurrency = (
        getAttrOrChild(el, "toCurrency") || "EUR"
      ).toUpperCase();
      return {
        id: parseRequiredNumber(getAttrOrChild(el, "id"), idx + 1),
        fromCurrency,
        toCurrency,
        pairLabel:
          getAttrOrChild(el, "pairLabel") || `${fromCurrency} / ${toCurrency}`,
        liveProvider: ((getAttrOrChild(el, "liveProvider") ||
          "YAHOO") as FxProviderType),
        yahooSymbol:
          getAttrOrChild(el, "yahooSymbol") || `${fromCurrency}${toCurrency}=X`,
        historicalProvider: ((getAttrOrChild(el, "historicalProvider") ||
          "FRANKFURTER") as FxProviderType),
        latestRate: parseRequiredNumber(getAttrOrChild(el, "latestRate"), 1.0),
        previousClose: parseOptionalNumber(getAttrOrChild(el, "previousClose")),
        lastUpdated: getAttrOrChild(el, "lastUpdated") || null,
        syncStatus: ((getAttrOrChild(el, "syncStatus") ||
          "OK") as ForexPairRecord["syncStatus"]),
        syncError: getAttrOrChild(el, "syncError") || null,
        createdAt: getAttrOrChild(el, "createdAt") || now,
        updatedAt: getAttrOrChild(el, "updatedAt") || now,
      };
    });

    // 3. Securities
    const secEls = Array.from(
      root.querySelectorAll("Securities > Security, securities > security")
    );
    const securities: SecurityRecord[] = secEls.map((el, idx) => {
      const rawTicker = getAttrOrChild(el, "ticker") || `SEC${idx + 1}`;
      const rawCurrency = (
        getAttrOrChild(el, "currency") || "USD"
      ).toUpperCase();
      const mapped = mapToYahooTicker(rawTicker, rawCurrency);
      const ticker = (mapped.yahooTicker || mapped.rawTicker).toUpperCase();
      const notesChild = el.querySelector("Notes, notes");
      const notesVal =
        notesChild?.textContent ?? getAttrOrChild(el, "notes") ?? null;

      return {
        id: parseRequiredNumber(getAttrOrChild(el, "id"), idx + 1),
        ticker,
        name: getAttrOrChild(el, "name") || ticker,
        isin: getAttrOrChild(el, "isin") || null,
        gicsSector: getAttrOrChild(el, "gicsSector") || "Uncategorized",
        currency: rawCurrency || mapped.inferredCurrency,
        quoteProvider: ((getAttrOrChild(el, "quoteProvider") ||
          "YAHOO") as QuoteProviderType),
        latestPrice: parseOptionalNumber(getAttrOrChild(el, "latestPrice")),
        previousClose: parseOptionalNumber(getAttrOrChild(el, "previousClose")),
        lastQuoteAt: getAttrOrChild(el, "lastQuoteAt") || null,
        quoteStatus: ((getAttrOrChild(el, "quoteStatus") ||
          "OK") as SecurityRecord["quoteStatus"]),
        quoteError: getAttrOrChild(el, "quoteError") || null,
        tradingViewUrl: getAttrOrChild(el, "tradingViewUrl") || null,
        notes: notesVal ? notesVal : null,
        createdAt: getAttrOrChild(el, "createdAt") || now,
        updatedAt: getAttrOrChild(el, "updatedAt") || now,
      };
    });

    // 4. Trades
    const tradeEls = Array.from(
      root.querySelectorAll("Trades > Trade, trades > trade")
    );
    const trades: TradeRecord[] = [];
    tradeEls.forEach((el, idx) => {
      const rawTicker = getAttrOrChild(el, "ticker");
      if (!rawTicker) return;
      const rawCurrency = (
        getAttrOrChild(el, "currency") || "USD"
      ).toUpperCase();
      const mapped = mapToYahooTicker(rawTicker, rawCurrency);
      const ticker = (mapped.yahooTicker || mapped.rawTicker).toUpperCase();
      const currency = rawCurrency || mapped.inferredCurrency;
      const fxRate =
        currency === "EUR"
          ? 1.0
          : parseRequiredNumber(getAttrOrChild(el, "fxRateToEur"), 1.0);
      const entryFxRate =
        currency === "EUR"
          ? 1.0
          : parseRequiredNumber(
              getAttrOrChild(el, "entryFxRateToEur"),
              fxRate
            );
      const notesChild = el.querySelector("Notes, notes");
      const notesVal =
        notesChild?.textContent ?? getAttrOrChild(el, "notes") ?? null;

      trades.push({
        id: parseRequiredNumber(getAttrOrChild(el, "id"), idx + 1),
        securityId: parseOptionalNumber(getAttrOrChild(el, "securityId")),
        ticker,
        gicsSector: getAttrOrChild(el, "gicsSector") || "Uncategorized",
        startDate:
          getAttrOrChild(el, "startDate") ||
          new Date().toISOString().slice(0, 10),
        endDate: getAttrOrChild(el, "endDate") || null,
        shares: parseRequiredNumber(getAttrOrChild(el, "shares"), 0),
        buyPrice: parseRequiredNumber(getAttrOrChild(el, "buyPrice"), 0),
        sellPrice: parseOptionalNumber(getAttrOrChild(el, "sellPrice")),
        currency,
        initialStopLoss: parseRequiredNumber(
          getAttrOrChild(el, "initialStopLoss"),
          0
        ),
        stopMoved: parseBoolean(getAttrOrChild(el, "stopMoved")),
        trimmedAt2R: parseBoolean(getAttrOrChild(el, "trimmedAt2R")),
        manualLatestPrice: parseOptionalNumber(
          getAttrOrChild(el, "manualLatestPrice")
        ),
        entryFxRateToEur: entryFxRate,
        fxRateToEur: fxRate,
        notes: notesVal ? notesVal : null,
        createdAt: getAttrOrChild(el, "createdAt") || now,
        updatedAt: getAttrOrChild(el, "updatedAt") || now,
      });
    });

    return {
      version,
      exportedAt,
      fileName,
      cashBalance,
      riskPercent,
      trades,
      securities,
      forexPairs,
    };
  }

  // Fallback parser for non-DOM environments
  const cashMatch = trimmed.match(/<CashBalance>([^<]*)<\/CashBalance>/i);
  const riskMatch = trimmed.match(/<RiskPercent>([^<]*)<\/RiskPercent>/i);
  return {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    fileName,
    cashBalance: cashMatch ? Number(unescapeXml(cashMatch[1])) || 25000 : 25000,
    riskPercent: riskMatch ? Number(unescapeXml(riskMatch[1])) || 1.0 : 1.0,
    trades: [],
    securities: [],
    forexPairs: [],
  };
}

