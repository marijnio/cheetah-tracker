import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  SCHEMA_DDL,
  type UserRecord,
  type PublicUser,
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

const CURRENT_DB_INIT_VERSION = 6;

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

  // Version 4 Migration: Add entry_fx_rate_to_eur column (Start Date FX rate)
  const hasEntryFxRate = tradeCols.some(
    (c) => c.name === "entry_fx_rate_to_eur"
  );
  if (!hasEntryFxRate) {
    db.exec("ALTER TABLE trades ADD COLUMN entry_fx_rate_to_eur REAL;");
  }

  // Version 5 Migration: Add position_group_id column for grouping trimmed/split lots
  const hasPositionGroupId = tradeCols.some(
    (c) => c.name === "position_group_id"
  );
  if (!hasPositionGroupId) {
    db.exec("ALTER TABLE trades ADD COLUMN position_group_id TEXT;");
  }

  // Version 6 Migration: Multi-user isolation (user_id on trades, securities, forex_pairs)
  const hasTradesUserId = tradeCols.some((c) => c.name === "user_id");
  if (!hasTradesUserId) {
    db.exec(
      "ALTER TABLE trades ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;"
    );
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);");

  const secCols = db
    .prepare("PRAGMA table_info(securities)")
    .all() as unknown as Array<{ name: string }>;
  const hasProviderSymbol = secCols.some((c) => c.name === "provider_symbol");
  const hasTradingViewUrl = secCols.some((c) => c.name === "tradingview_url");
  if (!hasTradingViewUrl) {
    db.exec("ALTER TABLE securities ADD COLUMN tradingview_url TEXT;");
  }

  if (hasProviderSymbol) {
    db.exec(`
      UPDATE securities
      SET ticker = provider_symbol
      WHERE provider_symbol IS NOT NULL AND provider_symbol != '' AND ticker != provider_symbol;
    `);
    db.exec(`
      UPDATE trades
      SET ticker = (
        SELECT s.ticker FROM securities s WHERE s.id = trades.security_id
      )
      WHERE security_id IS NOT NULL;
    `);
  }

  const hasSecUserId = secCols.some((c) => c.name === "user_id");
  if (!hasSecUserId) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`
      CREATE TABLE securities_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        isin TEXT,
        gics_sector TEXT NOT NULL DEFAULT 'Uncategorized',
        currency TEXT NOT NULL DEFAULT 'USD',
        quote_provider TEXT NOT NULL DEFAULT 'YAHOO',
        latest_price REAL,
        previous_close REAL,
        last_quote_at TEXT,
        quote_status TEXT NOT NULL DEFAULT 'PENDING',
        quote_error TEXT,
        tradingview_url TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, ticker)
      );
      INSERT INTO securities_v6 (
        id, user_id, ticker, name, isin, gics_sector, currency,
        quote_provider, latest_price, previous_close, last_quote_at,
        quote_status, quote_error, tradingview_url, notes, created_at, updated_at
      )
      SELECT id, NULL, ticker, name, isin, gics_sector, currency,
             quote_provider, latest_price, previous_close, last_quote_at,
             quote_status, quote_error, tradingview_url, notes, created_at, updated_at
      FROM securities;
      DROP TABLE securities;
      ALTER TABLE securities_v6 RENAME TO securities;
      CREATE INDEX IF NOT EXISTS idx_securities_ticker ON securities(ticker);
    `);
    db.exec("PRAGMA foreign_keys = ON;");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_securities_user_id ON securities(user_id);"
  );

  const fxCols = db
    .prepare("PRAGMA table_info(forex_pairs)")
    .all() as unknown as Array<{ name: string }>;
  const hasFxUserId = fxCols.some((c) => c.name === "user_id");
  if (!hasFxUserId) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec(`
      CREATE TABLE forex_pairs_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        from_currency TEXT NOT NULL,
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
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, from_currency)
      );
      INSERT INTO forex_pairs_v6 (
        id, user_id, from_currency, to_currency, pair_label, live_provider,
        yahoo_symbol, historical_provider, latest_rate, previous_close,
        last_updated, sync_status, sync_error, created_at, updated_at
      )
      SELECT id, NULL, from_currency, to_currency, pair_label, live_provider,
             yahoo_symbol, historical_provider, latest_rate, previous_close,
             last_updated, sync_status, sync_error, created_at, updated_at
      FROM forex_pairs;
      DROP TABLE forex_pairs;
      ALTER TABLE forex_pairs_v6 RENAME TO forex_pairs;
    `);
    db.exec("PRAGMA foreign_keys = ON;");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_forex_pairs_user_id ON forex_pairs(user_id);"
  );

  // 3. Backfill entry_fx_rate_to_eur for existing rows where missing
  const nullEntryFxCount = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM trades WHERE entry_fx_rate_to_eur IS NULL"
    )
    .get() as { cnt: number };
  if (nullEntryFxCount && nullEntryFxCount.cnt > 0) {
    db.exec(`
      UPDATE trades
      SET entry_fx_rate_to_eur = CASE WHEN currency = 'EUR' THEN 1.0 ELSE fx_rate_to_eur END
      WHERE entry_fx_rate_to_eur IS NULL;
    `);
  }

  // 4. Backfill / sync Securities from existing trades and link trades.security_id
  syncSecuritiesFromTrades(db);
}

/**
 * Ensures every distinct (user_id, ticker) in `trades` exists in `securities` and links `trades.security_id`.
 */
export function syncSecuritiesFromTrades(
  customDb?: DatabaseSync,
  userId?: number
): void {
  const db = customDb || getDb();
  const now = new Date().toISOString();

  const distinctRows = (
    userId !== undefined
      ? db
          .prepare(
            `SELECT user_id, ticker, gics_sector, currency,
                    MAX(COALESCE(manual_latest_price, sell_price, buy_price)) as last_known_price
             FROM trades
             WHERE user_id = ?
             GROUP BY user_id, ticker`
          )
          .all(userId)
      : db
          .prepare(
            `SELECT user_id, ticker, gics_sector, currency,
                    MAX(COALESCE(manual_latest_price, sell_price, buy_price)) as last_known_price
             FROM trades
             GROUP BY user_id, ticker`
          )
          .all()
  ) as unknown as Array<{
    user_id: number | null;
    ticker: string;
    gics_sector: string;
    currency: string;
    last_known_price: number | null;
  }>;

  const insertSec = db.prepare(`
    INSERT OR IGNORE INTO securities (
      user_id, ticker, name, isin, gics_sector, currency,
      quote_provider, latest_price, previous_close,
      last_quote_at, quote_status, quote_error, notes, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, ?, 'YAHOO', ?, NULL, ?, 'OK', NULL, NULL, ?, ?)
  `);

  for (const r of distinctRows) {
    const companyName = KNOWN_COMPANY_NAMES[r.ticker] || r.ticker;
    insertSec.run(
      r.user_id,
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

  // Link any unlinked trades to their security_id within the same user_id
  if (userId !== undefined) {
    db.prepare(
      `UPDATE trades
       SET security_id = (
         SELECT s.id FROM securities s WHERE s.ticker = trades.ticker AND s.user_id = trades.user_id
       )
       WHERE security_id IS NULL AND user_id = ?`
    ).run(userId);
  } else {
    db.exec(`
      UPDATE trades
      SET security_id = (
        SELECT s.id FROM securities s WHERE s.ticker = trades.ticker AND s.user_id IS trades.user_id
      )
      WHERE security_id IS NULL;
    `);
  }
}

// ============================================================================
// USERS REPOSITORY
// ============================================================================

interface RawUserRow {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  cash_balance: number;
  risk_percent: number;
  created_at: string;
  updated_at: string;
  trade_count?: number;
}

function mapRowToUser(row: RawUserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    isAdmin: Boolean(row.is_admin),
    cashBalance: Number(row.cash_balance ?? 25000),
    riskPercent: Number(row.risk_percent ?? 1.0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicUser(user: UserRecord, tradeCount?: number): PublicUser {
  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    cashBalance: user.cashBalance,
    riskPercent: user.riskPercent,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    tradeCount,
  };
}

export function getUserCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as {
    cnt: number;
  };
  return Number(row?.cnt ?? 0);
}

export function getUserById(id: number): UserRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as unknown as RawUserRow | undefined;
  return row ? mapRowToUser(row) : null;
}

export function getUserByUsername(username: string): UserRecord | null {
  const db = getDb();
  const cleaned = username.trim().toLowerCase();
  const row = db
    .prepare("SELECT * FROM users WHERE LOWER(username) = ?")
    .get(cleaned) as unknown as RawUserRow | undefined;
  return row ? mapRowToUser(row) : null;
}

export function getAllUsersWithTradeCounts(): PublicUser[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.*, COUNT(t.id) as trade_count
       FROM users u
       LEFT JOIN trades t ON t.user_id = u.id
       GROUP BY u.id
       ORDER BY u.is_admin DESC, u.username ASC`
    )
    .all() as unknown as RawUserRow[];

  return rows.map((r) => toPublicUser(mapRowToUser(r), Number(r.trade_count ?? 0)));
}

export function seedDefaultForexPairsForUser(
  userId: number,
  customDb?: DatabaseSync
): void {
  const db = customDb || getDb();
  const now = new Date().toISOString();
  const insertFxStmt = db.prepare(`
    INSERT OR IGNORE INTO forex_pairs (
      user_id, from_currency, to_currency, pair_label, live_provider,
      yahoo_symbol, historical_provider, latest_rate, previous_close,
      last_updated, sync_status, sync_error, created_at, updated_at
    ) VALUES (?, ?, 'EUR', ?, 'YAHOO', ?, 'FRANKFURTER', ?, NULL, NULL, 'PENDING', NULL, ?, ?)
  `);

  for (const fx of DEFAULT_FOREX_PAIRS) {
    insertFxStmt.run(
      userId,
      fx.fromCurrency,
      `${fx.fromCurrency} / EUR`,
      fx.yahooSymbol,
      fx.latestRate,
      now,
      now
    );
  }
}

export function createUser(input: {
  username: string;
  passwordHash: string;
  isAdmin?: boolean;
  cashBalance?: number;
  riskPercent?: number;
}): PublicUser {
  const db = getDb();
  const now = new Date().toISOString();
  const cleanUsername = input.username.trim();
  const isFirstUser = getUserCount() === 0;
  const isAdmin = isFirstUser ? true : Boolean(input.isAdmin);

  const res = db
    .prepare(
      `INSERT INTO users (
        username, password_hash, is_admin, cash_balance, risk_percent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanUsername,
      input.passwordHash,
      isAdmin ? 1 : 0,
      input.cashBalance ?? 25000,
      input.riskPercent ?? 1.0,
      now,
      now
    );

  const newUserId = Number(res.lastInsertRowid);

  // If this is the first user, claim any legacy unowned rows
  if (isFirstUser) {
    db.prepare("UPDATE trades SET user_id = ? WHERE user_id IS NULL").run(newUserId);
    db.prepare("UPDATE securities SET user_id = ? WHERE user_id IS NULL").run(newUserId);
    db.prepare("UPDATE forex_pairs SET user_id = ? WHERE user_id IS NULL").run(newUserId);
  }

  seedDefaultForexPairsForUser(newUserId, db);

  return toPublicUser(getUserById(newUserId)!, 0);
}

export function updateUserPreferences(
  userId: number,
  updates: { cashBalance?: number; riskPercent?: number }
): PublicUser | null {
  const existing = getUserById(userId);
  if (!existing) return null;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users SET cash_balance = ?, risk_percent = ?, updated_at = ? WHERE id = ?`
  ).run(
    updates.cashBalance !== undefined ? updates.cashBalance : existing.cashBalance,
    updates.riskPercent !== undefined ? updates.riskPercent : existing.riskPercent,
    now,
    userId
  );
  return toPublicUser(getUserById(userId)!);
}

export function updateUserPassword(userId: number, passwordHash: string): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, now, userId);
  return Number(res.changes) > 0;
}

export function updateUserAdminStatus(userId: number, isAdmin: boolean): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db
    .prepare("UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?")
    .run(isAdmin ? 1 : 0, now, userId);
  return Number(res.changes) > 0;
}

export function deleteUserById(userId: number): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  return Number(res.changes) > 0;
}

// ============================================================================
// SECURITIES REPOSITORY
// ============================================================================

interface RawSecurityRow {
  id: number;
  user_id?: number | null;
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
  tradingview_url?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  trade_count?: number;
  open_trade_count?: number;
}

function mapRowToSecurity(row: RawSecurityRow): SecurityRecord {
  return {
    id: row.id,
    userId: row.user_id ?? null,
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
    tradingViewUrl: row.tradingview_url ?? null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tradeCount: Number(row.trade_count ?? 0),
    openTradeCount: Number(row.open_trade_count ?? 0),
  };
}

export function getAllSecurities(userId: number): SecurityRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*,
              COUNT(t.id) as trade_count,
              SUM(CASE WHEN t.id IS NOT NULL AND t.end_date IS NULL THEN 1 ELSE 0 END) as open_trade_count
       FROM securities s
       LEFT JOIN trades t ON t.security_id = s.id AND t.user_id = ?
       WHERE s.user_id = ?
       GROUP BY s.id
       ORDER BY open_trade_count DESC, s.ticker ASC`
    )
    .all(userId, userId) as unknown as RawSecurityRow[];

  return rows.map(mapRowToSecurity);
}

export function getSecurityById(
  id: number,
  userId?: number
): SecurityRecord | null {
  const db = getDb();
  const row = (
    userId !== undefined
      ? db
          .prepare(
            `SELECT s.*,
                    COUNT(t.id) as trade_count,
                    SUM(CASE WHEN t.id IS NOT NULL AND t.end_date IS NULL THEN 1 ELSE 0 END) as open_trade_count
             FROM securities s
             LEFT JOIN trades t ON t.security_id = s.id AND t.user_id = ?
             WHERE s.id = ? AND s.user_id = ?
             GROUP BY s.id`
          )
          .get(userId, id, userId)
      : db
          .prepare(
            `SELECT s.*,
                    COUNT(t.id) as trade_count,
                    SUM(CASE WHEN t.id IS NOT NULL AND t.end_date IS NULL THEN 1 ELSE 0 END) as open_trade_count
             FROM securities s
             LEFT JOIN trades t ON t.security_id = s.id
             WHERE s.id = ?
             GROUP BY s.id`
          )
          .get(id)
  ) as unknown as RawSecurityRow | undefined;

  return row ? mapRowToSecurity(row) : null;
}

export function getSecurityByTicker(
  ticker: string,
  userId: number
): SecurityRecord | null {
  const db = getDb();
  const cleaned = ticker.trim().toUpperCase();
  const row = db
    .prepare("SELECT * FROM securities WHERE ticker = ? AND user_id = ?")
    .get(cleaned, userId) as unknown as RawSecurityRow | undefined;
  return row ? mapRowToSecurity(row) : null;
}

export function upsertSecurity(
  input: NewSecurityInput,
  userId: number,
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

  const existing = db
    .prepare("SELECT * FROM securities WHERE ticker = ? AND user_id = ?")
    .get(ticker, userId) as unknown as RawSecurityRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE securities SET
        name = ?,
        isin = ?,
        gics_sector = ?,
        currency = ?,
        quote_provider = ?,
        latest_price = COALESCE(?, latest_price),
        tradingview_url = ?,
        notes = COALESCE(?, notes),
        updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      input.name !== undefined ? name : existing.name,
      input.isin !== undefined ? input.isin : existing.isin,
      input.gicsSector !== undefined ? gicsSector : existing.gics_sector,
      input.currency !== undefined ? currency : existing.currency,
      input.quoteProvider !== undefined
        ? quoteProvider
        : existing.quote_provider,
      input.latestPrice ?? null,
      input.tradingViewUrl !== undefined
        ? input.tradingViewUrl
        : existing.tradingview_url ?? null,
      input.notes ?? null,
      now,
      existing.id,
      userId
    );
    return getSecurityById(existing.id, userId)!;
  }

  const res = db
    .prepare(
      `INSERT INTO securities(
        user_id, ticker, name, isin, gics_sector, currency,
        quote_provider, latest_price, previous_close,
        last_quote_at, quote_status, quote_error, tradingview_url, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(
      userId,
      ticker,
      name,
      input.isin ?? null,
      gicsSector,
      currency,
      quoteProvider,
      input.latestPrice ?? null,
      input.latestPrice ? now : null,
      quoteProvider === "MANUAL" ? "MANUAL" : "PENDING",
      input.tradingViewUrl ?? null,
      input.notes ?? null,
      now,
      now
    );

  if (currency !== "EUR") {
    ensureForexPairExists(currency, userId, db);
  }

  return getSecurityById(Number(res.lastInsertRowid), userId)!;
}

export function updateSecurityById(
  id: number,
  updates: Partial<NewSecurityInput> & {
    previousClose?: number | null;
    lastQuoteAt?: string | null;
    quoteStatus?: SecurityRecord["quoteStatus"];
    quoteError?: string | null;
  },
  userId: number
): SecurityRecord | null {
  const existing = getSecurityById(id, userId);
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
      tradingview_url = ?,
      notes = ?,
      updated_at = ?
     WHERE id = ? AND user_id = ?`
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
        ? nextQuoteProvider === "MANUAL"
          ? "MANUAL"
          : "OK"
        : existing.quoteStatus,
    updates.quoteError !== undefined
      ? updates.quoteError
      : updates.latestPrice !== undefined && updates.latestPrice !== null
        ? null
        : existing.quoteError,
    updates.tradingViewUrl !== undefined
      ? updates.tradingViewUrl
      : existing.tradingViewUrl,
    updates.notes !== undefined ? updates.notes : existing.notes,
    now,
    id,
    userId
  );

  db.prepare(
    `UPDATE trades SET
      ticker = ?,
      gics_sector = ?,
      currency = ?,
      updated_at = ?
     WHERE security_id = ? AND user_id = ?`
  ).run(nextTicker, nextSector, nextCurrency, now, id, userId);

  if (updates.latestPrice !== undefined && updates.latestPrice !== null) {
    db.prepare(
      `UPDATE trades SET manual_latest_price = ?, updated_at = ?
       WHERE (security_id = ? OR ticker = ?) AND user_id = ? AND end_date IS NULL`
    ).run(updates.latestPrice, now, id, nextTicker, userId);
  }

  if (nextCurrency !== "EUR") {
    ensureForexPairExists(nextCurrency, userId, db);
  }

  return getSecurityById(id, userId);
}

export function deleteSecurityById(id: number, userId: number): boolean {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM securities WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return Number(res.changes) > 0;
}

// ============================================================================
// FOREX PAIRS REPOSITORY
// ============================================================================

interface RawForexRow {
  id: number;
  user_id?: number | null;
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
    userId: row.user_id ?? null,
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

export function getAllForexPairs(userId: number): ForexPairRecord[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM forex_pairs WHERE user_id = ? ORDER BY from_currency ASC"
    )
    .all(userId) as unknown as RawForexRow[];
  return rows.map(mapRowToForex);
}

export function getForexPairById(
  id: number,
  userId?: number
): ForexPairRecord | null {
  const db = getDb();
  const row = (
    userId !== undefined
      ? db
          .prepare("SELECT * FROM forex_pairs WHERE id = ? AND user_id = ?")
          .get(id, userId)
      : db.prepare("SELECT * FROM forex_pairs WHERE id = ?").get(id)
  ) as unknown as RawForexRow | undefined;
  return row ? mapRowToForex(row) : null;
}

function ensureForexPairExists(
  fromCurrency: string,
  userId: number,
  customDb?: DatabaseSync
): void {
  const ccy = fromCurrency.trim().toUpperCase();
  if (!ccy || ccy === "EUR") return;
  const db = customDb || getDb();
  const now = new Date().toISOString();
  const defaultRate = getDefaultFxToEur(ccy);

  db.prepare(
    `INSERT OR IGNORE INTO forex_pairs (
      user_id, from_currency, to_currency, pair_label, live_provider,
      yahoo_symbol, historical_provider, latest_rate, previous_close,
      last_updated, sync_status, sync_error, created_at, updated_at
    ) VALUES (?, ?, 'EUR', ?, 'YAHOO', ?, 'FRANKFURTER', ?, NULL, NULL, 'PENDING', NULL, ?, ?)`
  ).run(userId, ccy, `${ccy} / EUR`, `${ccy}EUR=X`, defaultRate, now, now);
}

export function upsertForexPair(
  input: NewForexPairInput,
  userId: number
): ForexPairRecord {
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
    .prepare("SELECT * FROM forex_pairs WHERE from_currency = ? AND user_id = ?")
    .get(fromCcy, userId) as unknown as RawForexRow | undefined;

  if (existing) {
    db.prepare(
      `UPDATE forex_pairs SET
        live_provider = ?,
        yahoo_symbol = ?,
        historical_provider = ?,
        latest_rate = ?,
        last_updated = ?,
        updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      liveProvider,
      yahooSymbol,
      historicalProvider,
      input.latestRate,
      now,
      now,
      existing.id,
      userId
    );
    return getForexPairById(existing.id, userId)!;
  }

  const res = db
    .prepare(
      `INSERT INTO forex_pairs (
        user_id, from_currency, to_currency, pair_label, live_provider,
        yahoo_symbol, historical_provider, latest_rate, previous_close,
        last_updated, sync_status, sync_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'OK', NULL, ?, ?)`
    )
    .run(
      userId,
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

  return getForexPairById(Number(res.lastInsertRowid), userId)!;
}

export function updateForexPairById(
  id: number,
  updates: Partial<NewForexPairInput> & {
    previousClose?: number | null;
    lastUpdated?: string | null;
    syncStatus?: ForexPairRecord["syncStatus"];
    syncError?: string | null;
  },
  userId: number
): ForexPairRecord | null {
  const existing = getForexPairById(id, userId);
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
     WHERE id = ? AND user_id = ?`
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
    id,
    userId
  );

  db.prepare(
    `UPDATE trades SET fx_rate_to_eur = ?, updated_at = ?
     WHERE currency = ? AND user_id = ? AND end_date IS NULL`
  ).run(nextRate, now, nextFrom, userId);

  return getForexPairById(id, userId);
}

export function deleteForexPairById(id: number, userId: number): boolean {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM forex_pairs WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return Number(res.changes) > 0;
}

// ============================================================================
// TRADES REPOSITORY
// ============================================================================

interface RawTradeRow {
  id: number;
  user_id?: number | null;
  security_id: number | null;
  ticker: string;
  security_name?: string | null;
  quote_last_quote_at?: string | null;
  quote_status?: SecurityRecord["quoteStatus"] | null;
  quote_provider?: QuoteProviderType | null;
  quote_error?: string | null;
  quote_previous_close?: number | null;
  security_tradingview_url?: string | null;
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
  entry_fx_rate_to_eur: number | null;
  fx_rate_to_eur: number;
  position_group_id?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToTrade(row: RawTradeRow): TradeRecord {
  const ccy = (row.currency || "USD").toUpperCase();
  const exitFx = ccy === "EUR" ? 1.0 : row.fx_rate_to_eur;
  const entryFx =
    ccy === "EUR" ? 1.0 : (row.entry_fx_rate_to_eur ?? row.fx_rate_to_eur);
  return {
    id: row.id,
    userId: row.user_id ?? null,
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
    entryFxRateToEur: entryFx,
    fxRateToEur: exitFx,
    positionGroupId: row.position_group_id ?? null,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastQuoteAt: row.quote_last_quote_at ?? null,
    quoteStatus: row.quote_status ?? undefined,
    quoteProvider: row.quote_provider ?? undefined,
    quoteError: row.quote_error ?? null,
    previousClose: row.quote_previous_close ?? null,
    tradingViewUrl: row.security_tradingview_url ?? null,
  };
}

export function getAllTrades(userId: number): TradeRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT t.*,
           s.name as security_name,
           s.last_quote_at as quote_last_quote_at,
           s.quote_status as quote_status,
           s.quote_provider as quote_provider,
           s.quote_error as quote_error,
           s.previous_close as quote_previous_close,
           s.tradingview_url as security_tradingview_url
    FROM trades t
    LEFT JOIN securities s ON (s.id = t.security_id OR (t.security_id IS NULL AND s.ticker = t.ticker AND s.user_id = t.user_id))
    WHERE t.user_id = ?
    ORDER BY
      CASE WHEN t.end_date IS NULL THEN 0 ELSE 1 END ASC,
      COALESCE(t.end_date, t.start_date) DESC,
      t.start_date DESC,
      t.id DESC
  `);
  const rows = stmt.all(userId) as unknown as RawTradeRow[];
  return rows.map(mapRowToTrade);
}

export function getTradeById(id: number, userId?: number): TradeRecord | null {
  const db = getDb();
  const row = (
    userId !== undefined
      ? db
          .prepare(
            `SELECT t.*,
                    s.name as security_name,
                    s.last_quote_at as quote_last_quote_at,
                    s.quote_status as quote_status,
                    s.quote_provider as quote_provider,
                    s.quote_error as quote_error,
                    s.previous_close as quote_previous_close,
                    s.tradingview_url as security_tradingview_url
             FROM trades t
             LEFT JOIN securities s ON (s.id = t.security_id OR (t.security_id IS NULL AND s.ticker = t.ticker AND s.user_id = t.user_id))
             WHERE t.id = ? AND t.user_id = ?`
          )
          .get(id, userId)
      : db
          .prepare(
            `SELECT t.*,
                    s.name as security_name,
                    s.last_quote_at as quote_last_quote_at,
                    s.quote_status as quote_status,
                    s.quote_provider as quote_provider,
                    s.quote_error as quote_error,
                    s.previous_close as quote_previous_close,
                    s.tradingview_url as security_tradingview_url
             FROM trades t
             LEFT JOIN securities s ON (s.id = t.security_id OR (t.security_id IS NULL AND s.ticker = t.ticker AND s.user_id = t.user_id))
             WHERE t.id = ?`
          )
          .get(id)
  ) as unknown as RawTradeRow | undefined;
  return row ? mapRowToTrade(row) : null;
}

export function createTrade(input: NewTradeInput, userId: number): TradeRecord {
  const db = getDb();
  const now = new Date().toISOString();

  let security: SecurityRecord | null = null;
  if (input.securityId) {
    security = getSecurityById(input.securityId, userId);
  }
  if (!security) {
    security = upsertSecurity(
      {
        ticker: input.ticker,
        gicsSector: input.gicsSector,
        currency: input.currency,
        latestPrice: input.manualLatestPrice ?? input.sellPrice ?? input.buyPrice,
      },
      userId,
      db
    );
  }

  const currency = security.currency.toUpperCase();
  const fxRate =
    currency === "EUR"
      ? 1.0
      : (input.fxRateToEur ??
        getLiveFxMap(userId)[currency] ??
        getDefaultFxToEur(currency));
  const entryFxRate =
    currency === "EUR" ? 1.0 : (input.entryFxRateToEur ?? fxRate);

  const stmt = db.prepare(`
    INSERT INTO trades (
      user_id, security_id, ticker, gics_sector, start_date, end_date,
      shares, buy_price, sell_price, currency, initial_stop_loss,
      stop_moved, trimmed_at_2r, manual_latest_price, entry_fx_rate_to_eur, fx_rate_to_eur,
      position_group_id, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    userId,
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
    entryFxRate,
    fxRate,
    input.positionGroupId ?? null,
    input.notes ?? null,
    now,
    now
  );

  if (input.manualLatestPrice && !security.latestPrice) {
    updateSecurityById(
      security.id,
      { latestPrice: input.manualLatestPrice },
      userId
    );
  }

  const insertedId = Number(result.lastInsertRowid);
  return getTradeById(insertedId, userId)!;
}

export function updateTrade(
  id: number,
  updates: Partial<NewTradeInput>,
  userId: number
): TradeRecord | null {
  const existing = getTradeById(id, userId);
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
    const linkedSec = getSecurityById(updates.securityId, userId);
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
      userId,
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
  const nextEntryFxRate =
    nextCurrency === "EUR"
      ? 1.0
      : updates.entryFxRateToEur !== undefined
        ? updates.entryFxRateToEur
        : existing.entryFxRateToEur;

  db.prepare(
    `UPDATE trades SET
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
      entry_fx_rate_to_eur = ?,
      fx_rate_to_eur = ?,
      position_group_id = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`
  ).run(
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
    nextEntryFxRate,
    nextFxRate,
    updates.positionGroupId !== undefined
      ? updates.positionGroupId ?? null
      : existing.positionGroupId ?? null,
    updates.notes !== undefined ? updates.notes : existing.notes,
    now,
    id,
    userId
  );

  return getTradeById(id, userId);
}

export function deleteTrade(id: number, userId: number): boolean {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM trades WHERE id = ? AND user_id = ?")
    .run(id, userId);
  return Number(res.changes) > 0;
}

export function bulkInsertTrades(
  items: NewTradeInput[],
  userId: number,
  customDb?: DatabaseSync,
  replaceExisting = false
): number {
  const db = customDb || getDb();
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION;");
  try {
    if (replaceExisting) {
      db.prepare("DELETE FROM trades WHERE user_id = ?").run(userId);
    }

    const stmt = db.prepare(`
      INSERT INTO trades (
        user_id, security_id, ticker, gics_sector, start_date, end_date,
        shares, buy_price, sell_price, currency, initial_stop_loss,
        stop_moved, trimmed_at_2r, manual_latest_price, entry_fx_rate_to_eur, fx_rate_to_eur,
        position_group_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const entryFxRate =
        currency === "EUR" ? 1.0 : (item.entryFxRateToEur ?? fxRate);

      stmt.run(
        userId,
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
        entryFxRate,
        fxRate,
        item.positionGroupId ?? null,
        item.notes ?? null,
        now,
        now
      );
    }

    syncSecuritiesFromTrades(db, userId);
    db.exec("COMMIT;");
    return items.length;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function clearPortfolioForUser(userId: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare("DELETE FROM trades WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM securities WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM forex_pairs WHERE user_id = ?").run(userId);
    db.prepare(
      "UPDATE users SET cash_balance = 25000, risk_percent = 1.0, updated_at = ? WHERE id = ?"
    ).run(now, userId);
    seedDefaultForexPairsForUser(userId, db);
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export function replacePortfolioForUser(
  userId: number,
  payload: {
    trades: TradeRecord[];
    securities: SecurityRecord[];
    forexPairs: ForexPairRecord[];
    cashBalance: number;
    riskPercent: number;
  }
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare("DELETE FROM trades WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM securities WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM forex_pairs WHERE user_id = ?").run(userId);

    // 1. Insert forex pairs (or seed defaults if empty)
    if (payload.forexPairs.length > 0) {
      const insertFx = db.prepare(`
        INSERT OR IGNORE INTO forex_pairs (
          user_id, from_currency, to_currency, pair_label, live_provider,
          yahoo_symbol, historical_provider, latest_rate, previous_close,
          last_updated, sync_status, sync_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const fx of payload.forexPairs) {
        const fromCcy = fx.fromCurrency.trim().toUpperCase();
        const toCcy = (fx.toCurrency || "EUR").trim().toUpperCase();
        insertFx.run(
          userId,
          fromCcy,
          toCcy,
          fx.pairLabel || `${fromCcy} / ${toCcy}`,
          fx.liveProvider || "YAHOO",
          fx.yahooSymbol || `${fromCcy}${toCcy}=X`,
          fx.historicalProvider || "FRANKFURTER",
          fx.latestRate,
          fx.previousClose ?? null,
          fx.lastUpdated ?? now,
          fx.syncStatus || "OK",
          fx.syncError ?? null,
          fx.createdAt || now,
          now
        );
      }
    } else {
      seedDefaultForexPairsForUser(userId, db);
    }

    // 2. Insert securities and track ticker -> new id
    const tickerToNewId = new Map<string, number>();
    const insertSec = db.prepare(`
      INSERT OR IGNORE INTO securities (
        user_id, ticker, name, isin, gics_sector, currency,
        quote_provider, latest_price, previous_close,
        last_quote_at, quote_status, quote_error, tradingview_url, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const sec of payload.securities) {
      const ticker = sec.ticker.trim().toUpperCase();
      const res = insertSec.run(
        userId,
        ticker,
        sec.name || ticker,
        sec.isin ?? null,
        sec.gicsSector || "Uncategorized",
        (sec.currency || "USD").toUpperCase(),
        sec.quoteProvider || "YAHOO",
        sec.latestPrice ?? null,
        sec.previousClose ?? null,
        sec.lastQuoteAt ?? null,
        sec.quoteStatus || "PENDING",
        sec.quoteError ?? null,
        sec.tradingViewUrl ?? null,
        sec.notes ?? null,
        sec.createdAt || now,
        now
      );
      if (Number(res.changes) > 0) {
        tickerToNewId.set(ticker, Number(res.lastInsertRowid));
      }
    }

    // 3. Insert trades
    const insertTrade = db.prepare(`
      INSERT INTO trades (
        user_id, security_id, ticker, gics_sector, start_date, end_date,
        shares, buy_price, sell_price, currency, initial_stop_loss,
        stop_moved, trimmed_at_2r, manual_latest_price, entry_fx_rate_to_eur, fx_rate_to_eur,
        position_group_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const t of payload.trades) {
      const ticker = t.ticker.trim().toUpperCase();
      const secId = tickerToNewId.get(ticker) ?? null;
      const currency = (t.currency || "USD").toUpperCase();
      insertTrade.run(
        userId,
        secId,
        ticker,
        t.gicsSector || "Uncategorized",
        t.startDate,
        t.endDate ?? null,
        t.shares,
        t.buyPrice,
        t.sellPrice ?? null,
        currency,
        t.initialStopLoss,
        t.stopMoved ? 1 : 0,
        t.trimmedAt2R ? 1 : 0,
        t.manualLatestPrice ?? null,
        currency === "EUR" ? 1.0 : t.entryFxRateToEur ?? t.fxRateToEur ?? 1.0,
        currency === "EUR" ? 1.0 : t.fxRateToEur ?? 1.0,
        t.positionGroupId ?? null,
        t.notes ?? null,
        t.createdAt || now,
        now
      );
    }

    syncSecuritiesFromTrades(db, userId);

    // 4. Update user's cash balance & risk percent
    db.prepare(
      "UPDATE users SET cash_balance = ?, risk_percent = ?, updated_at = ? WHERE id = ?"
    ).run(payload.cashBalance, payload.riskPercent, now, userId);

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

/**
 * Returns live/cached prices mapped by single security ticker for a user.
 */
export function getLiveQuoteMap(userId: number): Record<string, number> {
  const db = getDb();
  const secRows = db
    .prepare(
      "SELECT ticker, latest_price FROM securities WHERE user_id = ? AND latest_price IS NOT NULL"
    )
    .all(userId) as unknown as Array<{
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
 * Returns live FX conversion rates to EUR from `forex_pairs` for a user.
 */
export function getLiveFxMap(userId: number): Record<string, number> {
  const db = getDb();
  const rows = db
    .prepare("SELECT from_currency, latest_rate FROM forex_pairs WHERE user_id = ?")
    .all(userId) as unknown as Array<{
      from_currency: string;
      latest_rate: number;
    }>;

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

// ============================================================================
// HISTORICAL FX CACHE & BULK TRADE FX UPDATER
// ============================================================================

export function getCachedHistoricalFxMap(
  requests: Array<{ fromCurrency: string; requestedDate: string }>
): Record<string, { rateToEur: number; rateDate: string }> {
  if (requests.length === 0) return {};
  const db = getDb();
  const uniqueKeys = Array.from(
    new Set(
      requests
        .map((r) => `${r.fromCurrency.trim().toUpperCase()}:${r.requestedDate.trim()}`)
        .filter((k) => !k.startsWith("EUR:") && k.includes(":"))
    )
  );
  if (uniqueKeys.length === 0) return {};

  const out: Record<string, { rateToEur: number; rateDate: string }> = {};
  const stmt = db.prepare(
    "SELECT cache_key, rate_to_eur, rate_date FROM fx_cache WHERE cache_key = ?"
  );

  for (const key of uniqueKeys) {
    const row = stmt.get(key) as unknown as
      | { cache_key: string; rate_to_eur: number; rate_date: string }
      | undefined;
    if (row && Number.isFinite(row.rate_to_eur) && row.rate_to_eur > 0) {
      out[row.cache_key] = {
        rateToEur: row.rate_to_eur,
        rateDate: row.rate_date,
      };
    }
  }
  return out;
}

export function upsertCachedHistoricalFxBatch(
  entries: Array<{
    fromCurrency: string;
    requestedDate: string;
    rateToEur: number;
    rateDate: string;
  }>
): void {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const valid = entries.filter((e) => {
    const ccy = e.fromCurrency.trim().toUpperCase();
    const reqDate = e.requestedDate.trim();
    return (
      ccy &&
      ccy !== "EUR" &&
      /^\d{4}-\d{2}-\d{2}$/.test(reqDate) &&
      reqDate < todayUtc &&
      Number.isFinite(e.rateToEur) &&
      e.rateToEur > 0
    );
  });

  if (valid.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION;");
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO fx_cache (
        cache_key, from_currency, rate_to_eur, rate_date, last_updated
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const entry of valid) {
      const ccy = entry.fromCurrency.trim().toUpperCase();
      const key = `${ccy}:${entry.requestedDate.trim()}`;
      stmt.run(key, ccy, entry.rateToEur, entry.rateDate || entry.requestedDate.trim(), now);
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}

export interface BulkTradeFxUpdateItem {
  tradeId: number;
  entryFxRateToEur?: number;
  fxRateToEur?: number;
}

export function bulkUpdateTradeFxRates(
  userId: number,
  updates: BulkTradeFxUpdateItem[]
): number {
  if (updates.length === 0) return 0;
  const db = getDb();
  const now = new Date().toISOString();
  let updatedCount = 0;

  db.exec("BEGIN TRANSACTION;");
  try {
    const selectStmt = db.prepare(
      "SELECT id, currency, entry_fx_rate_to_eur, fx_rate_to_eur FROM trades WHERE id = ? AND user_id = ?"
    );
    const updateEntryOnly = db.prepare(
      "UPDATE trades SET entry_fx_rate_to_eur = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    );
    const updateExitOnly = db.prepare(
      "UPDATE trades SET fx_rate_to_eur = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    );
    const updateBoth = db.prepare(
      "UPDATE trades SET entry_fx_rate_to_eur = ?, fx_rate_to_eur = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    );

    for (const item of updates) {
      const existing = selectStmt.get(item.tradeId, userId) as unknown as
        | {
            id: number;
            currency: string;
            entry_fx_rate_to_eur: number | null;
            fx_rate_to_eur: number;
          }
        | undefined;
      if (!existing) continue;
      if ((existing.currency || "USD").toUpperCase() === "EUR") continue;

      const hasEntry =
        item.entryFxRateToEur !== undefined &&
        Number.isFinite(item.entryFxRateToEur) &&
        item.entryFxRateToEur > 0;
      const hasExit =
        item.fxRateToEur !== undefined &&
        Number.isFinite(item.fxRateToEur) &&
        item.fxRateToEur > 0;

      if (!hasEntry && !hasExit) continue;

      if (hasEntry && hasExit) {
        updateBoth.run(
          item.entryFxRateToEur!,
          item.fxRateToEur!,
          now,
          item.tradeId,
          userId
        );
      } else if (hasEntry) {
        updateEntryOnly.run(item.entryFxRateToEur!, now, item.tradeId, userId);
      } else if (hasExit) {
        updateExitOnly.run(item.fxRateToEur!, now, item.tradeId, userId);
      }
      updatedCount++;
    }

    db.exec("COMMIT;");
    return updatedCount;
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}
