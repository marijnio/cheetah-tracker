export type QuoteProviderType = "YAHOO" | "MANUAL";
export type FxProviderType = "YAHOO" | "FRANKFURTER" | "MANUAL";

export interface SecurityRecord {
  id: number;
  ticker: string; // Display ticker, e.g., 'NVDA', 'AMS:ASML', 'STO:INVE-B'
  name: string; // Company / Security name, e.g., 'NVIDIA Corporation'
  isin: string | null;
  gicsSector: string;
  currency: string; // 'USD', 'EUR', 'CAD', 'SEK', 'DKK', 'GBP'

  // Quote Provider Configuration
  quoteProvider: QuoteProviderType;
  providerSymbol: string; // Yahoo Finance symbol, e.g., 'NVDA', 'ASML.AS', 'INVE-B.ST', 'VWS.CO'
  latestPrice: number | null;
  previousClose: number | null;
  lastQuoteAt: string | null;
  quoteStatus: "OK" | "PENDING" | "ERROR" | "MANUAL";
  quoteError: string | null;

  notes: string | null;
  createdAt: string;
  updatedAt: string;

  // Aggregated counts populated on read
  tradeCount?: number;
  openTradeCount?: number;
}

export interface NewSecurityInput {
  ticker: string;
  name?: string;
  isin?: string | null;
  gicsSector?: string;
  currency?: string;
  quoteProvider?: QuoteProviderType;
  providerSymbol?: string;
  latestPrice?: number | null;
  notes?: string | null;
}

export interface ForexPairRecord {
  id: number;
  fromCurrency: string; // e.g. 'USD', 'CAD', 'SEK', 'DKK', 'GBP'
  toCurrency: string; // 'EUR'
  pairLabel: string; // e.g. 'USD / EUR'

  // Quote Provider Configuration
  liveProvider: FxProviderType;
  yahooSymbol: string; // e.g. 'USDEUR=X', 'CADEUR=X', 'SEKEUR=X', 'DKKEUR=X'
  historicalProvider: FxProviderType; // 'FRANKFURTER' | 'YAHOO' | 'MANUAL'

  latestRate: number; // 1 unit of fromCurrency in EUR (e.g., 0.89338)
  previousClose: number | null;
  lastUpdated: string | null;
  syncStatus: "OK" | "PENDING" | "ERROR" | "MANUAL";
  syncError: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface NewForexPairInput {
  fromCurrency: string;
  toCurrency?: string;
  liveProvider?: FxProviderType;
  yahooSymbol?: string;
  historicalProvider?: FxProviderType;
  latestRate: number;
}

export interface TradeRecord {
  id: number;
  securityId: number | null;
  ticker: string;
  securityName?: string;
  yahooTicker: string;
  gicsSector: string;

  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD or null if Open

  shares: number;
  buyPrice: number;
  sellPrice: number | null; // null if Open
  currency: string;

  initialStopLoss: number;
  stopMoved: boolean;
  trimmedAt2R: boolean;

  manualLatestPrice: number | null;
  fxRateToEur: number; // Locked at End Date for closed trades; live/cached for open trades

  notes: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface NewTradeInput {
  securityId?: number | null;
  ticker: string;
  yahooTicker?: string;
  gicsSector?: string;
  startDate: string;
  endDate?: string | null;
  shares: number;
  buyPrice: number;
  sellPrice?: number | null;
  currency?: string;
  initialStopLoss: number;
  stopMoved?: boolean;
  trimmedAt2R?: boolean;
  manualLatestPrice?: number | null;
  fxRateToEur?: number;
  notes?: string | null;
}

export const SCHEMA_DDL = `
  CREATE TABLE IF NOT EXISTS securities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    isin TEXT,
    gics_sector TEXT NOT NULL DEFAULT 'Uncategorized',
    currency TEXT NOT NULL DEFAULT 'USD',
    quote_provider TEXT NOT NULL DEFAULT 'YAHOO',
    provider_symbol TEXT NOT NULL,
    latest_price REAL,
    previous_close REAL,
    last_quote_at TEXT,
    quote_status TEXT NOT NULL DEFAULT 'PENDING',
    quote_error TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_securities_ticker ON securities(ticker);
  CREATE INDEX IF NOT EXISTS idx_securities_provider_symbol ON securities(provider_symbol);

  CREATE TABLE IF NOT EXISTS forex_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_currency TEXT NOT NULL UNIQUE,
    to_currency TEXT NOT NULL DEFAULT 'EUR',
    pair_label TEXT NOT NULL,
    live_provider TEXT NOT NULL DEFAULT 'YAHOO',
    yahoo_symbol TEXT NOT NULL,
    historical_provider TEXT NOT NULL DEFAULT 'FRANKFURTER',
    latest_rate REAL NOT NULL DEFAULT 1.0,
    previous_close REAL,
    last_updated TEXT,
    sync_status TEXT NOT NULL DEFAULT 'PENDING',
    sync_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    security_id INTEGER REFERENCES securities(id) ON DELETE SET NULL,
    ticker TEXT NOT NULL,
    yahoo_ticker TEXT NOT NULL,
    gics_sector TEXT NOT NULL DEFAULT 'Uncategorized',
    start_date TEXT NOT NULL,
    end_date TEXT,
    shares REAL NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    initial_stop_loss REAL NOT NULL,
    stop_moved INTEGER NOT NULL DEFAULT 0,
    trimmed_at_2r INTEGER NOT NULL DEFAULT 0,
    manual_latest_price REAL,
    fx_rate_to_eur REAL NOT NULL DEFAULT 1.0,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trades_start_date ON trades(start_date);
  CREATE INDEX IF NOT EXISTS idx_trades_end_date ON trades(end_date);
  CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);

  CREATE TABLE IF NOT EXISTS quote_cache (
    yahoo_ticker TEXT PRIMARY KEY,
    raw_ticker TEXT NOT NULL,
    latest_price REAL NOT NULL,
    currency TEXT,
    gics_sector TEXT,
    last_updated TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fx_cache (
    cache_key TEXT PRIMARY KEY,
    from_currency TEXT NOT NULL,
    rate_to_eur REAL NOT NULL,
    rate_date TEXT NOT NULL,
    last_updated TEXT NOT NULL
  );
`;
