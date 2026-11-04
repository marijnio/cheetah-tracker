# Trade Tracker

A modern, self-hosted web application for active traders to manage their portfolio, track trade execution performance, and enforce risk discipline with automated market data feeds.

Designed with a clean, light-mode interface inspired by *Portfolio Performance* and *Portfolio Dividend Tracker*, featuring top-level KPI dashboard metrics, a high-density interactive trade ledger, and dedicated master entities for securities and forex pairs.

![Trade Tracker Banner](public/logo.svg)

---

## Key Features

### 1. Portfolio Performance Entity Architecture
* **Securities Master Repository:** Centralized registry for all traded equities and ETFs. Configure company names, GICS sector classifications, native trading currencies, and quote feed parameters.
* **Forex Listings & Currency Management:** Manage exchange rates relative to your base portfolio currency (EUR). Supports `USD`, `CAD`, `SEK`, `DKK`, `GBP`, `CHF`, and more.
* **Connected Trade Ledger:** Trades link directly to their parent security. Adding or closing trades automatically inherits verified ticker metadata, currency rates, and current quotes.

### 2. Market Data & Forex Engine (Zero API Keys Required)
* **Free Stock Quotes via Yahoo Finance:** Automatically queries Yahoo Finance (`v8` chart API with automatic host rotation and rate-limit pacing) for live prices, previous closes, and daily percentage changes.
* **Automated Ticker Mapping:** Translates exchange prefixes into Yahoo Finance suffixes (e.g. `AMS:ASML` → `ASML.AS`, `STO:INVE-B` → `INVE-B.ST`, `TSE:CNQ` → `CNQ.TO`, `VWS` → `VWS.CO`).
* **Official ECB Historical Rates via Frankfurter API:** Free, keyless European Central Bank rate lookups to lock in `Rate to € at End` whenever a trade is closed.
* **Smart Local Caching:** Live updates are isolated to open positions and manual sync triggers. Closed historical trades remain permanently locked to preserve accounting integrity.

### 3. Execution & Risk Metrics
* **R-Multiple Heatmaps:** Automatically calculates risk-adjusted return multiples ($R = \frac{\text{Gain/Loss \%}}{\text{Initial Risk \%}}$) rendered with color-coded badges.
* **Visual Position Sizing:** Inline relative sizing bars scaled against max portfolio entry exposure.
* **2R Target & Trail Stop Tracking:** Tracks target price levels (`Buy Price + 2 × Initial Risk`) and calculates `% Left Before Move`. Includes interactive toggles for `Stop Moved (Done)` and `2R Trim (Trimmed)`.
* **Top-Level KPI Cards:** Summary cards displaying:
  * Total Trades, Closed Count, and Active Positions
  * Win Rate (%) with visual distribution
  * Average Win (%) vs. Average Loss (%) and Average Win/Loss $R$
  * Gain/Loss Ratio ($\frac{\text{Avg Win \%}}{|\text{Avg Loss \%}|}$)
  * Total Gain/Loss in Base Currency (€) and Local Currency ($)
  * Mathematical Expectancy ($(\text{Win Rate} \times \text{Avg Win}) - (\text{Loss Rate} \times |\text{Avg Loss}|)$)
  * Active capital at risk and open portfolio exposure

### 4. Self-Hosting & Synology NAS Ready
* **Single-Container Architecture:** Built with Next.js (App Router, React 19) and Node's native `DatabaseSync` SQLite engine running in WAL mode.
* **Zero C++ Build Toolchains:** Eliminates fragile native compilation dependencies (`node-gyp`, Python, C++ headers) on NAS environments.
* **Persistent Local Storage:** The entire database resides in a single `./data/sepa-tracker.db` file, ideal for Docker volume mapping and automated Synology Hyper Backup.

---

## Tech Stack

* **Framework:** [Next.js](https://nextjs.org/) (App Router, TypeScript)
* **Database:** Native SQLite (`node:sqlite` in WAL mode)
* **Styling:** [Tailwind CSS](https://tailwindcss.com/)
* **Icons:** [Lucide React](https://lucide.dev/)
* **CSV Engine:** [PapaParse](https://www.papaparse.com/)
* **Market Feeds:** Yahoo Finance API + [Frankfurter API](https://api.frankfurter.dev) (ECB)

---

## Getting Started

### Prerequisites
* Node.js v22 or higher (recommended: Node.js 22 LTS or Node.js 26)
* npm, pnpm, or yarn

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/cheetah-tracker.git
   cd cheetah-tracker
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```

4. **Open the application:**
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

> **Note on First Launch:** The database will automatically initialize at `./data/sepa-tracker.db` and seed existing trade history and securities from `sample-data/`.

---

## Navigation & Workflows

* **Cash Balance & Total Account Value:** Click **Edit Cash** (or the **Cash** button) in the header to enter your current uninvested cash balance from your broker. Cheetah Tracker automatically combines your exact cash balance with your live open positions (money in trades) to determine your Total Account Value, portfolio cash percentage, and risk-first position sizing limits.
* **Trade Ledger:** Filter trades by **Summary (All)**, **Open Positions**, **Closed Trades**, or **2R Trimmed**. Use the search bar to filter by holding name or sector, and click column headers to sort.
* **Securities Master:** Add and edit stocks, ETF feeds, and manual price overrides. Click the sync icon on any row to fetch the latest market quotes.
* **Forex & Currencies:** Inspect exchange rates, configure live quote symbols, or use the built-in **Historical ECB Exchange Rate Lookup** tool.
* **Logging a Trade:** Click **Add Trade** and select any registered security from the master repository to automatically populate prices, currency, and risk limits.
* **Closing a Trade:** Click **Active → Close** on any open position to record the sell price and fetch the official ECB exchange rate for that exit date.

---

## Project Structure

```text
cheetah-tracker/
├── public/
│   ├── favicon.svg             # Application browser favicon
│   └── logo.svg                # Vector brand logo
├── sample-data/
│   └── SEPA Trading Performance Tracker - Trades.csv
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── forex/          # Forex pair CRUD & quote endpoints
│   │   │   ├── quotes/sync/    # Batch quote & ECB historical sync engine
│   │   │   ├── securities/     # Securities master repository API
│   │   │   └── trades/         # Trade ledger CRUD & CSV import
│   │   ├── globals.css         # Tailwind & theme styles
│   │   ├── layout.tsx          # Root HTML layout with favicon & title
│   │   └── page.tsx            # Server-rendered entry point
│   ├── components/
│   │   ├── dashboard-client.tsx# App shell, collapsible sidebar, and state
│   │   ├── forex-view.tsx      # Currency pairs & historical ECB lookup UI
│   │   ├── kpi-cards.tsx       # Top-level performance metric cards
│   │   ├── securities-view.tsx # Securities master management table & dialog
│   │   ├── trade-modal.tsx     # Add, edit, and close position dialog
│   │   └── trade-table.tsx     # High-density interactive ledger table
│   └── lib/
│       ├── csv-parser.ts       # CSV importer & anomaly healing
│       ├── db/                 # SQLite connection, DDL, and repositories
│       ├── quote-provider.ts   # Yahoo Finance & Frankfurter API clients
│       ├── sepa-math.ts        # Pure domain math & risk metrics
│       └── ticker-mapper.ts    # Exchange prefix-to-suffix translator
├── data/                       # Local SQLite storage (git-ignored)
├── package.json
└── tsconfig.json
```

---

## Production Build

To build the standalone optimized production package:

```bash
npm run build
npm start
```
