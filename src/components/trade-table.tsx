"use client";

import React, { useState, useMemo } from "react";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Edit3,
  Trash2,
  CheckCircle2,
  Circle,
  Scissors,
  CheckSquare,
  Upload,
  RotateCcw,
  Layers,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Clock,
} from "lucide-react";
import type { ComputedTrade } from "@/lib/sepa-math";
import type { SecurityRecord, QuoteProviderType } from "@/lib/db/schema";
import { getQuoteAgeInfo } from "@/lib/quote-age";
import { QuickQuoteModal } from "./quick-quote-modal";

interface TradeTableProps {
  trades: ComputedTrade[];
  securities?: SecurityRecord[];
  onToggleField: (
    trade: ComputedTrade,
    field: "stopMoved" | "trimmedAt2R"
  ) => Promise<void>;
  onEditTrade: (trade: ComputedTrade, mode?: "edit" | "close") => void;
  onDeleteTrade: (trade: ComputedTrade) => Promise<void>;
  onUpdateQuote?: (
    securityId: number,
    latestPrice: number,
    quoteProvider?: QuoteProviderType
  ) => Promise<void>;
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
  | "initialRiskPercent"
  | "tradingDaysHeld"
  | "gainLossPercent"
  | "gainLossEur"
  | "rMultiple"
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
  onDeleteTrade,
  onUpdateQuote,
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

  const [selectedQuoteTrade, setSelectedQuoteTrade] =
    useState<ComputedTrade | null>(null);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
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
              <th
                onClick={() => handleSort("ticker")}
                className="py-3.5 pl-5 pr-4 cursor-pointer hover:text-slate-900 whitespace-nowrap sticky left-0 bg-[#f8fafc] z-20 shadow-[1px_0_0_0_#e2e8f0]"
              >
                Ticker {renderSortIcon("ticker")}
              </th>
              <th
                onClick={() => handleSort("startDate")}
                className="py-3.5 px-2.5 cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Dates {renderSortIcon("startDate")}
              </th>
              <th
                onClick={() => handleSort("shares")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Shares {renderSortIcon("shares")}
              </th>
              <th
                onClick={() => handleSort("buyPrice")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Buy Price {renderSortIcon("buyPrice")}
              </th>
              <th
                onClick={() => handleSort("latestPrice")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Sell / Latest {renderSortIcon("latestPrice")}
              </th>
              <th
                onClick={() => handleSort("entryValueEur")}
                className="py-3.5 px-3 cursor-pointer hover:text-slate-900 whitespace-nowrap min-w-[150px]"
              >
                Entry Value € {renderSortIcon("entryValueEur")}
              </th>
              <th
                onClick={() => handleSort("initialRiskPercent")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Stop / Risk % {renderSortIcon("initialRiskPercent")}
              </th>
              <th
                onClick={() => handleSort("tradingDaysHeld")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Days {renderSortIcon("tradingDaysHeld")}
              </th>
              <th className="py-3.5 px-2.5 text-right whitespace-nowrap">
                Latest Value €
              </th>
              <th
                onClick={() => handleSort("gainLossPercent")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
                title="Total trade return percentage since entry: (Sell or Latest Price - Buy Price) / Buy Price"
              >
                Trade Return % {renderSortIcon("gainLossPercent")}
              </th>
              <th
                onClick={() => handleSort("gainLossEur")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                Profit / Loss € {renderSortIcon("gainLossEur")}
              </th>
              <th className="py-3.5 px-2.5 text-right whitespace-nowrap">
                Move Stop (2R)
              </th>
              <th
                onClick={() => handleSort("percentLeftBeforeMove")}
                className="py-3.5 px-2.5 text-right cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                % Left {renderSortIcon("percentLeftBeforeMove")}
              </th>
              <th className="py-3.5 px-2 text-center whitespace-nowrap">
                Stop Moved
              </th>
              <th className="py-3.5 px-2 text-center whitespace-nowrap">
                2R Trim
              </th>
              <th
                onClick={() => handleSort("rMultiple")}
                className="py-3.5 px-2.5 text-center cursor-pointer hover:text-slate-900 whitespace-nowrap"
              >
                R-Multiple {renderSortIcon("rMultiple")}
              </th>
              <th className="py-3.5 pl-2 pr-5 text-right whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {sortedTrades.length === 0 ? (
              <tr>
                <td
                  colSpan={17}
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

                return (
                  <tr
                    key={trade.id}
                    className={`group transition-colors ${isOpen
                      ? "bg-blue-50/25 hover:bg-blue-50/60"
                      : "bg-white hover:bg-slate-50/90"
                      }`}
                  >
                    {/* Two-Line Ticker + GICS Sector (Portfolio Dividend Tracker style) */}
                    <td
                      className={`py-3 pl-5 pr-4 whitespace-nowrap sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0] ${isOpen
                        ? "bg-[#f4f8fe] group-hover:bg-[#eaf1fc]"
                        : "bg-white group-hover:bg-slate-50"
                        }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-blue-600 text-xs">
                          {trade.ticker}
                        </span>
                        {trade.currency !== "USD" && (
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                            {trade.currency}
                          </span>
                        )}
                        {isOpen && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-100 text-blue-700">
                            OPEN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 max-w-[190px] truncate">
                        {trade.securityName &&
                          trade.securityName !== trade.ticker
                          ? `${trade.securityName} • ${trade.gicsSector}`
                          : trade.gicsSector}
                      </div>
                    </td>

                    {/* Start & End Date */}
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      <div className="text-slate-700 font-medium">
                        {trade.startDate}
                      </div>
                      <div className="text-[11px] mt-0.5">
                        {isOpen ? (
                          <button
                            onClick={() => onEditTrade(trade, "close")}
                            className="text-blue-600 hover:text-blue-800 font-medium underline decoration-blue-300 cursor-pointer"
                          >
                            Active → Close
                          </button>
                        ) : (
                          <span className="text-slate-400">
                            → {trade.endDate}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Shares */}
                    <td className="py-3 px-2.5 text-right text-slate-700 font-medium whitespace-nowrap">
                      {trade.shares.toLocaleString("en-US")}
                    </td>

                    {/* Buy Price */}
                    <td className="py-3 px-2.5 text-right text-slate-700 whitespace-nowrap">
                      {formatLocalPrice(trade.buyPrice, trade.currency)}
                    </td>

                    {/* Sell / Latest Price */}
                    <td className="py-3 px-2.5 text-right whitespace-nowrap">
                      {isOpen ? (
                        <div className="flex flex-col items-end">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedQuoteTrade(trade);
                                setIsQuoteModalOpen(true);
                              }}
                              className="text-blue-600 font-semibold cursor-pointer hover:underline decoration-blue-300"
                              title="Click to view quote details or update manually"
                            >
                              {formatLocalPrice(
                                trade.latestPrice,
                                trade.currency
                              )}
                            </button>
                            {dayChangePct !== null && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold tabular-nums ${dayChangePct >= 0
                                  ? "bg-emerald-50 text-emerald-600"
                                  : "bg-rose-50 text-rose-500"
                                  }`}
                                title={`Today's 1D change vs previous close (${formatLocalPrice(
                                  previousClose,
                                  trade.currency
                                )}): ${dayDiff !== null && dayDiff > 0 ? "+" : ""}${formatLocalPrice(
                                  dayDiff,
                                  trade.currency
                                )} (${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%)`}
                              >
                                {dayChangePct >= 0 ? "+" : ""}
                                {dayChangePct.toFixed(2)}% 1D
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedQuoteTrade(trade);
                                setIsQuoteModalOpen(true);
                              }}
                              className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                              title="Update quote manually"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            {isYahoo &&
                              onSyncSecurityQuote &&
                              linkedSecurity && (
                                <button
                                  type="button"
                                  disabled={
                                    syncingSecurityId === linkedSecurity.id
                                  }
                                  onClick={() =>
                                    handleSingleSyncQuote(linkedSecurity.id)
                                  }
                                  className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                                  title="Refresh quote from Yahoo Finance"
                                >
                                  <RefreshCw
                                    className={`w-3 h-3 ${syncingSecurityId === linkedSecurity.id
                                      ? "animate-spin text-blue-600"
                                      : ""
                                      }`}
                                  />
                                </button>
                              )}
                          </div>

                          {/* Recency Badge */}
                          {ageInfo.isDaysOld ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedQuoteTrade(trade);
                                setIsQuoteModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 mt-0.5 cursor-pointer hover:bg-amber-100 transition-colors"
                              title={ageInfo.tooltip}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                              <span>{ageInfo.label} (Stale)</span>
                            </button>
                          ) : trade.quoteStatus === "ERROR" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedQuoteTrade(trade);
                                setIsQuoteModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 text-[10px] text-rose-500 font-medium mt-0.5 cursor-pointer hover:underline"
                              title={trade.quoteError || "Error fetching quote"}
                            >
                              <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                              <span>Error</span>
                            </button>
                          ) : (
                            <span
                              className="text-[10px] text-slate-400 mt-0.5 inline-flex items-center gap-1 cursor-help"
                              title={ageInfo.tooltip}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <span>{ageInfo.label}</span>
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-700">
                          {formatLocalPrice(trade.latestPrice, trade.currency)}
                        </span>
                      )}
                    </td>

                    {/* Entry Value € + Relative Position Sizing Bar */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-slate-800 font-medium">
                          <span>{formatEurValue(trade.entryValueEur)}</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            {formatLocalPrice(
                              trade.entryValueLocal,
                              trade.currency
                            )}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${isOpen ? "bg-blue-500" : "bg-blue-400/70"
                              }`}
                            style={{ width: `${trade.entrySizePercentOfMax}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Initial Stop Loss & Risk % */}
                    <td className="py-3 px-2.5 text-right whitespace-nowrap">
                      <div className="text-slate-700">
                        {formatLocalPrice(
                          trade.initialStopLoss,
                          trade.currency
                        )}
                      </div>
                      <div
                        className={`text-[11px] ${trade.initialRiskPercent > 0.075
                          ? "text-amber-600 font-medium"
                          : "text-slate-400"
                          }`}
                      >
                        -{(trade.initialRiskPercent * 100).toFixed(1)}% risk
                      </div>
                    </td>

                    {/* Trading Days Held */}
                    <td className="py-3 px-2.5 text-right text-slate-600 whitespace-nowrap">
                      {trade.tradingDaysHeld}d
                    </td>

                    {/* Latest Value € */}
                    <td className="py-3 px-2.5 text-right text-slate-700 whitespace-nowrap">
                      {formatEurValue(trade.latestValueEur)}
                    </td>

                    {/* Trade Return (% since Buy Price) */}
                    <td className="py-3 px-2.5 text-right whitespace-nowrap">
                      <div
                        className="inline-flex items-center justify-end"
                        title={`Total trade return since entry at ${formatLocalPrice(
                          trade.buyPrice,
                          trade.currency
                        )}: ${trade.gainLossPercent > 0 ? "+" : ""}${(
                          trade.gainLossPercent * 100
                        ).toFixed(2)}% (${perShareDiff > 0 ? "+" : ""}${formatLocalPrice(
                          perShareDiff,
                          trade.currency
                        )}/share)`}
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
                  </div>
                    </td>

          {/* Profit / Loss € */}
          <td className="py-3 px-2.5 text-right whitespace-nowrap">
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
            <div className="text-[10px] text-slate-400">
              FX: {trade.rateToEur.toFixed(4)}
            </div>
          </td>

          {/* Move Stop At (2R Target Price) */}
          <td className="py-3 px-2.5 text-right text-slate-600 whitespace-nowrap">
            {formatLocalPrice(trade.moveStopAt, trade.currency)}
          </td>

          {/* % Left Before Move */}
          <td className="py-3 px-2.5 text-right whitespace-nowrap">
            {trade.percentLeftBeforeMove === null ? (
              <span className="text-slate-300">—</span>
            ) : (
              <span
                className={
                  trade.percentLeftBeforeMove <= 0.03
                    ? "text-amber-600 font-semibold"
                    : "text-slate-500"
                }
              >
                {(trade.percentLeftBeforeMove * 100).toFixed(2)}%
              </span>
            )}
          </td>

          {/* Stop Moved Interactive Toggle */}
          <td className="py-3 px-2 text-center whitespace-nowrap">
            <button
              type="button"
              onClick={() => onToggleField(trade, "stopMoved")}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${trade.stopMoved
                ? "bg-blue-50 text-blue-600"
                : "text-slate-300 hover:text-slate-500"
                }`}
              title="Toggle Stop Moved to Breakeven/2R"
            >
              {trade.stopMoved ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Done</span>
                </>
              ) : (
                <Circle className="w-3.5 h-3.5" />
              )}
            </button>
          </td>

          {/* Trimmed at 2R Interactive Toggle */}
          <td className="py-3 px-2 text-center whitespace-nowrap">
            <button
              type="button"
              onClick={() => onToggleField(trade, "trimmedAt2R")}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${trade.trimmedAt2R
                ? "bg-emerald-50 text-emerald-700"
                : "text-slate-300 hover:text-slate-500"
                }`}
              title="Toggle Trimmed at 2R"
            >
              {trade.trimmedAt2R ? (
                <>
                  <Scissors className="w-3 h-3 text-emerald-600" />
                  <span>Trimmed</span>
                </>
              ) : (
                <CheckSquare className="w-3.5 h-3.5" />
              )}
            </button>
          </td>

          {/* R-Multiple Pill (Styled like Dividend Safety pill on the right) */}
          <td className="py-3 px-2.5 text-center whitespace-nowrap">
            <span
              className={`inline-block min-w-[52px] px-2 py-1 rounded-md text-[11px] ${getRMultiplePillStyle(
                trade.rMultiple
              )}`}
            >
              {trade.rMultiple > 0 ? "+" : ""}
              {trade.rMultiple.toFixed(2)}R
            </span>
          </td>

          {/* Row Actions */}
          <td className="py-3 pl-2 pr-5 text-right whitespace-nowrap">
            <div className="inline-flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => onEditTrade(trade, "edit")}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Edit Trade"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteTrade(trade)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                title="Delete Trade"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </td>
        </tr>
        );
              })
            )}
      </tbody>
    </table>
      </div >

    {/* Quick Quote Update Modal */ }
    < QuickQuoteModal
  isOpen = { isQuoteModalOpen }
  onClose = {() => {
    setIsQuoteModalOpen(false);
    setSelectedQuoteTrade(null);
  }
}
trade = { selectedQuoteTrade }
security = {
  selectedQuoteTrade
  ? securities?.find(
                (s) =>
s.id === selectedQuoteTrade.securityId ||
  s.ticker === selectedQuoteTrade.ticker
              ) || null
            : null
        }
onSaveQuote = { async(secId, price, provider) => {
  if (onUpdateQuote) {
    await onUpdateQuote(secId, price, provider);
  }
}}
onSyncLiveQuote = { onSyncSecurityQuote }
  />
    </div >
  );
}
