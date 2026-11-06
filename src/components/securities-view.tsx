"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  RefreshCw,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Clock,
  Globe,
  Sliders,
  X,
  Sparkles,
  ArrowUpRight,
  LineChart,
} from "lucide-react";
import type {
  SecurityRecord,
  NewSecurityInput,
  QuoteProviderType,
} from "@/lib/db/schema";
import {
  mapToYahooTicker,
  resolveTradingViewUrl,
  resolveYahooFinanceUrl,
} from "@/lib/ticker-mapper";
import { getQuoteAgeInfo } from "@/lib/quote-age";
import { YahooFinanceIcon } from "./icons";

const GICS_SECTORS = [
  "Information Technology",
  "Financials",
  "Energy",
  "Industrials",
  "Consumer Discretionary",
  "Communication Services",
  "Materials",
  "Health Care",
  "Consumer Staples",
  "Utilities",
  "Real Estate",
  "Uncategorized",
];

const CURRENCIES = ["USD", "EUR", "CAD", "SEK", "DKK", "GBP"];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  CAD: "CA$",
  SEK: "kr ",
  DKK: "kr ",
  GBP: "£",
};

interface SecuritiesViewProps {
  securities: SecurityRecord[];
  onCreateSecurity: (
    data: NewSecurityInput & { syncQuoteNow?: boolean }
  ) => Promise<void>;
  onUpdateSecurity: (
    id: number,
    data: Partial<NewSecurityInput> & { syncQuote?: boolean }
  ) => Promise<void>;
  onDeleteSecurity: (sec: SecurityRecord) => Promise<void>;
  onSyncAllSecurities: (scope: "OPEN_ONLY" | "ALL_SECURITIES") => Promise<void>;
  onNewTradeForSecurity: (sec: SecurityRecord) => void;
  isSyncingAll: boolean;
}

export function SecuritiesView({
  securities,
  onCreateSecurity,
  onUpdateSecurity,
  onDeleteSecurity,
  onSyncAllSecurities,
  onNewTradeForSecurity,
  isSyncingAll,
}: SecuritiesViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sectorFilter, setSectorFilter] = useState("ALL");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSec, setEditingSec] = useState<SecurityRecord | null>(null);

  // Modal state
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [isin, setIsin] = useState("");
  const [gicsSector, setGicsSector] = useState("Information Technology");
  const [currency, setCurrency] = useState("USD");
  const [quoteProvider, setQuoteProvider] =
    useState<QuoteProviderType>("YAHOO");
  const [latestPrice, setLatestPrice] = useState("");
  const [tradingViewUrl, setTradingViewUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [syncQuoteNow, setSyncQuoteNow] = useState(true);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filteredSecurities = useMemo(() => {
    return securities.filter((s) => {
      if (sectorFilter !== "ALL" && s.gicsSector !== sectorFilter) return false;
      if (providerFilter !== "ALL" && s.quoteProvider !== providerFilter)
        return false;
      if (searchQuery.trim() !== "") {
        const q = searchQuery.trim().toLowerCase();
        if (
          !s.ticker.toLowerCase().includes(q) &&
          !s.name.toLowerCase().includes(q) &&
          !s.gicsSector.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [securities, sectorFilter, providerFilter, searchQuery]);

  const { staleCount, staleOpenCount } = useMemo(() => {
    let stale = 0;
    let staleOpen = 0;
    for (const s of securities) {
      if (getQuoteAgeInfo(s.lastQuoteAt).isDaysOld) {
        stale++;
        if ((s.openTradeCount ?? 0) > 0) {
          staleOpen++;
        }
      }
    }
    return { staleCount: stale, staleOpenCount: staleOpen };
  }, [securities]);

  const openCreateModal = () => {
    setEditingSec(null);
    setTicker("");
    setName("");
    setIsin("");
    setGicsSector("Information Technology");
    setCurrency("USD");
    setQuoteProvider("YAHOO");
    setLatestPrice("");
    setTradingViewUrl("");
    setNotes("");
    setSyncQuoteNow(true);
    setLookupMessage(null);
    setIsModalOpen(true);
  };

  const openEditModal = (sec: SecurityRecord) => {
    setEditingSec(sec);
    setTicker(sec.ticker);
    setName(sec.name);
    setIsin(sec.isin || "");
    setGicsSector(sec.gicsSector || "Uncategorized");
    setCurrency(sec.currency || "USD");
    setQuoteProvider(sec.quoteProvider || "YAHOO");
    setLatestPrice(sec.latestPrice !== null ? String(sec.latestPrice) : "");
    setTradingViewUrl(sec.tradingViewUrl || "");
    setNotes(sec.notes || "");
    setSyncQuoteNow(false);
    setLookupMessage(null);
    setIsModalOpen(true);
  };

  const handleTickerInputChange = (val: string) => {
    setTicker(val);
    const mapped = mapToYahooTicker(val, currency);
    if (mapped.inferredCurrency) {
      setCurrency(mapped.inferredCurrency);
    }
  };

  const handleLookupOnYahoo = async () => {
    const target = ticker.trim();
    if (!target) return;
    setIsLookingUp(true);
    setLookupMessage(null);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookupSymbol: target }),
      });
      const data = await res.json();
      if (res.ok && data.lookup) {
        const info = data.lookup;
        setTicker(info.ticker || info.symbol);
        if (info.name) setName(info.name);
        if (info.gicsSector && info.gicsSector !== "Uncategorized") {
          setGicsSector(info.gicsSector);
        }
        if (info.currency) setCurrency(info.currency);
        if (info.latestPrice) setLatestPrice(String(info.latestPrice));
        setLookupMessage(
          `Found ${info.name} (${info.ticker || info.symbol}) @ ${info.currency} ${info.latestPrice}`
        );
      } else {
        setLookupMessage(
          data.error || "Could not find symbol on Yahoo Finance"
        );
      }
    } catch {
      setLookupMessage("Network error while contacting Yahoo Finance");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSyncSingle = async (sec: SecurityRecord) => {
    setSyncingId(sec.id);
    try {
      await onUpdateSecurity(sec.id, { syncQuote: true });
    } finally {
      setSyncingId(null);
    }
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const mapped = mapToYahooTicker(ticker.trim(), currency);
      const unifiedTicker = (mapped.yahooTicker || mapped.rawTicker).toUpperCase();
      const payload: NewSecurityInput = {
        ticker: unifiedTicker,
        name: name.trim() || unifiedTicker,
        isin: isin.trim() || null,
        gicsSector,
        currency,
        quoteProvider,
        latestPrice: latestPrice.trim() !== "" ? Number(latestPrice) : null,
        tradingViewUrl: tradingViewUrl.trim() || null,
        notes: notes.trim() || null,
      };

      if (editingSec) {
        await onUpdateSecurity(editingSec.id, {
          ...payload,
          syncQuote: syncQuoteNow,
        });
      } else {
        await onCreateSecurity({
          ...payload,
          syncQuoteNow,
        });
      }
      setIsModalOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Summary & Action Bar */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Securities & Quote Provider Master
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage stocks/ETFs, GICS sector classifications, and Yahoo Finance
            feed symbols connected to your trades.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {staleOpenCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800"
              title={`${staleOpenCount} open position quotes are days old and need to be refreshed`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>{staleOpenCount} Open Quotes Stale</span>
            </span>
          )}

          <button
            type="button"
            disabled={isSyncingAll}
            onClick={() => onSyncAllSecurities("OPEN_ONLY")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-blue-600 ${isSyncingAll ? "animate-spin" : ""
                }`}
            />
            <span>Sync Open Positions</span>
          </button>

          <button
            type="button"
            disabled={isSyncingAll}
            onClick={() => onSyncAllSecurities("ALL_SECURITIES")}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span>Sync All ({securities.length})</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add Security</span>
          </button>
        </div>
      </div>

      {/* Securities Table Card */}
      <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100">
          <div className="relative w-full sm:w-80 border-b border-slate-200 focus-within:border-blue-600 transition-colors pb-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-0 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search ticker, company name, or GICS sector..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent pl-6 pr-3 py-1 text-sm text-slate-800 placeholder-slate-400 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="ALL">All GICS Sectors</option>
              {GICS_SECTORS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec}
                </option>
              ))}
            </select>

            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-600"
            >
              <option value="ALL">All Providers</option>
              <option value="YAHOO">Yahoo Finance</option>
              <option value="MANUAL">Manual Price</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-y border-slate-200/80 bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3.5 pl-5 pr-3">Security</th>
                <th className="py-3.5 px-3">GICS Sector</th>
                <th className="py-3.5 px-3">Currency</th>
                <th className="py-3.5 px-3">Quote Provider</th>
                <th className="py-3.5 px-3 text-right">Latest Quote</th>
                <th className="py-3.5 px-3 text-center">Feed Status</th>
                <th className="py-3.5 px-3 text-center">Trades</th>
                <th className="py-3.5 pl-3 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSecurities.map((sec) => {
                const sym = CURRENCY_SYMBOLS[sec.currency] ?? "";
                const hasOpen = (sec.openTradeCount ?? 0) > 0;
                const ageInfo = getQuoteAgeInfo(sec.lastQuoteAt);
                const dayChangePct =
                  sec.latestPrice &&
                    sec.previousClose &&
                    sec.previousClose > 0
                    ? ((sec.latestPrice - sec.previousClose) /
                      sec.previousClose) *
                    100
                    : null;

                return (
                  <tr
                    key={sec.id}
                    className={`group transition-colors ${hasOpen
                      ? "bg-blue-50/20 hover:bg-blue-50/50"
                      : "hover:bg-slate-50/80"
                      }`}
                  >
                    {/* Security Ticker & Name */}
                    <td className="py-3 pl-5 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-blue-600 text-xs font-mono">
                          {sec.ticker}
                        </span>
                        <a
                          href={resolveTradingViewUrl(
                            sec.ticker,
                            sec.tradingViewUrl
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`p-1 rounded transition-colors ${sec.tradingViewUrl
                            ? "text-blue-600 hover:bg-blue-50"
                            : "text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                            }`}
                          title={
                            sec.tradingViewUrl
                              ? `Open saved TradingView chart (${sec.tradingViewUrl})`
                              : `Open ${sec.ticker} chart on TradingView`
                          }
                        >
                          <LineChart className="w-3.5 h-3.5" />
                        </a>
                        <a
                          href={resolveYahooFinanceUrl(sec.ticker, sec.currency)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                          title={`Open ${sec.ticker} on Yahoo Finance`}
                        >
                          <YahooFinanceIcon className="w-3.5 h-3.5" />
                        </a>
                        {hasOpen && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-100 text-blue-700">
                            {sec.openTradeCount} OPEN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 max-w-[240px] truncate">
                        {sec.name}
                      </div>
                    </td>

                    {/* GICS Sector */}
                    <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                      {sec.gicsSector}
                    </td>

                    {/* Currency */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                        {sec.currency}
                      </span>
                    </td>

                    {/* Quote Provider */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {sec.quoteProvider === "YAHOO" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-medium text-[11px]">
                          <Globe className="w-3 h-3" />
                          Yahoo Finance
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium text-[11px]">
                          <Sliders className="w-3 h-3" />
                          Manual
                        </span>
                      )}
                    </td>

                    {/* Latest Price + Day Change */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {sec.latestPrice !== null ? (
                        <div className="flex flex-col items-end">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <span className="font-semibold text-slate-900">
                              {sym}
                              {sec.latestPrice.toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                            {dayChangePct !== null && (
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${dayChangePct >= 0
                                  ? "bg-emerald-50 text-emerald-600"
                                  : "bg-rose-50 text-rose-500"
                                  }`}
                              >
                                {dayChangePct >= 0 ? "+" : ""}
                                {dayChangePct.toFixed(2)}%
                              </span>
                            )}
                          </div>
                          {ageInfo.isDaysOld ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 mt-0.5 cursor-help"
                              title={ageInfo.tooltip}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                              {ageInfo.label} (Stale)
                            </span>
                          ) : (
                            <span
                              className="text-[10px] text-slate-400 mt-0.5 inline-flex items-center gap-1 cursor-help"
                              title={ageInfo.tooltip}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              {ageInfo.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Feed Status */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      {sec.quoteStatus === "OK" ? (
                        ageInfo.isDaysOld ? (
                          <div className="inline-flex flex-col items-center">
                            <span
                              title={ageInfo.tooltip}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 cursor-help"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              Stale ({ageInfo.label})
                            </span>
                            <span className="text-[10px] text-amber-600 mt-0.5 font-medium">
                              Needs refresh
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-center">
                            <span
                              title={ageInfo.tooltip}
                              className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium cursor-help"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active
                            </span>
                            <span className="text-[10px] text-slate-400 mt-0.5">
                              {ageInfo.label}
                            </span>
                          </div>
                        )
                      ) : sec.quoteStatus === "MANUAL" ? (
                        <div className="inline-flex flex-col items-center">
                          <span
                            title={ageInfo.tooltip}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-600 font-medium cursor-help"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            Manual
                          </span>
                          <span
                            className={`text-[10px] mt-0.5 ${ageInfo.isDaysOld
                              ? "text-amber-600 font-semibold"
                              : "text-slate-400"
                              }`}
                          >
                            {ageInfo.label}
                          </span>
                        </div>
                      ) : sec.quoteStatus === "ERROR" ? (
                        <div className="flex flex-col items-center">
                          <span
                            title={sec.quoteError || "Error fetching quote"}
                            className="inline-flex items-center gap-1 text-[11px] text-rose-500 font-semibold cursor-help"
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            Error
                          </span>
                          {sec.quoteError && (
                            <span
                              title={sec.quoteError}
                              className="text-[10px] text-rose-400 font-normal max-w-[130px] truncate"
                            >
                              {sec.quoteError}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Clock className="w-3.5 h-3.5" />
                          {sec.quoteStatus}
                        </span>
                      )}
                    </td>

                    {/* Trade Count */}
                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium text-[11px]">
                        {sec.tradeCount ?? 0}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 pl-3 pr-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <a
                          href={resolveTradingViewUrl(
                            sec.ticker,
                            sec.tradingViewUrl
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          title={
                            sec.tradingViewUrl
                              ? `Open saved TradingView chart`
                              : `Open ${sec.ticker} chart on TradingView`
                          }
                        >
                          <LineChart className="w-3.5 h-3.5" />
                        </a>
                        <a
                          href={resolveYahooFinanceUrl(sec.ticker, sec.currency)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors cursor-pointer"
                          title={`Open ${sec.ticker} on Yahoo Finance`}
                        >
                          <YahooFinanceIcon className="w-3.5 h-3.5" />
                        </a>
                        {sec.quoteProvider === "YAHOO" && (
                          <button
                            type="button"
                            disabled={syncingId === sec.id}
                            onClick={() => handleSyncSingle(sec)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Sync live quote from Yahoo Finance"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${syncingId === sec.id
                                ? "animate-spin text-blue-600"
                                : ""
                                }`}
                            />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onNewTradeForSecurity(sec)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors cursor-pointer"
                          title="Log new trade for this security"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditModal(sec)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                          title="Edit Security & Quote Provider"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSecurity(sec)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete Security"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Security Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {editingSec
                    ? `Edit Security: ${editingSec.ticker}`
                    : "Add Security & Quote Feed"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure security metadata and Yahoo Finance quote provider
                  settings.
                </p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Portfolio Ticker *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. NVDA, AMS:ASML, STO:INVE-B"
                    value={ticker}
                    onChange={(e) => handleTickerInputChange(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-mono uppercase focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Company / Security Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ASML Holding N.V."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    GICS Sector
                  </label>
                  <select
                    value={gicsSector}
                    onChange={(e) => setGicsSector(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {GICS_SECTORS.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Trading Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                  >
                    {CURRENCIES.map((ccy) => (
                      <option key={ccy} value={ccy}>
                        {ccy}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    ISIN (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="US67066G1040"
                    value={isin}
                    onChange={(e) => setIsin(e.target.value.toUpperCase())}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-mono uppercase focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    TradingView Chart URL or Symbol (Optional)
                  </label>
                  {ticker.trim() && (
                    <a
                      href={resolveTradingViewUrl(ticker, tradingViewUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      <LineChart className="w-3 h-3" />
                      <span>Test Chart Link ↗</span>
                    </a>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="https://www.tradingview.com/chart/... or NASDAQ:NVDA (leave blank for auto)"
                  value={tradingViewUrl}
                  onChange={(e) => setTradingViewUrl(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-blue-600"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Paste your custom TradingView chart layout URL or symbol (e.g.{" "}
                  <code className="font-mono text-slate-600">EURONEXT:ASML</code>
                  ). If left blank, a TradingView chart link is generated automatically from the ticker.
                </p>
              </div>

              {/* Quote Provider Settings Box */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Quote Feed Settings
                    </span>
                    {ticker.trim() && (
                      <a
                        href={resolveYahooFinanceUrl(ticker, currency)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-600 hover:text-purple-700"
                        title="Open Yahoo Finance quote page"
                      >
                        <YahooFinanceIcon className="w-3 h-3" />
                        <span>Yahoo Finance ↗</span>
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={isLookingUp || !ticker.trim()}
                    onClick={handleLookupOnYahoo}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {isLookingUp
                        ? "Querying Yahoo..."
                        : "Auto-Fill from Yahoo Finance"}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Quote Provider
                    </label>
                    <select
                      value={quoteProvider}
                      onChange={(e) =>
                        setQuoteProvider(e.target.value as QuoteProviderType)
                      }
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600"
                    >
                      <option value="YAHOO">Yahoo Finance (Free)</option>
                      <option value="MANUAL">Manual Quote Only</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Latest Price ({currency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="Auto-fetched"
                      value={latestPrice}
                      onChange={(e) => setLatestPrice(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs tabular-nums text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                {lookupMessage && (
                  <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                    {lookupMessage}
                  </div>
                )}

                {quoteProvider === "YAHOO" && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={syncQuoteNow}
                      onChange={(e) => setSyncQuoteNow(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Fetch live quote immediately upon saving</span>
                  </label>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {isSaving
                    ? "Saving..."
                    : editingSec
                      ? "Save Security"
                      : "Create Security"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

