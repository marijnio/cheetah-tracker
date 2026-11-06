"use client";

import React, { useState, useMemo } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  CheckCircle2,
  Circle,
  Scissors,
  Upload,
  RotateCcw,
  Layers,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Clock,
  LineChart,
} from "lucide-react";
import type { ComputedTrade } from "@/lib/trade-math";
import type { SecurityRecord } from "@/lib/db/schema";
import { getQuoteAgeInfo } from "@/lib/quote-age";
import { resolveTradingViewUrl, resolveYahooFinanceUrl } from "@/lib/ticker-mapper";
import { YahooFinanceIcon } from "./icons";

interface TradeTableProps {
  trades: ComputedTrade[];
  securities?: SecurityRecord[];
  onToggleField: (
    trade: ComputedTrade,
    field: "stopMoved" | "trimmedAt2R"
  ) => Promise<void>;
  onEditTrade: (trade: ComputedTrade, mode?: "edit" | "close") => void;
  onDeleteTrade?: (trade: ComputedTrade) => Promise<void>;
  onSyncSecurityQuote?: (securityId: number) => Promise<void>;
  onSyncAllOpenQuotes?: () => Promise<void>;
  isSyncingAll?: boolean;
  sectorFilter: string;
  onSectorFilterChange: (next: string) => void;
  searchQuery: string;
  onSearchQueryChange: (next: string) => void;
  sectors: string[];
  kpiScope: "GLOBAL" | "FILTERED";
  onToggleKpiScope: () => void;
  onImportCsvClick: () => void;
  onResetSampleClick: () => void;
  isImporting: boolean;
}

type SortKey =
  | "ticker"
  | "startDate"
  | "endDate"
  | "shares"
  | "buyPrice"
  | "latestPrice"
  | "entryValueEur"
  | "latestValueEur"
  | "initialRiskPercent"
  | "tradingDaysHeld"
  | "gainLossPercent"
  | "gainLossEur"
  | "rMultiple"
  | "moveStopAt"
  | "percentLeftBeforeMove";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  CAD: "CA$",
  SEK: "kr ",
  DKK: "kr ",
  GBP: "£",
};

function formatLocalPrice(val: number | null | undefined, ccy: string): string {
  if (val === null || val === undefined) return "—";
  const sym = CURRENCY_SYMBOLS[ccy] ?? "";
  return `${sym}${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatEurValue(val: number, showPlus = false): string {
  const sign = val < 0 ? "-" : showPlus && val > 0 ? "+" : "";
  const abs = Math.abs(val);
  return `${sign}€${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getRMultiplePillStyle(r: number): string {
  if (r >= 2.0) {
    return "bg-emerald-100 text-emerald-700 font-bold";
  }
  if (r > 0) {
    return "bg-emerald-50 text-emerald-600 font-semibold";
  }
  if (r === 0) {
    return "bg-slate-100 text-slate-600 font-medium";
  }
  if (r > -1.0) {
    return "bg-amber-50 text-amber-700 font-semibold";
  }
  return "bg-rose-50 text-rose-600 font-bold";
}

export function TradeTable({
  trades,
  securities,
  onToggleField,
  onEditTrade,
  onSyncSecurityQuote,
  onSyncAllOpenQuotes,
  isSyncingAll,
  sectorFilter,
  onSectorFilterChange,
  searchQuery,
  onSearchQueryChange,
  sectors,
  kpiScope,
  onToggleKpiScope,
  onImportCsvClick,
  onResetSampleClick,
  isImporting,
}: TradeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [syncingSecurityId, setSyncingSecurityId] = useState<number | null>(
    null
  );

  const staleOpenCount = useMemo(() => {
    return trades.filter((t) => {
      if (!t.isOpen) return false;
      const sec = securities?.find(
        (s) => s.id === t.securityId || s.ticker === t.ticker
      );
      const timestamp = sec?.lastQuoteAt ?? t.lastQuoteAt;
      return getQuoteAgeInfo(timestamp).isDaysOld;
    }).length;
  }, [trades, securities]);

  const handleSingleSyncQuote = async (secId: number) => {
    if (!onSyncSecurityQuote) return;
    setSyncingSecurityId(secId);
    try {
      await onSyncSecurityQuote(secId);
    } finally {
      setSyncingSecurityId(null);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "desc") {
        setSortDir("asc");
      } else {
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedTrades = useMemo(() => {
    if (!sortKey) return trades;
    return [...trades].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === "string" && typeof valB === "string") {
        return sortDir === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }

      const numA = Number(valA);
      const numB = Number(valB);
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
  }, [trades, sortKey, sortDir]);

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 inline ml-1" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-blue-600 inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-blue-600 inline ml-1" />
    );
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
      {/* Top Toolbar (Portfolio Dividend Tracker Style) */}
      <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-white">
        {/* Left: Minimal Underline Search Input */}
        <div
          data-protonpass-ignore="true"
          className="relative w-full sm:w-80 border-b border-slate-200 focus-within:border-blue-600 transition-colors pb-1"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-0 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            autoComplete="off"
            data-protonpass-ignore="true"
            data-1p-ignore="true"
            placeholder="Search holdings or sector..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full bg-transparent pl-6 pr-3 py-1 text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
          />
        </div>

        {/* Right: Outlined Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {staleOpenCount > 0 && onSyncAllOpenQuotes && (
            <button
              type="button"
              disabled={isSyncingAll}
              onClick={onSyncAllOpenQuotes}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
              title={`${staleOpenCount} open position quotes are days old. Click to refresh all open quotes.`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>
                {staleOpenCount} Stale Quote{staleOpenCount > 1 ? "s" : ""}
              </span>
              <RefreshCw
                className={`w-3 h-3 text-amber-700 ml-0.5 ${isSyncingAll ? "animate-spin" : ""
                  }`}
              />
            </button>
          )}

          <select
            value={sectorFilter}
            onChange={(e) => onSectorFilterChange(e.target.value)}
            className="bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
          >
            <option value="ALL">All GICS Sectors</option>
            {sectors.map((sec) => (
              <option key={sec} value={sec}>
                {sec}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onToggleKpiScope}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>
              KPIs: {kpiScope === "GLOBAL" ? "All Trades" : "Filtered"}
            </span>
          </button>

          <button
            type="button"
            disabled={isImporting}
            onClick={onImportCsvClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            <span>Import CSV</span>
          </button>

          <button
            type="button"
            disabled={isImporting}
            onClick={onResetSampleClick}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
            title="Reset ledger to sample CSV"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Reload Sample</span>
          </button>
        </div>
      </div>

      {/* High-Density Data Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs tabular-nums">
          <thead>
            <tr className="border-y border-slate-200/80 bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wider text-slate-500 select-none">
              {/* 1. Ticker */}
              <th
                onClick={() => handleSort("ticker")}
                className="py-3.5 pl-4 pr-3 cursor-pointer hover:text-slate-900 whitespace-nowrap sticky left-0 bg-[#f8fafc] z-20 shadow-[1px_0_0_0_#e2e8f0]"
              >
                Ticker {renderSortIcon("ticker")}
              </th>

              {/* 2. Timeline / Days Held */}
              <th className="py-3.5 px-3 whitespace-nowrap">
                <span
                  onClick={() => handleSort("startDate")}
                  className="cursor-pointer hover:text-slate-900"
                  title="Sort by Entry Date"
                >
                  Timeline {renderSortIcon("startDate")}
                </span>
                <span className="text-slate-300 mx-1">/</span>
                <span
                  onClick={() => handleSort("tradingDaysHeld")}
                  className="cursor-pointer hover:text-slate-900"
                  title="Sort by Trading Days Held"
                >
                  Days {renderSortIcon("tradingDaysHeld")}
                </span>
              </th>

              {/* 3. Entry & Initial Stop (Risk %) */}
              <th className="py-3.5 px-3 text-right whitespace-nowrap border-l border-slate-200/60">
                <span
                  onClick={() => handleSort("buyPrice")}
                  className="cursor-pointer hover:text-slate-900"
                  title="Sort by Buy Price"
                >
                  Buy {renderSortIcon("buyPrice")}
                </span>
                <span className="text-slate-300 mx-1">/</span>
                <span
                  onClick={() => handleSort("initialRiskPercent")}
                  className="cursor-pointer hover:text-slate-900"
                  title="Sort by Initial Stop Risk %"
                >
                  Stop Risk {renderSortIcon("initialRiskPercent")}
                </span>
              </th>

              {/* 4. Latest Price (Exit price for closed trades) */}
              <th
                onClick={() => handleSort("latestPrice")}
                className="py-3.5 px-3 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                title="Latest market price for open trades, exit price for closed trades"
              >
                Latest Price {renderSortIcon("latestPrice")}
              </th>

              {/* 4b. 1D Change */}
              <th
                className="py-3.5 px-3 text-right whitespace-nowrap"
                title="Today's change vs previous close (open trades only)"
              >
                1D Change
              </th>

              {/* 5. R-Multiple */}
              <th
                onClick={() => handleSort("rMultiple")}
                className="py-3.5 px-3 text-center cursor-pointer hover:text-slate-900 whitespace-nowrap border-l border-slate-200/60"
                title="Reward-to-Risk Multiple: Trade Return % / Initial Risk %"
              >
                R-Multiple {renderSortIcon("rMultiple")}
              </th>

              {/* 6. Trade Return % */}
              <th
                onClick={() => handleSort("gainLossPercent")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                title="Total trade return percentage since entry: (Sell or Latest Price - Buy Price) / Buy Price"
              >
                Return % {renderSortIcon("gainLossPercent")}
              </th>

              {/* 7. Profit / Loss € */}
              <th
                onClick={() => handleSort("gainLossEur")}
                className="py-3.5 px-3 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                P&amp;L € {renderSortIcon("gainLossEur")}
              </th>

                {/* 8. 2R Target & Discipline Rules */}
                <th className="py-3.5 px-3 whitespace-nowrap border-l border-slate-200/60 min-w-[130px]">
                  <div className="flex items-center justify-between gap-1.5">
                    <span
                      onClick={() => handleSort("moveStopAt")}
                      className="cursor-pointer hover:text-slate-900"
                      title="Sort by 2R Target Price: Buy Price × (1 + 2 × Initial Risk %)"
                    >
                      2R Target {renderSortIcon("moveStopAt")}
                    </span>
                    <span
                      onClick={() => handleSort("percentLeftBeforeMove")}
                      className="cursor-pointer hover:text-slate-900 text-[10px] text-slate-400 font-normal hover:text-slate-700"
                      title="Sort by % Distance Left to 2R"
                    >
                      % Left {renderSortIcon("percentLeftBeforeMove")}
                    </span>
                  </div>
                </th>

                {/* 10. Position Size (Entry € / Latest € / Shares) */}
                <th className="py-3.5 pl-3 pr-5 whitespace-nowrap border-l border-slate-200/60 min-w-[165px]">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      onClick={() => handleSort("entryValueEur")}
                      className="cursor-pointer hover:text-slate-900"
                      title="Sort by Entry Value (€)"
                    >
                      Size € {renderSortIcon("entryValueEur")}
                    </span>
                    <span className="text-[10px] font-medium text-slate-400">
                      <span
                        onClick={() => handleSort("latestValueEur")}
                        className="cursor-pointer hover:text-slate-800"
                        title="Sort by Latest/Exit Value (€)"
                      >
                        Now {renderSortIcon("latestValueEur")}
                      </span>
                      <span className="text-slate-300 mx-0.5">•</span>
                      <span
                        onClick={() => handleSort("shares")}
                        className="cursor-pointer hover:text-slate-800"
                        title="Sort by Shares"
                      >
                        Shs {renderSortIcon("shares")}
                      </span>
                    </span>
                  </div>
                </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sortedTrades.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="py-12 text-center text-slate-400 text-sm"
                >
                  No trades match the current filters.
                </td>
              </tr>
            ) : (
              sortedTrades.map((trade) => {
                const isWinner = trade.gainLossPercent > 0;
                const isOpen = trade.isOpen;
                const perShareDiff = trade.latestPrice - trade.buyPrice;

                const linkedSecurity =
                  securities?.find(
                    (s) =>
                      s.id === trade.securityId || s.ticker === trade.ticker
                  ) || null;
                const quoteTimestamp =
                  linkedSecurity?.lastQuoteAt ?? trade.lastQuoteAt;
                const ageInfo = getQuoteAgeInfo(quoteTimestamp);
                const isYahoo =
                  (linkedSecurity?.quoteProvider ??
                    trade.quoteProvider ??
                    "YAHOO") === "YAHOO";
                const customTvUrl =
                  linkedSecurity?.tradingViewUrl ??
                  trade.tradingViewUrl ??
                  null;
                const tvChartUrl = resolveTradingViewUrl(
                  trade.ticker,
                  customTvUrl
                );
                const yahooFinanceUrl = resolveYahooFinanceUrl(
                  linkedSecurity?.ticker ?? trade.ticker,
                  linkedSecurity?.currency ?? trade.currency
                );

                const previousClose =
                  linkedSecurity?.previousClose ?? trade.previousClose ?? null;
                const dayDiff =
                  previousClose && previousClose > 0
                    ? trade.latestPrice - previousClose
                    : null;
                const dayChangePct =
                  dayDiff !== null && previousClose && previousClose > 0
                    ? (dayDiff / previousClose) * 100
                    : null;

                const hasReached2R = trade.latestPrice >= trade.moveStopAt;
                const isNear2R =
                  trade.percentLeftBeforeMove !== null &&
                  trade.percentLeftBeforeMove <= 0.03;
                const needsStopAction =
                  isOpen && !trade.stopMoved && hasReached2R;

                return (
                  <tr
                    key={trade.id}
                    className={`group transition-colors ${isOpen
                      ? "bg-blue-50/20 hover:bg-blue-50/55"
                      : "bg-white hover:bg-slate-50/90"
                      }`}
                  >
                    {/* 1. Sticky Two-Line Ticker + GICS Sector */}
                    <td
                      onClick={() => onEditTrade(trade, "edit")}
                      title="Click to edit trade"
                      className={`py-3 pl-4 pr-3 whitespace-nowrap sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0] cursor-pointer group/ticker ${isOpen
                        ? "bg-[#f5f9ff] group-hover:bg-[#ebf3fe]"
                        : "bg-white group-hover:bg-slate-50"
                        }`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-blue-600 group-hover/ticker:text-blue-700 group-hover/ticker:underline decoration-blue-300 text-xs">
                              {trade.ticker}
                            </span>
                            {trade.currency !== "USD" && (
                              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                                {trade.currency}
                              </span>
                            )}
                            {isOpen && (
                              <span className="text-[9px] font-semibold px-1 py-0.2 rounded bg-blue-100 text-blue-700">
                                OPEN
                              </span>
                            )}
                          </div>
                          <div
                            className="text-[11px] text-slate-500 mt-0.5 max-w-[150px] truncate"
                            title={
                              trade.securityName &&
                                trade.securityName !== trade.ticker
                                ? `${trade.securityName} • ${trade.gicsSector}`
                                : trade.gicsSector
                            }
                          >
                            {trade.securityName &&
                              trade.securityName !== trade.ticker
                              ? `${trade.securityName} • ${trade.gicsSector}`
                              : trade.gicsSector}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <a
                            href={tvChartUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className={`p-1 rounded transition-all cursor-pointer ${customTvUrl
                              ? "text-blue-600 hover:bg-blue-50/90"
                              : "text-slate-400 hover:text-blue-600 hover:bg-blue-50/80"
                              }`}
                            title={
                              customTvUrl
                                ? `Open saved TradingView chart (${customTvUrl})`
                                : `Open ${trade.ticker} chart on TradingView`
                            }
                          >
                            <LineChart className="w-3.5 h-3.5" />
                          </a>
                          <a
                            href={yahooFinanceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 rounded text-slate-400 hover:text-purple-600 hover:bg-purple-50/80 transition-all cursor-pointer"
                            title={`Open ${trade.ticker} on Yahoo Finance`}
                          >
                            <YahooFinanceIcon className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </td>

                    {/* 2. Timeline (Dates + Trading Days Held) */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                        <span>{trade.startDate}</span>
                        {!isOpen && trade.endDate && (
                          <span className="text-slate-400 font-normal text-[11px]">
                            → {trade.endDate}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-medium text-[10px]">
                          <Clock className="w-2.5 h-2.5 text-slate-400" />
                          {trade.tradingDaysHeld}d
                        </span>
                        {isOpen && (
                          <button
                            onClick={() => onEditTrade(trade, "close")}
                            className="text-blue-600 hover:text-blue-800 font-medium underline decoration-blue-300 cursor-pointer text-[11px]"
                          >
                            Active → Close
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 3. Entry Price & Initial Stop (Risk %) */}
                    <td className="py-3 px-3 text-right whitespace-nowrap border-l border-slate-100">
                      <div className="text-slate-800 font-medium">
                        {formatLocalPrice(trade.buyPrice, trade.currency)}
                      </div>
                      <div className="text-[11px] mt-0.5 flex items-center justify-end gap-1">
                        <span
                          className="text-slate-400"
                          title="Initial Stop Loss Price"
                        >
                          Stop{" "}
                          {formatLocalPrice(
                            trade.initialStopLoss,
                            trade.currency
                          )}
                        </span>
                        <span className="text-slate-300">•</span>
                        <span
                          className={
                            trade.initialRiskPercent > 0.075
                              ? "text-amber-600 font-semibold"
                              : "text-slate-500"
                          }
                          title={
                            trade.initialRiskPercent > 0.075
                              ? "Exceeds Minervini's 7.5%–8.0% maximum initial stop rule"
                              : "Initial risk % from buy price to stop loss"
                          }
                        >
                          -{(trade.initialRiskPercent * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    {/* 4. Latest / Exit Price */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {(() => {
                        const canSync =
                          isOpen &&
                          isYahoo &&
                          !!onSyncSecurityQuote &&
                          !!linkedSecurity;
                        const isSyncingRow =
                          !!linkedSecurity &&
                          syncingSecurityId === linkedSecurity.id;
                        const isError =
                          isOpen && trade.quoteStatus === "ERROR";
                        const isStale = isOpen && !isError && ageInfo.isDaysOld;

                        const dotClass = !isOpen
                          ? "bg-slate-300"
                          : isError
                            ? "bg-rose-500"
                            : isStale
                              ? "bg-amber-500"
                              : "bg-emerald-500";

                        const statusLabel = !isOpen
                          ? "Exit"
                          : isSyncingRow
                            ? "Syncing…"
                            : isError
                              ? "Quote error"
                              : ageInfo.label;

                        const statusTitle = !isOpen
                          ? `Exit price on ${trade.endDate ?? "close"}`
                          : isError
                            ? `${trade.quoteError || "Error fetching quote"}${canSync ? " — click to retry" : ""}`
                            : `${ageInfo.tooltip}${canSync ? " — click to refresh" : ""}`;

                        const statusContent = (
                          <>
                            {isSyncingRow ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin text-blue-500" />
                            ) : (
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`}
                              />
                            )}
                            <span>{statusLabel}</span>
                            {canSync && !isSyncingRow && (
                              <RefreshCw className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                            )}
                          </>
                        );

                        const statusClass = `inline-flex items-center gap-1 ${isError
                          ? "text-rose-500"
                          : isStale
                            ? "text-amber-600"
                            : "text-slate-400"
                          }`;

                        return (
                          <div className="flex flex-col items-end">
                            <span
                              className={`font-semibold tabular-nums ${isOpen ? "text-slate-900" : "text-slate-700"
                                }`}
                            >
                              {formatLocalPrice(
                                trade.latestPrice,
                                trade.currency
                              )}
                            </span>
                            <div className="flex items-center justify-end text-[10px] mt-0.5">
                              {canSync ? (
                                <button
                                  type="button"
                                  disabled={isSyncingRow}
                                  onClick={() =>
                                    handleSingleSyncQuote(linkedSecurity!.id)
                                  }
                                  className={`${statusClass} cursor-pointer hover:text-blue-600 disabled:cursor-wait`}
                                  title={statusTitle}
                                >
                                  {statusContent}
                                </button>
                              ) : (
                                <span
                                  className={`${statusClass} cursor-help`}
                                  title={statusTitle}
                                >
                                  {statusContent}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </td>

                    {/* 4b. 1D Change */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {isOpen && dayChangePct !== null ? (
                        <div
                          className="flex flex-col items-end"
                          title={`1D change vs previous close (${formatLocalPrice(
                            previousClose,
                            trade.currency
                          )})`}
                        >
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums ${dayChangePct >= 0
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-rose-50 text-rose-500"
                              }`}
                          >
                            {dayChangePct >= 0 ? "+" : ""}
                            {dayChangePct.toFixed(2)}%
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                            {dayDiff !== null && dayDiff > 0 ? "+" : ""}
                            {formatLocalPrice(dayDiff, trade.currency)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* 5. R-Multiple Pill (Primary Minervini Performance Metric) */}
                    < td className="py-3 px-3 text-center whitespace-nowrap border-l border-slate-100" >
                      <div className="flex flex-col items-center gap-0.5">
                        <span
                          className={`inline-block min-w-[54px] px-2 py-0.5 rounded-md text-[11px] ${getRMultiplePillStyle(
                            trade.rMultiple
                          )}`}
                        >
                          {trade.rMultiple > 0 ? "+" : ""}
                          {trade.rMultiple.toFixed(2)}R
                        </span>
                        {isOpen && trade.stopMoved && (
                          <span
                            className="text-[9px] font-semibold uppercase tracking-wide text-blue-600/80"
                            title="Stop moved to breakeven — initial capital risk removed"
                          >
                            Free Roll
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 6. Trade Return % (+ Per-Share Delta) */}
                    <td className="py-3 px-2.5 text-right whitespace-nowrap">
                      <div
                        className="flex flex-col items-end"
                        title={`Total trade return since entry at ${formatLocalPrice(
                          trade.buyPrice,
                          trade.currency
                        )}: ${trade.gainLossPercent > 0 ? "+" : ""}${(
                          trade.gainLossPercent * 100
                        ).toFixed(2)}% (${perShareDiff > 0 ? "+" : ""
                          }${formatLocalPrice(perShareDiff, trade.currency)}/share)`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums ${isWinner
                            ? "bg-emerald-50 text-emerald-600"
                            : trade.gainLossPercent < 0
                              ? "bg-rose-50 text-rose-500"
                              : "bg-slate-100 text-slate-600"
                            }`}
                        >
                          {trade.gainLossPercent > 0 ? "+" : ""}
                          {(trade.gainLossPercent * 100).toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-slate-400 mt-0.5">
                          {perShareDiff > 0 ? "+" : ""}
                          {formatLocalPrice(perShareDiff, trade.currency)}/sh
                        </span>
                      </div>
                    </td>

                    {/* 7. Profit / Loss € */}
                    <td
                      className="py-3 px-3 text-right whitespace-nowrap"
                      title={
                        trade.currency === "EUR"
                          ? "EUR Base Currency (FX = 1.0000)"
                          : `Entry (${trade.startDate}): ${formatEurValue(
                            trade.entryValueEur
                          )} @ FX ${trade.entryRateToEur.toFixed(4)}\n${isOpen ? "Latest (Live)" : `Exit (${trade.endDate})`
                          }: ${formatEurValue(
                            trade.latestValueEur
                          )} @ FX ${trade.rateToEur.toFixed(4)}`
                      }
                    >
                      <div
                        className={`font-semibold ${trade.gainLossEur > 0
                          ? "text-emerald-600"
                          : trade.gainLossEur < 0
                            ? "text-rose-500"
                            : "text-slate-500"
                          }`}
                      >
                        {formatEurValue(trade.gainLossEur, true)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {trade.currency === "EUR"
                          ? "FX: 1.0000"
                          : Math.abs(trade.entryRateToEur - trade.rateToEur) >=
                            0.00005
                            ? `FX: ${trade.entryRateToEur.toFixed(4)} → ${trade.rateToEur.toFixed(4)}`
                            : `FX: ${trade.rateToEur.toFixed(4)}`}
                      </div>
                    </td>

                          {/* 8. 2R Target Price & Rules */ }
                          < td className="py-2.5 px-3 whitespace-nowrap border-l border-slate-100">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className="text-slate-700 font-medium tabular-nums"
                              title="2R Target Price: Buy Price × (1 + 2 × Initial Risk %)"
                            >
                              {formatLocalPrice(trade.moveStopAt, trade.currency)}
                            </span>
                              {trade.percentLeftBeforeMove !== null && isOpen ? (
                                <span
                                  className={`text-[10px] font-medium tabular-nums ${isNear2R
                                      ? "text-amber-600 font-semibold"
                                      : "text-slate-400"
                                    }`}
                                  title="Percentage gain needed from current price to reach 2R"
                                >
                                  {(trade.percentLeftBeforeMove * 100).toFixed(1)}% left
                                </span>
                              ) : hasReached2R ? (
                                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200/60">
                                  ✓ 2R Hit
                                </span>
                              ) : !isOpen ? (
                                <span className="text-[10px] text-slate-400">Exit &lt; 2R</span>
                              ) : (
                                <span className="text-slate-300 text-[10px]">—</span>
                              )}
                          </div>

                              < div className="flex items-center justify-between gap-1.5">
                            <button
                              type="button"
                              onClick={() => onToggleField(trade, "stopMoved")}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border ${trade.stopMoved
                                  ? "bg-blue-50 text-blue-700 border-blue-200/80"
                                  : needsStopAction
                                    ? "bg-amber-100 text-amber-800 border-amber-300 font-semibold animate-pulse"
                                    : "bg-slate-50/70 text-slate-400 border-slate-200/60 hover:text-slate-600 hover:bg-slate-100"
                                }`}
                                title={
                                  needsStopAction
                                    ? "2R reached! Click to mark Stop Moved to Breakeven"
                                    : trade.stopMoved
                                      ? "Stop moved to breakeven (initial risk removed)"
                                      : "Toggle Stop Moved to Breakeven"
                                }
                              >
                                {trade.stopMoved ? (
                                  <CheckCircle2 className="w-2.5 h-2.5 text-blue-600 shrink-0" />
                                ) : needsStopAction ? (
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                                ) : (
                                  <Circle className="w-2.5 h-2.5 shrink-0" />
                                )}
                                <span>Stop</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onToggleField(trade, "trimmedAt2R")}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border ${trade.trimmedAt2R
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                                  : "bg-slate-50/70 text-slate-400 border-slate-200/60 hover:text-slate-600 hover:bg-slate-100"
                                }`}
                              title={
                                trade.trimmedAt2R
                                  ? "Trimmed at 2R target"
                                  : "Toggle Trimmed at 2R"
                              }
                            >
                              <Scissors
                                className={`w-2.5 h-2.5 shrink-0 ${trade.trimmedAt2R ? "text-emerald-600" : ""
                                  }`}
                                />
                            <span>2R Trim</span>
                          </button>
                      </div>
                    </div>
                  </td>

                        {/* 10. Position Size € (Entry €, Latest €, Shares + Muted Sizing Bar) */ }
                <td className="py-3 pl-3 pr-5 whitespace-nowrap border-l border-slate-100">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="text-slate-800 font-medium"
                        title={`Entry Value: ${formatEurValue(
                          trade.entryValueEur
                        )} (${formatLocalPrice(
                          trade.entryValueLocal,
                          trade.currency
                        )})`}
                      >
                        {formatEurValue(trade.entryValueEur)}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        {trade.shares.toLocaleString("en-US")} shs
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span title="Latest / Exit Value in EUR">
                        Now: {formatEurValue(trade.latestValueEur)}
                      </span>
                      {trade.currency !== "EUR" && (
                        <span>
                          {formatLocalPrice(
                            trade.entryValueLocal,
                            trade.currency
                          )}
                        </span>
                      )}
                    </div>
                    <div
                      className="w-full h-1 bg-slate-100 rounded-full overflow-hidden"
                      title={`Relative entry position size (${Math.round(
                        trade.entrySizePercentOfMax
                      )}% of largest trade)`}
                    >
                      <div
                        className="h-full rounded-full bg-slate-300/90 group-hover:bg-slate-400 transition-colors"
                        style={{ width: `${trade.entrySizePercentOfMax}%` }}
                      />
                    </div>
                  </div>
                </td>
                  </tr>
          );
              })
            )}
        </tbody>
      </table>
    </div>
    </div >
  );
}
