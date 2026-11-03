export type SupportedCurrency = "USD" | "EUR" | "CAD" | "SEK" | "DKK" | "GBP";

const GOOGLE_TO_YAHOO_PREFIX: Record<string, { suffix: string; defaultCurrency: SupportedCurrency; exchangeLabel: string }> = {
  AMS: { suffix: ".AS", defaultCurrency: "EUR", exchangeLabel: "Euronext Amsterdam" },
  EPA: { suffix: ".PA", defaultCurrency: "EUR", exchangeLabel: "Euronext Paris" },
  EBR: { suffix: ".BR", defaultCurrency: "EUR", exchangeLabel: "Euronext Brussels" },
  ETR: { suffix: ".DE", defaultCurrency: "EUR", exchangeLabel: "XETRA" },
  FRA: { suffix: ".F", defaultCurrency: "EUR", exchangeLabel: "Frankfurt" },
  BIT: { suffix: ".MI", defaultCurrency: "EUR", exchangeLabel: "Borsa Italiana" },
  BME: { suffix: ".MC", defaultCurrency: "EUR", exchangeLabel: "Madrid" },
  HEL: { suffix: ".HE", defaultCurrency: "EUR", exchangeLabel: "Nasdaq Helsinki" },
  TSE: { suffix: ".TO", defaultCurrency: "CAD", exchangeLabel: "Toronto (TSX)" },
  CVE: { suffix: ".V", defaultCurrency: "CAD", exchangeLabel: "TSX Venture" },
  STO: { suffix: ".ST", defaultCurrency: "SEK", exchangeLabel: "Nasdaq Stockholm" },
  CPH: { suffix: ".CO", defaultCurrency: "DKK", exchangeLabel: "Nasdaq Copenhagen" },
  LON: { suffix: ".L", defaultCurrency: "GBP", exchangeLabel: "London (LSE)" },
  NYSE: { suffix: "", defaultCurrency: "USD", exchangeLabel: "NYSE" },
  NASDAQ: { suffix: "", defaultCurrency: "USD", exchangeLabel: "NASDAQ" },
};

// Known European tickers that may appear without an exchange prefix in spreadsheets
const KNOWN_TICKER_OVERRIDES: Record<string, { yahooTicker: string; exchange: string }> = {
  VWS: { yahooTicker: "VWS.CO", exchange: "CPH" },
  NOVO: { yahooTicker: "NOVO-B.CO", exchange: "CPH" },
};

export interface ParsedTickerInfo {
  rawTicker: string;
  symbol: string;
  exchangePrefix: string | null;
  yahooTicker: string;
  inferredCurrency: SupportedCurrency;
}

/**
 * Converts a Google Finance ticker (e.g., 'AMS:ASML', 'TSE:CNQ', 'STO:INVE-B', 'VWS')
 * into a Yahoo Finance compatible symbol ('ASML.AS', 'CNQ.TO', 'INVE-B.ST', 'VWS.CO').
 */
export function mapToYahooTicker(rawInput: string, explicitCurrency?: string): ParsedTickerInfo {
  const cleaned = rawInput.trim().toUpperCase();

  if (cleaned.includes(":")) {
    const [prefix, symbol] = cleaned.split(":", 2);
    const mapping = GOOGLE_TO_YAHOO_PREFIX[prefix];
    if (mapping) {
      return {
        rawTicker: cleaned,
        symbol,
        exchangePrefix: prefix,
        yahooTicker: `${symbol}${mapping.suffix}`,
        inferredCurrency: (explicitCurrency?.toUpperCase() as SupportedCurrency) || mapping.defaultCurrency,
      };
    }
    return {
      rawTicker: cleaned,
      symbol,
      exchangePrefix: prefix,
      yahooTicker: symbol,
      inferredCurrency: (explicitCurrency?.toUpperCase() as SupportedCurrency) || "USD",
    };
  }

  // Handle known overrides (like VWS -> VWS.CO when DKK)
  if (KNOWN_TICKER_OVERRIDES[cleaned]) {
    const override = KNOWN_TICKER_OVERRIDES[cleaned];
    return {
      rawTicker: cleaned,
      symbol: cleaned,
      exchangePrefix: override.exchange,
      yahooTicker: override.yahooTicker,
      inferredCurrency: (explicitCurrency?.toUpperCase() as SupportedCurrency) || "DKK",
    };
  }

  // If currency is DKK and no suffix is present, default to Copenhagen (.CO)
  if (explicitCurrency?.toUpperCase() === "DKK" && !cleaned.includes(".")) {
    return {
      rawTicker: cleaned,
      symbol: cleaned,
      exchangePrefix: "CPH",
      yahooTicker: `${cleaned}.CO`,
      inferredCurrency: "DKK",
    };
  }

  // If currency is SEK and no suffix is present, default to Stockholm (.ST)
  if (explicitCurrency?.toUpperCase() === "SEK" && !cleaned.includes(".")) {
    return {
      rawTicker: cleaned,
      symbol: cleaned,
      exchangePrefix: "STO",
      yahooTicker: `${cleaned}.ST`,
      inferredCurrency: "SEK",
    };
  }

  return {
    rawTicker: cleaned,
    symbol: cleaned,
    exchangePrefix: null,
    yahooTicker: cleaned,
    inferredCurrency: (explicitCurrency?.toUpperCase() as SupportedCurrency) || "USD",
  };
}

