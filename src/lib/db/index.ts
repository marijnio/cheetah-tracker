import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_DDL,
  type TradeRecord,
  type NewTradeInput,
  type SecurityRecord,
  type NewSecurityInput,
  type ForexPairRecord,
  type NewForexPairInput,
  type QuoteProviderType,
  type FxProviderType,
} from "./schema";
import { mapToYahooTicker } from "../ticker-mapper";
import { parseTradesCsv } from "../csv-parser";

const KNOWN_COMPANY_NAMES: Record<string, string> = {
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

const DEFAULT_FOREX_PAIRS: Array<{
  fromCurrency: string;
  yahooSymbol: string;
  latestRate: number;
}> = [
    { fromCurrency: "USD", yahooSymbol: "USDEUR=X", latestRate: 0.89338 },
    { fromCurrency: "CAD", yahooSymbol: "CADEUR=X", latestRate: 0.621215 },
    { fromCurrency: "SEK", yahooSymbol: "SEKEUR=X", latestRate: 0.09125 },
    { fromCurrency: "DKK", yahooSymbol: "DKKEUR=X", latestRate: 0.133774 },
    { fromCurrency: "GBP", yahooSymbol: "GBPEUR=X", latestRate: 1.185 },
  ];

const globalForDb = globalThis as unknown as {
  sqliteDb: DatabaseSync | undefined;
  initializedVersion: number | undefined;
};

const CURRENT_DB_INIT_VERSION = 3;

function getDatabasePath(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "cheetah-tracker.db");
}

export function getDb(): DatabaseSync {
  if (!globalForDb.sqliteDb) {
    const dbPath = getDatabasePath();
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    globalForDb.sqliteDb = db;
  }

  if (globalForDb.initializedVersion !== CURRENT_DB_INIT_VERSION) {
    ensureSchemaAndSeed(globalForDb.sqliteDb);
    globalForDb.initializedVersion = CURRENT_DB_INIT_VERSION;
  }

  return globalForDb.sqliteDb;
}

function ensureSchemaAndSeed(db: DatabaseSync): void {
  db.exec(SCHEMA_DDL);

  // Safe migration: ensure security_id column exists on trades if created in Phase 1
  const tradeCols = db
    .prepare("PRAGMA table_info(trades)")
    .all() as unknown as Array<{ name: string }>;
  const hasSecurityId = tradeCols.some((c) => c.name === "security_id");
  if (!hasSecurityId) {
    db.exec(
      "ALTER TABLE trades ADD COLUMN security_id INTEGER REFERENCES securities(id) ON DELETE SET NULL;"
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_trades_security_id ON trades(security_id);"
  );

  // Version 3 Migration: Migrate to single unified ticker
  const secCols = db
    .prepare("PRAGMA table_info(securities)")
    .all() as unknown as Array<{ name: string }>;
  const hasProviderSymbol = secCols.some((c) => c.name === "provider_symbol");

  if (hasProviderSymbol) {
    // 1. Update securities.ticker to provider_symbol where different
    db.exec(`
      UPDATE securities
      SET ticker = provider_symbol
      WHERE provider_symbol IS NOT NULL AND provider_symbol != '' AND ticker != provider_symbol;
    `);

    // 2. Update trades.ticker to match linked security ticker
    db.exec(`
      UPDATE trades
      SET ticker = (
        SELECT s.ticker FROM securities s WHERE s.id = trades.security_id
      )
      WHERE security_id IS NOT NULL;
    `);
  }

  // 1. Seed default Forex Pairs if missing
  const now = new Date().toISOString();
  const insertFxStmt = db.prepare(`
    INSERT OR IGNORE INTO forex_pairs (
      from_currency, to_currency, pair_label, live_provider,
      yahoo_symbol, historical_provider, latest_rate, previous_close,
      last_updated, sync_status, sync_error, created_at, updated_at
    ) VALUES (?, 'EUR', ?, 'YAHOO', ?, 'FRANKFURTER', ?, NULL, ?, 'OK', NULL, ?, ?)
  `);

  for (const fx of DEFAULT_FOREX_PAIRS) {
    insertFxStmt.run(
      fx.fromCurrency,
      `${fx.fromCurrency} / EUR`,
      fx.yahooSymbol,
      fx.latestRate,
      now,
      now,
      now
    );
  }

  // 2. Auto-seed sample CSV trades if trades table is empty
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM trades").get() as {
    cnt: number;
  };
  if (!countRow || countRow.cnt === 0) {
    const sampleCsvPath = path.join(
      process.cwd(),
      "sample-data",
      "sample-trades.csv"
    );
    if (fs.existsSync(sampleCsvPath)) {
      try {
        const csvContent = fs.readFileSync(sampleCsvPath, "utf-8");
        const parsedTrades = parseTradesCsv(csvContent);
        if (parsedTrades.length > 0) {
          bulkInsertTrades(parsedTrades, db);
        }
      } catch (err) {
        console.error("Failed to auto-seed sample CSV:", err);
      }
    }
  }

  // 3. Backfill / sync Securities from existing trades and link trades.security_id
  syncSecuritiesFromTrades(db);
}

/**
 * Ensures every distinct ticker in `trades` exists in `securities` and links `trades.security_id`.
 */
export function syncSecuritiesFromTrades(customDb?: DatabaseSync): void {
  const db = customDb || getDb();
  const now = new Date().toISOString();

  const distinctRows = db
    .prepare(
      `SELECT ticker, gics_sector, currency,
              MAX(COALESCE(manual_latest_price, sell_price, buy_price)) as last_known_price
       FROM trades
       GROUP BY ticker`
    )
    .all() as unknown as Array<{
      ticker: string;
      gics_sector: string;
      currency: string;
      last_known_price: number | null;
    }>;

  const secCols = db
    .prepare("PRAGMA table_info(securities)")
    .all() as unknown as Array<{ name: string }>;
  const hasProviderSymbol = secCols.some((c) => c.name === "provider_symbol");

  const insertSec = hasProviderSymbol
    ? db.prepare(`
        INSERT OR IGNORE INTO securities (
          ticker, name, isin, gics_sector, currency,
          quote_provider, provider_symbol, latest_price, previous_close,
          last_quote_at, quote_status, quote_error, notes, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, 'YAHOO', ?, ?, NULL, ?, 'OK', NULL, NULL, ?, ?)
      `)
    : db.prepare(`
        INSERT OR IGNORE INTO securities (
          ticker, name, isin, gics_sector, currency,
          quote_provider, latest_price, previous_close,
          last_quote_at, quote_status, quote_error, notes, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, 'YAHOO', ?, NULL, ?, 'OK', NULL, NULL, ?, ?)
      `);

  for (const r of distinctRows) {
    const companyName = KNOWN_COMPANY_NAMES[r.ticker] || r.ticker;
    if (hasProviderSymbol) {
      insertSec.run(
        r.ticker,
        companyName,
        r.gics_sector || "Uncategorized",
        r.currency || "USD",
        r.ticker,
        r.last_known_price,
        now,
        now,
        now
      );
    } else {
      insertSec.run(
        r.ticker,
        companyName,
        r.gics_sector || "Uncategorized",
        r.currency || "USD",
        r.last_known_price,
        now,
        now,
        now
      );
    }
  }

  // Link any unlinked trades to their security_id
  db.exec(`
    UPDATE trades
    SET security_id = (
      SELECT s.id FROM securities s WHERE s.ticker = trades.ticker
    )
    WHERE security_id IS NULL;
  `);
}

// ============================================================================
// SECURITIES REPOSITORY
// ============================================================================

interface RawSecurityRow {
  id: number;
  ticker: string;
  name: string;
  isin: string | null;
  gics_sector: string;
  currency: string;
  quote_provider: string;
  provider_symbol?: string | null;
  latest_price: number | null;
  previous_close: number | null;
  last_quote_at: string | null;
  quote_status: string;
  quote_error: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  trade_count?: number;
  open_trade_count?: number;
}

function mapRowToSecurity(row: RawSecurityRow): SecurityRecord {
  return {
    id: row.id,
    ticker: row.ticker,
    name: row.name || row.ticker,
    isin: row.isin,
    gicsSector: row.gics_sector,
    currency: row.currency,
    quoteProvider: (row.quote_provider as QuoteProviderType) || "YAHOO",
    latestPrice: row.latest_price,
    previousClose: row.previous_close,
    lastQuoteAt: row.last_quote_at,
    quoteStatus:
      (row.quote_status as SecurityRecord["quoteStatus"]) || "PENDING",
    quoteError: row.quote_error,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tradeCount: Number(row.trade_count ?? 0),
    openTradeCount: Number(row.open_trade_count ?? 0),
  };
}

export function getAllSecurities(): SecurityRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*,
              COUNT(t.id) as trade_count,
              SUM(CASE WHEN t.id IS NOT NULL AND t.end_date IS NULL THEN 1 ELSE 0 END) as open_trade_count
       FROM securities s
       LEFT JOIN trades t ON t.security_id = s.id
       GROUP BY s.id
       ORDER BY open_trade_count DESC, s.ticker ASC`
    )
    .all() as unknown as RawSecurityRow[];

  return rows.map(mapRowToSecurity);
}

export function getSecurityById(id: number): SecurityRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.*,
              COUNT(t.id) as trade_count,
              SUM(CASE WHEN t.id IS NOT NULL AND t.end_date IS NULL THEN 1 ELSE 0 END) as open_trade_count
       FROM securities s
       LEFT JOIN trades t ON t.security_id = s.id
       WHERE s.id = ?
       GROUP BY s.id`
    )
    .get(id) as unknown as RawSecurityRow | undefined;

  return row ? mapRowToSecurity(row) : null;
}

export function getSecurityByTicker(ticker: string): SecurityRecord | null {
  const db = getDb();
  const cleaned = ticker.trim().toUpperCase();
  const row = db
    .prepare("SELECT * FROM securities WHERE ticker = ?")
    .get(cleaned) as unknown as RawSecurityRow | undefined;
  return row ? mapRowToSecurity(row) : null;
}

export function upsertSecurity(
  input: NewSecurityInput,
  customDb?: DatabaseSync
): SecurityRecord {
  const db = customDb || getDb();
  const now = new Date().toISOString();
  const tickerInfo = mapToYahooTicker(input.ticker, input.currency);
  const ticker = (tickerInfo.yahooTicker || tickerInfo.rawTicker).toUpperCase();
  const currency = (input.currency || tickerInfo.inferredCurrency).toUpperCase();
  const name =
    input.name?.trim() ||
    KNOWN_COMPANY_NAMES[ticker] ||
    KNOWN_COMPANY_NAMES[tickerInfo.rawTicker] ||
    tickerInfo.symbol;
  const gicsSector = input.gicsSector || "Uncategorized";
  const quoteProvider = input.quoteProvider || "YAHOO";

  const secCols = db
    .prepare("PRAGMA table_info(securities)")
    .all() as unknown as Array<{ name: string }>;
  const hasProviderSymbol = secCols.some((c) => c.name === "provider_symbol");

  const existing = db
    .prepare("SELECT * FROM securities WHERE ticker = ?")
    .get(ticker) as unknown as RawSecurityRow | undefined;

  if (existing) {
    if (hasProviderSymbol) {
      db.prepare(
        `UPDATE securities SET
          name = ?,
          isin = ?,
          gics_sector = ?,
          currency = ?,
          quote_provider = ?,
          provider_symbol = ?,
          latest_price = COALESCE(?, latest_price),
          notes = COALESCE(?, notes),
          updated_at = ?
         WHERE id = ?`
      ).run(
        input.name !== undefined ? name : existing.name,
        input.isin !== undefined ? input.isin : existing.isin,
        input.gicsSector !== undefined ? gicsSector : existing.gics_sector,
        input.currency !== undefined ? currency : existing.currency,
        input.quoteProvider !== undefined
          ? quoteProvider
          : existing.quote_provider,
        ticker,
        input.latestPrice ?? null,
        input.notes ?? null,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `UPDATE securities SET
          name = ?,
          isin = ?,
          gics_sector = ?,
          currency = ?,
          quote_provider = ?,
          latest_price = COALESCE(?, latest_price),
          notes = COALESCE(?, notes),
          updated_at = ?
         WHERE id = ?`
      ).run(
        input.name !== undefined ? name : existing.name,
        input.isin !== undefined ? input.isin : existing.isin,
        input.gicsSector !== undefined ? gicsSector : existing.gics_sector,
        input.currency !== undefined ? currency : existing.currency,
        input.quoteProvider !== undefined
          ? quoteProvider
          : existing.quote_provider,
        input.latestPrice ?? null,
        input.notes ?? null,
        now,
        existing.id
      );
    }
    return getSecurityById(existing.id)!;
  }

  const res = hasProviderSymbol
    ? db
      .prepare(
        `INSERT INTO securities (
            ticker, name, isin, gics_sector, currency,
            quote_provider, provider_symbol, latest_price, previous_close,
            last_quote_at, quote_status, quote_error, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        ticker,
        name,
        input.isin ?? null,
        gicsSector,
        currency,
        quoteProvider,
        ticker,
        input.latestPrice ?? null,
        input.latestPrice ? now : null,
        quoteProvider === "MANUAL" ? "MANUAL" : "PENDING",
        input.notes ?? null,
        now,
        now
      )
    : db
      .prepare(
        `INSERT INTO securities (
            ticker, name, isin, gics_sector, currency,
            quote_provider, latest_price, previous_close,
            last_quote_at, quote_status, quote_error, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        ticker,
        name,
        input.isin ?? null,
        gicsSector,
        currency,
        quoteProvider,
        input.latestPrice ?? null,
        input.latestPrice ? now : null,
        quoteProvider === "MANUAL" ? "MANUAL" : "PENDING",
        input.notes ?? null,
        now,
        now
      );

  // Ensure currency exists in forex_pairs if non-EUR
  if (currency !== "EUR") {
    ensureForexPairExists(currency, db);
  }

  return getSecurityById(Number(res.lastInsertRowid))!;
}

export function updateSecurityById(
  id: number,
  updates: Partial<NewSecurityInput> & {
    previousClose?: number | null;
    lastQuoteAt?: string | null;
    quoteStatus?: SecurityRecord["quoteStatus"];
    quoteError?: string | null;
  }
): SecurityRecord | null {
  const existing = getSecurityById(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString();

  const rawTicker = (updates.ticker ?? existing.ticker).trim().toUpperCase();
  const nextTicker = mapToYahooTicker(rawTicker).yahooTicker;
  const nextCurrency = (
    updates.currency ?? existing.currency
  ).trim().toUpperCase();
  const nextSector = updates.gicsSector ?? existing.gicsSector;
  const nextQuoteProvider = updates.quoteProvider ?? existing.quoteProvider;
  const nextLatestPrice =
    updates.latestPrice !== undefined
      ? updates.latestPrice
      : existing.latestPrice;

  const secCols = db
    .prepare("PRAGMA table_info(securities)")
    .all() as unknown as Array<{ name: string }>;
  const hasProviderSymbol = secCols.some((c) => c.name === "provider_symbol");

  if (hasProviderSymbol) {
    db.prepare(
      `UPDATE securities SET
        ticker = ?,
        name = ?,
        isin = ?,
        gics_sector = ?,
        currency = ?,
        quote_provider = ?,
        provider_symbol = ?,
        latest_price = ?,
        previous_close = ?,
        last_quote_at = ?,
        quote_status = ?,
        quote_error = ?,
        notes = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextTicker,
      updates.name !== undefined ? updates.name : existing.name,
      updates.isin !== undefined ? updates.isin : existing.isin,
      nextSector,
      nextCurrency,
      nextQuoteProvider,
      nextTicker,
      nextLatestPrice,
      updates.previousClose !== undefined
        ? updates.previousClose
        : existing.previousClose,
      updates.lastQuoteAt !== undefined
        ? updates.lastQuoteAt
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? now
          : existing.lastQuoteAt,
      updates.quoteStatus !== undefined
        ? updates.quoteStatus
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? (nextQuoteProvider === "MANUAL" ? "MANUAL" : "OK")
          : existing.quoteStatus,
      updates.quoteError !== undefined
        ? updates.quoteError
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? null
          : existing.quoteError,
      updates.notes !== undefined ? updates.notes : existing.notes,
      now,
      id
    );
  } else {
    db.prepare(
      `UPDATE securities SET
        ticker = ?,
        name = ?,
        isin = ?,
        gics_sector = ?,
        currency = ?,
        quote_provider = ?,
        latest_price = ?,
        previous_close = ?,
        last_quote_at = ?,
        quote_status = ?,
        quote_error = ?,
        notes = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextTicker,
      updates.name !== undefined ? updates.name : existing.name,
      updates.isin !== undefined ? updates.isin : existing.isin,
      nextSector,
      nextCurrency,
      nextQuoteProvider,
      nextLatestPrice,
      updates.previousClose !== undefined
        ? updates.previousClose
        : existing.previousClose,
      updates.lastQuoteAt !== undefined
        ? updates.lastQuoteAt
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? now
          : existing.lastQuoteAt,
      updates.quoteStatus !== undefined
        ? updates.quoteStatus
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? (nextQuoteProvider === "MANUAL" ? "MANUAL" : "OK")
          : existing.quoteStatus,
      updates.quoteError !== undefined
        ? updates.quoteError
        : updates.latestPrice !== undefined && updates.latestPrice !== null
          ? null
          : existing.quoteError,
      updates.notes !== undefined ? updates.notes : existing.notes,
      now,
      id
    );
  }

  // Propagate ticker, gics_sector, and currency changes to linked trades
  const tradeCols = db
    .prepare("PRAGMA table_info(trades)")
    .all() as unknown as Array<{ name: string }>;
  const hasYahooTicker = tradeCols.some((c) => c.name === "yahoo_ticker");

  if (hasYahooTicker) {
    db.prepare(
      `UPDATE trades SET
        ticker = ?,
        yahoo_ticker = ?,
        gics_sector = ?,
        currency = ?,
        updated_at = ?
       WHERE security_id = ?`
    ).run(nextTicker, nextTicker, nextSector, nextCurrency, now, id);
  } else {
    db.prepare(
      `UPDATE trades SET
        ticker = ?,
        gics_sector = ?,
        currency = ?,
        updated_at = ?
       WHERE security_id = ?`
    ).run(nextTicker, nextSector, nextCurrency, now, id);
  }

  // If a latestPrice was updated, also synchronize manual_latest_price on open trades
  if (updates.latestPrice !== undefined && updates.latestPrice !== null) {
    db.prepare(
      `UPDATE trades SET manual_latest_price = ?, updated_at = ? WHERE (security_id = ? OR ticker = ?) AND end_date IS NULL`
    ).run(updates.latestPrice, now, id, nextTicker);
  }

  if (nextCurrency !== "EUR") {
    ensureForexPairExists(nextCurrency, db);
  }

  return getSecurityById(id);
}

export function deleteSecurityById(id: number): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM securities WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

// ============================================================================
// FOREX PAIRS REPOSITORY
// ============================================================================

interface RawForexRow {
  id: number;
  from_currency: string;
  to_currency: string;
  pair_label: string;
  live_provider: string;
  yahoo_symbol: string;
  historical_provider: string;
  latest_rate: number;
  previous_close: number | null;
  last_updated: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToForex(row: RawForexRow): ForexPairRecord {
  return {
    id: row.id,
    fromCurrency: row.from_currency,
    toCurrency: row.to_currency,
    pairLabel: row.pair_label,
    liveProvider: (row.live_provider as FxProviderType) || "YAHOO",
    yahooSymbol: row.yahoo_symbol,
    historicalProvider:
      (row.historical_provider as FxProviderType) || "FRANKFURTER",
    latestRate: row.latest_rate,
    previousClose: row.previous_close,
    lastUpdated: row.last_updated,
    syncStatus: (row.sync_status as ForexPairRecord["syncStatus"]) || "OK",
    syncError: row.sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllForexPairs(): ForexPairRecord[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM forex_pairs ORDER BY from_currency ASC")
    .all() as unknown as RawForexRow[];
  return rows.map(mapRowToForex);
}

export function getForexPairById(id: number): ForexPairRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM forex_pairs WHERE id = ?")
    .get(id) as unknown as RawForexRow | undefined;
  return row ? mapRowToForex(row) : null;
}

function ensureForexPairExists(
  fromCurrency: string,
  customDb?: DatabaseSync
): void {
  const ccy = fromCurrency.trim().toUpperCase();
  if (!ccy || ccy === "EUR") return;
  const db = customDb || getDb();
  const now = new Date().toISOString();
  const defaultRate = getDefaultFxToEur(ccy);

  db.prepare(
    `INSERT OR IGNORE INTO forex_pairs (
      from_currency, to_currency, pair_label, live_provider,
      yahoo_symbol, historical_provider, latest_rate, previous_close,
      last_updated, sync_status, sync_error, created_at, updated_at
    ) VALUES (?, 'EUR', ?, 'YAHOO', ?, 'FRANKFURTER', ?, NULL, ?, 'OK', NULL, ?, ?)`
  ).run(ccy, `${ccy} / EUR`, `${ccy}EUR=X`, defaultRate, now, now, now);
}

export function upsertForexPair(input: NewForexPairInput): ForexPairRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const fromCcy = input.fromCurrency.trim().toUpperCase();
  const toCcy = (input.toCurrency || "EUR").trim().toUpperCase();
  const yahooSymbol = (
    input.yahooSymbol || `${fromCcy}${toCcy}=X`
  ).toUpperCase();
  const liveProvider = input.liveProvider || "YAHOO";
  const historicalProvider = input.historicalProvider || "FRANKFURTER";

  const existing = db
    .prepare("SELECT * FROM forex_pairs WHERE from_currency = ?")
    .get(fromCcy) as unknown as RawForexRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE forex_pairs SET
        live_provider = ?,
        yahoo_symbol = ?,
        historical_provider = ?,
        latest_rate = ?,
        last_updated = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      liveProvider,
      yahooSymbol,
      historicalProvider,
      input.latestRate,
      now,
      now,
      existing.id
    );
    return getForexPairById(existing.id)!;
  }

  const res = db
    .prepare(
      `INSERT INTO forex_pairs (
        from_currency, to_currency, pair_label, live_provider,
        yahoo_symbol, historical_provider, latest_rate, previous_close,
        last_updated, sync_status, sync_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'OK', NULL, ?, ?)`
    )
    .run(
      fromCcy,
      toCcy,
      `${fromCcy} / ${toCcy}`,
      liveProvider,
      yahooSymbol,
      historicalProvider,
      input.latestRate,
      now,
      now,
      now
    );

  return getForexPairById(Number(res.lastInsertRowid))!;
}

export function updateForexPairById(
  id: number,
  updates: Partial<NewForexPairInput> & {
    previousClose?: number | null;
    lastUpdated?: string | null;
    syncStatus?: ForexPairRecord["syncStatus"];
    syncError?: string | null;
  }
): ForexPairRecord | null {
  const existing = getForexPairById(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString();
  const nextFrom = (updates.fromCurrency ?? existing.fromCurrency)
    .trim()
    .toUpperCase();
  const nextYahoo = (updates.yahooSymbol ?? existing.yahooSymbol)
    .trim()
    .toUpperCase();
  const nextRate =
    updates.latestRate !== undefined ? updates.latestRate : existing.latestRate;

  db.prepare(
    `UPDATE forex_pairs SET
      from_currency = ?,
      pair_label = ?,
      live_provider = ?,
      yahoo_symbol = ?,
      historical_provider = ?,
      latest_rate = ?,
      previous_close = ?,
      last_updated = ?,
      sync_status = ?,
      sync_error = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    nextFrom,
    `${nextFrom} / ${existing.toCurrency}`,
    updates.liveProvider ?? existing.liveProvider,
    nextYahoo,
    updates.historicalProvider ?? existing.historicalProvider,
    nextRate,
    updates.previousClose !== undefined
      ? updates.previousClose
      : existing.previousClose,
    updates.lastUpdated !== undefined
      ? updates.lastUpdated
      : existing.lastUpdated,
    updates.syncStatus !== undefined ? updates.syncStatus : existing.syncStatus,
    updates.syncError !== undefined ? updates.syncError : existing.syncError,
    now,
    id
  );

  // Also update open trades in this currency so their cached fx_rate_to_eur stays fresh
  db.prepare(
    `UPDATE trades SET fx_rate_to_eur = ?, updated_at = ?
     WHERE currency = ? AND end_date IS NULL`
  ).run(nextRate, now, nextFrom);

  return getForexPairById(id);
}

export function deleteForexPairById(id: number): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM forex_pairs WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

// ============================================================================
// TRADES REPOSITORY
// ============================================================================

interface RawTradeRow {
  id: number;
  security_id: number | null;
  ticker: string;
  security_name?: string | null;
  quote_last_quote_at?: string | null;
  quote_status?: SecurityRecord["quoteStatus"] | null;
  quote_provider?: QuoteProviderType | null;
  quote_error?: string | null;
  quote_previous_close?: number | null;
  gics_sector: string;
  start_date: string;
  end_date: string | null;
  shares: number;
  buy_price: number;
  sell_price: number | null;
  currency: string;
  initial_stop_loss: number;
  stop_moved: number;
  trimmed_at_2r: number;
  manual_latest_price: number | null;
  fx_rate_to_eur: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToTrade(row: RawTradeRow): TradeRecord {
  return {
    id: row.id,
    securityId: row.security_id,
    ticker: row.ticker,
    securityName:
      row.security_name || KNOWN_COMPANY_NAMES[row.ticker] || row.ticker,
    gicsSector: row.gics_sector,
    startDate: row.start_date,
    endDate: row.end_date,
    shares: row.shares,
    buyPrice: row.buy_price,
    sellPrice: row.sell_price,
    currency: row.currency,
    initialStopLoss: row.initial_stop_loss,
    stopMoved: Boolean(row.stop_moved),
    trimmedAt2R: Boolean(row.trimmed_at_2r),
    manualLatestPrice: row.manual_latest_price,
    fxRateToEur: row.fx_rate_to_eur,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastQuoteAt: row.quote_last_quote_at ?? null,
    quoteStatus: row.quote_status ?? undefined,
    quoteProvider: row.quote_provider ?? undefined,
    quoteError: row.quote_error ?? null,
    previousClose: row.quote_previous_close ?? null,
  };
}

export function getAllTrades(): TradeRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT t.*,
           s.name as security_name,
           s.last_quote_at as quote_last_quote_at,
           s.quote_status as quote_status,
           s.quote_provider as quote_provider,
           s.quote_error as quote_error,
           s.previous_close as quote_previous_close
    FROM trades t
    LEFT JOIN securities s ON (s.id = t.security_id OR (t.security_id IS NULL AND s.ticker = t.ticker))
    ORDER BY
      CASE WHEN t.end_date IS NULL THEN 0 ELSE 1 END ASC,
      COALESCE(t.end_date, t.start_date) DESC,
      t.start_date DESC,
      t.id DESC
  `);
  const rows = stmt.all() as unknown as RawTradeRow[];
  return rows.map(mapRowToTrade);
}

export function getTradeById(id: number): TradeRecord | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.*,
              s.name as security_name,
              s.last_quote_at as quote_last_quote_at,
              s.quote_status as quote_status,
              s.quote_provider as quote_provider,
              s.quote_error as quote_error,
              s.previous_close as quote_previous_close
       FROM trades t
       LEFT JOIN securities s ON (s.id = t.security_id OR (t.security_id IS NULL AND s.ticker = t.ticker))
       WHERE t.id = ?`
    )
    .get(id) as unknown as RawTradeRow | undefined;
  return row ? mapRowToTrade(row) : null;
}

export function createTrade(input: NewTradeInput): TradeRecord {
  const db = getDb();
  const now = new Date().toISOString();

  let security: SecurityRecord | null = null;
  if (input.securityId) {
    security = getSecurityById(input.securityId);
  }
  if (!security) {
    security = upsertSecurity(
      {
        ticker: input.ticker,
        gicsSector: input.gicsSector,
        currency: input.currency,
        latestPrice: input.manualLatestPrice ?? input.sellPrice ?? input.buyPrice,
      },
      db
    );
  }

  const currency = security.currency.toUpperCase();
  const fxRate =
    currency === "EUR"
      ? 1.0
      : (input.fxRateToEur ?? getLiveFxMap()[currency] ?? getDefaultFxToEur(currency));

  const tradeCols = db
    .prepare("PRAGMA table_info(trades)")
    .all() as unknown as Array<{ name: string }>;
  const hasYahooTicker = tradeCols.some((c) => c.name === "yahoo_ticker");

  const stmt = hasYahooTicker
    ? db.prepare(`
        INSERT INTO trades (
          security_id, ticker, yahoo_ticker, gics_sector, start_date, end_date,
          shares, buy_price, sell_price, currency, initial_stop_loss,
          stop_moved, trimmed_at_2r, manual_latest_price, fx_rate_to_eur,
          notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
    : db.prepare(`
        INSERT INTO trades (
          security_id, ticker, gics_sector, start_date, end_date,
          shares, buy_price, sell_price, currency, initial_stop_loss,
          stop_moved, trimmed_at_2r, manual_latest_price, fx_rate_to_eur,
          notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

  const result = hasYahooTicker
    ? stmt.run(
      security.id,
      security.ticker,
      security.ticker,
      input.gicsSector || security.gicsSector,
      input.startDate,
      input.endDate || null,
      input.shares,
      input.buyPrice,
      input.sellPrice ?? null,
      currency,
      input.initialStopLoss,
      input.stopMoved ? 1 : 0,
      input.trimmedAt2R ? 1 : 0,
      input.manualLatestPrice ?? null,
      fxRate,
      input.notes ?? null,
      now,
      now
    )
    : stmt.run(
      security.id,
      security.ticker,
      input.gicsSector || security.gicsSector,
      input.startDate,
      input.endDate || null,
      input.shares,
      input.buyPrice,
      input.sellPrice ?? null,
      currency,
      input.initialStopLoss,
      input.stopMoved ? 1 : 0,
      input.trimmedAt2R ? 1 : 0,
      input.manualLatestPrice ?? null,
      fxRate,
      input.notes ?? null,
      now,
      now
    );

  // If user entered a latest price on an open position, also update security's latest_price if empty
  if (input.manualLatestPrice && !security.latestPrice) {
    updateSecurityById(security.id, { latestPrice: input.manualLatestPrice });
  }

  const insertedId = Number(result.lastInsertRowid);
  return getTradeById(insertedId)!;
}

export function updateTrade(
  id: number,
  updates: Partial<NewTradeInput>
): TradeRecord | null {
  const existing = getTradeById(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString();

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
    const linkedSec = getSecurityById(updates.securityId);
    if (linkedSec) {
      securityId = linkedSec.id;
      nextTicker = linkedSec.ticker;
      nextCurrency = linkedSec.currency;
      nextSector = linkedSec.gicsSector;
    }
  } else if (updates.ticker && updates.ticker !== existing.ticker) {
    const upsertedSec = upsertSecurity(
      {
        ticker: updates.ticker,
        gicsSector: nextSector,
        currency: nextCurrency,
      },
      db
    );
    securityId = upsertedSec.id;
    nextTicker = upsertedSec.ticker;
  }

  const nextEndDate =
    updates.endDate !== undefined ? updates.endDate : existing.endDate;
  const nextSellPrice =
    updates.sellPrice !== undefined ? updates.sellPrice : existing.sellPrice;
  const nextManualLatest =
    updates.manualLatestPrice !== undefined
      ? updates.manualLatestPrice
      : existing.manualLatestPrice;

  const nextFxRate =
    nextCurrency === "EUR"
      ? 1.0
      : updates.fxRateToEur !== undefined
        ? updates.fxRateToEur
        : existing.fxRateToEur;

  const tradeCols = db
    .prepare("PRAGMA table_info(trades)")
    .all() as unknown as Array<{ name: string }>;
  const hasYahooTicker = tradeCols.some((c) => c.name === "yahoo_ticker");

  const stmt = hasYahooTicker
    ? db.prepare(`
        UPDATE trades SET
          security_id = ?,
          ticker = ?,
          yahoo_ticker = ?,
          gics_sector = ?,
          start_date = ?,
          end_date = ?,
          shares = ?,
          buy_price = ?,
          sell_price = ?,
          currency = ?,
          initial_stop_loss = ?,
          stop_moved = ?,
          trimmed_at_2r = ?,
          manual_latest_price = ?,
          fx_rate_to_eur = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `)
    : db.prepare(`
        UPDATE trades SET
          security_id = ?,
          ticker = ?,
          gics_sector = ?,
          start_date = ?,
          end_date = ?,
          shares = ?,
          buy_price = ?,
          sell_price = ?,
          currency = ?,
          initial_stop_loss = ?,
          stop_moved = ?,
          trimmed_at_2r = ?,
          manual_latest_price = ?,
          fx_rate_to_eur = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ?
      `);

  if (hasYahooTicker) {
    stmt.run(
      securityId,
      nextTicker,
      nextTicker,
      nextSector,
      updates.startDate !== undefined ? updates.startDate : existing.startDate,
      nextEndDate || null,
      updates.shares !== undefined ? updates.shares : existing.shares,
      updates.buyPrice !== undefined ? updates.buyPrice : existing.buyPrice,
      nextSellPrice ?? null,
      nextCurrency,
      updates.initialStopLoss !== undefined
        ? updates.initialStopLoss
        : existing.initialStopLoss,
      (updates.stopMoved !== undefined ? updates.stopMoved : existing.stopMoved)
        ? 1
        : 0,
      (updates.trimmedAt2R !== undefined
        ? updates.trimmedAt2R
        : existing.trimmedAt2R)
        ? 1
        : 0,
      nextManualLatest ?? null,
      nextFxRate,
      updates.notes !== undefined ? updates.notes : existing.notes,
      now,
      id
    );
  } else {
    stmt.run(
      securityId,
      nextTicker,
      nextSector,
      updates.startDate !== undefined ? updates.startDate : existing.startDate,
      nextEndDate || null,
      updates.shares !== undefined ? updates.shares : existing.shares,
      updates.buyPrice !== undefined ? updates.buyPrice : existing.buyPrice,
      nextSellPrice ?? null,
      nextCurrency,
      updates.initialStopLoss !== undefined
        ? updates.initialStopLoss
        : existing.initialStopLoss,
      (updates.stopMoved !== undefined ? updates.stopMoved : existing.stopMoved)
        ? 1
        : 0,
      (updates.trimmedAt2R !== undefined
        ? updates.trimmedAt2R
        : existing.trimmedAt2R)
        ? 1
        : 0,
      nextManualLatest ?? null,
      nextFxRate,
      updates.notes !== undefined ? updates.notes : existing.notes,
      now,
      id
    );
  }

  return getTradeById(id);
}

export function deleteTrade(id: number): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM trades WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

export function bulkInsertTrades(
  items: NewTradeInput[],
  customDb?: DatabaseSync,
  replaceExisting = false
): number {
  const db = customDb || getDb();
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION;");
  try {
    if (replaceExisting) {
      db.exec("DELETE FROM trades;");
    }

    const tradeCols = db
      .prepare("PRAGMA table_info(trades)")
      .all() as unknown as Array<{ name: string }>;
    const hasYahooTicker = tradeCols.some((c) => c.name === "yahoo_ticker");

    const stmt = hasYahooTicker
      ? db.prepare(`
          INSERT INTO trades (
            security_id, ticker, yahoo_ticker, gics_sector, start_date, end_date,
            shares, buy_price, sell_price, currency, initial_stop_loss,
            stop_moved, trimmed_at_2r, manual_latest_price, fx_rate_to_eur,
            notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      : db.prepare(`
          INSERT INTO trades (
            security_id, ticker, gics_sector, start_date, end_date,
            shares, buy_price, sell_price, currency, initial_stop_loss,
            stop_moved, trimmed_at_2r, manual_latest_price, fx_rate_to_eur,
            notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

    for (const item of items) {
      const tickerInfo = mapToYahooTicker(item.ticker, item.currency);
      const unifiedTicker = tickerInfo.yahooTicker || tickerInfo.rawTicker;
      const currency = (
        item.currency || tickerInfo.inferredCurrency
      ).toUpperCase();
      const fxRate =
        currency === "EUR"
          ? 1.0
          : (item.fxRateToEur ?? getDefaultFxToEur(currency));

      if (hasYahooTicker) {
        stmt.run(
          null,
          unifiedTicker,
          unifiedTicker,
          item.gicsSector || "Uncategorized",
          item.startDate,
          item.endDate || null,
          item.shares,
          item.buyPrice,
          item.sellPrice ?? null,
          currency,
          item.initialStopLoss,
          item.stopMoved ? 1 : 0,
          item.trimmedAt2R ? 1 : 0,
          item.manualLatestPrice ?? null,
          fxRate,
          item.notes ?? null,
          now,
          now
        );
      } else {
        stmt.run(
          null,
          unifiedTicker,
          item.gicsSector || "Uncategorized",
          item.startDate,
          item.endDate || null,
          item.shares,
          item.buyPrice,
          item.sellPrice ?? null,
          currency,
          item.initialStopLoss,
          item.stopMoved ? 1 : 0,
          item.trimmedAt2R ? 1 : 0,
          item.manualLatestPrice ?? null,
          fxRate,
          item.notes ?? null,
          now,
          now
        );
      }
    }

    syncSecuritiesFromTrades(db);
    db.exec("COMMIT;");
    return items.length;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

/**
 * Returns live/cached prices mapped by single security ticker.
 */
export function getLiveQuoteMap(): Record<string, number> {
  const db = getDb();
  const secRows = db
    .prepare(
      "SELECT ticker, latest_price FROM securities WHERE latest_price IS NOT NULL"
    )
    .all() as unknown as Array<{
      ticker: string;
      latest_price: number;
    }>;

  const map: Record<string, number> = {};
  for (const r of secRows) {
    map[r.ticker] = r.latest_price;
  }
  return map;
}

/**
 * Returns live FX conversion rates to EUR from `forex_pairs`.
 */
export function getLiveFxMap(): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare("SELECT from_currency, latest_rate FROM forex_pairs")
    .all() as unknown as Array<{ from_currency: string; latest_rate: number }>;

  const map: Record<string, number> = { EUR: 1.0 };
  for (const r of rows) {
    map[r.from_currency] = r.latest_rate;
  }
  return map;
}

export function getDefaultFxToEur(currency: string): number {
  const ccy = currency.toUpperCase();
  if (ccy === "EUR") return 1.0;
  const defaults: Record<string, number> = {
    USD: 0.89338,
    CAD: 0.621215,
    SEK: 0.09125,
    DKK: 0.133774,
    GBP: 1.185,
  };
  return defaults[ccy] ?? 1.0;
}
