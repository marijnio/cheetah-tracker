"use client";

import React, { useState } from "react";
import {
  RefreshCw,
  Plus,
  Edit3,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Calendar,
  X,
  ArrowRightLeft,
} from "lucide-react";
import type {
  ForexPairRecord,
  NewForexPairInput,
  FxProviderType,
} from "@/lib/db/schema";
import { resolveYahooFinanceUrl } from "@/lib/ticker-mapper";
import { YahooFinanceIcon } from "./icons";

interface ForexViewProps {
  forexPairs: ForexPairRecord[];
  onCreateForex: (
    data: NewForexPairInput & { syncNow?: boolean }
  ) => Promise<void>;
  onUpdateForex: (
    id: number,
    data: Partial<NewForexPairInput> & { syncNow?: boolean }
  ) => Promise<void>;
  onDeleteForex: (pair: ForexPairRecord) => Promise<void>;
  onSyncAllForex: () => Promise<void>;
  isSyncingAll: boolean;
}

export function ForexView({
  forexPairs,
  onCreateForex,
  onUpdateForex,
  onDeleteForex,
  onSyncAllForex,
  isSyncingAll,
}: ForexViewProps) {
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPair, setEditingPair] = useState<ForexPairRecord | null>(null);

  // Modal state
  const [fromCurrency, setFromCurrency] = useState("USD");
  const [liveProvider, setLiveProvider] = useState<FxProviderType>("YAHOO");
  const [yahooSymbol, setYahooSymbol] = useState("USDEUR=X");
  const [historicalProvider, setHistoricalProvider] =
    useState<FxProviderType>("FRANKFURTER");
  const [latestRate, setLatestRate] = useState("0.89338");
  const [syncNow, setSyncNow] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Historical ECB Lookup Tool state
  const [histCurrency, setHistCurrency] = useState("USD");
  const [histDate, setHistDate] = useState("2026-09-28");
  const [histResult, setHistResult] = useState<number | null>(null);
  const [isFetchingHist, setIsFetchingHist] = useState(false);

  const openCreateModal = () => {
    setEditingPair(null);
    setFromCurrency("CHF");
    setLiveProvider("YAHOO");
    setYahooSymbol("CHFEUR=X");
    setHistoricalProvider("FRANKFURTER");
    setLatestRate("1.06");
    setSyncNow(true);
    setIsModalOpen(true);
  };

  const openEditModal = (pair: ForexPairRecord) => {
    setEditingPair(pair);
    setFromCurrency(pair.fromCurrency);
    setLiveProvider(pair.liveProvider);
    setYahooSymbol(pair.yahooSymbol);
    setHistoricalProvider(pair.historicalProvider);
    setLatestRate(String(pair.latestRate));
    setSyncNow(false);
    setIsModalOpen(true);
  };

  const handleFromCurrencyChange = (val: string) => {
    const clean = val.toUpperCase();
    setFromCurrency(clean);
    setYahooSymbol(`${clean}EUR=X`);
  };

  const handleSyncSingle = async (pair: ForexPairRecord) => {
    setSyncingId(pair.id);
    try {
      await onUpdateForex(pair.id, { syncNow: true });
    } finally {
      setSyncingId(null);
    }
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload: NewForexPairInput = {
        fromCurrency: fromCurrency.trim().toUpperCase(),
        toCurrency: "EUR",
        liveProvider,
        yahooSymbol:
          yahooSymbol.trim().toUpperCase() ||
          `${fromCurrency.trim().toUpperCase()}EUR=X`,
        historicalProvider,
        latestRate: Number(latestRate) || 1.0,
      };

      if (editingPair) {
        await onUpdateForex(editingPair.id, {
          ...payload,
          syncNow,
        });
      } else {
        await onCreateForex({
          ...payload,
          syncNow,
        });
      }
      setIsModalOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLookupHistoricalEcb = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsFetchingHist(true);
    setHistResult(null);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookupHistoricalFx: { fromCurrency: histCurrency, date: histDate },
        }),
      });
      const data = await res.json();
      if (res.ok && data.rateToEur) {
        setHistResult(data.rateToEur);
      }
    } finally {
      setIsFetchingHist(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Forex Listings & Quote Providers (EUR Base)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure live Yahoo Finance FX symbols (e.g.{" "}
            <code className="text-blue-600">USDEUR=X</code>) for open positions
            and Frankfurter (ECB) for historical trade closes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isSyncingAll}
            onClick={onSyncAllForex}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-blue-600 ${
                isSyncingAll ? "animate-spin" : ""
              }`}
            />
            <span>Sync All FX Rates</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add Currency Pair</span>
          </button>
        </div>
      </div>

      {/* Forex Table */}
      <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="border-b border-slate-200/80 bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3.5 pl-5 pr-3">Currency Pair</th>
                <th className="py-3.5 px-3">Live Quote Provider</th>
                <th className="py-3.5 px-3">Yahoo FX Symbol</th>
                <th className="py-3.5 px-3">Historical Provider</th>
                <th className="py-3.5 px-3 text-right">
                  Rate to € (1 CCY → EUR)
                </th>
                <th className="py-3.5 px-3 text-right">
                  Inverse (1 EUR → CCY)
                </th>
                <th className="py-3.5 px-3 text-center">Feed Status</th>
                <th className="py-3.5 pl-3 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forexPairs.map((pair) => {
                const inverse =
                  pair.latestRate > 0 ? 1 / pair.latestRate : 0;

                return (
                  <tr
                    key={pair.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3.5 pl-5 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 font-bold flex items-center justify-center text-[11px]">
                          {pair.fromCurrency}
                        </span>
                        <div>
                          <div className="font-semibold text-slate-900">
                            {pair.pairLabel}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Inverse: EUR / {pair.fromCurrency}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-medium text-[11px]">
                        <Globe className="w-3 h-3" />
                        {pair.liveProvider === "YAHOO"
                          ? "Yahoo Finance"
                          : pair.liveProvider === "FRANKFURTER"
                            ? "Frankfurter (ECB)"
                            : "Manual"}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 font-mono font-semibold text-blue-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{pair.yahooSymbol}</span>
                        {pair.yahooSymbol && (
                          <a
                            href={resolveYahooFinanceUrl(pair.yahooSymbol)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 rounded text-slate-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                            title={`Open ${pair.yahooSymbol} on Yahoo Finance`}
                          >
                            <YahooFinanceIcon className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-medium text-[11px]">
                        <Calendar className="w-3 h-3" />
                        {pair.historicalProvider === "FRANKFURTER"
                          ? "Frankfurter (ECB)"
                          : pair.historicalProvider}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                      €{pair.latestRate.toFixed(6)}
                    </td>

                    <td className="py-3.5 px-3 text-right text-slate-500 whitespace-nowrap">
                      {inverse.toFixed(4)} {pair.fromCurrency}
                    </td>

                    <td className="py-3.5 px-3 text-center whitespace-nowrap">
                      {pair.syncStatus === "OK" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : pair.syncStatus === "ERROR" ? (
                        <span
                          title={pair.syncError || "Sync error"}
                          className="inline-flex items-center gap-1 text-[11px] text-rose-500 font-medium"
                        >
                          <AlertCircle className="w-3.5 h-3.5" />
                          Error
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          {pair.syncStatus}
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 pl-3 pr-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {pair.liveProvider !== "MANUAL" && (
                          <button
                            type="button"
                            disabled={syncingId === pair.id}
                            onClick={() => handleSyncSingle(pair)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Sync live exchange rate"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${
                                syncingId === pair.id
                                  ? "animate-spin text-blue-600"
                                  : ""
                              }`}
                            />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(pair)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                          title="Edit Forex Pair Settings"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteForex(pair)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete Forex Pair"
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

      {/* Historical ECB Rate Lookup Utility */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <ArrowRightLeft className="w-4 h-4 text-blue-600" />
              <span>Historical ECB Exchange Rate Lookup (Frankfurter API)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Test or look up the official European Central Bank historical rate
              for any trade close date.
            </p>
          </div>

          <form
            onSubmit={handleLookupHistoricalEcb}
            className="flex flex-wrap items-center gap-2"
          >
            <select
              value={histCurrency}
              onChange={(e) => setHistCurrency(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800"
            >
              {forexPairs.map((p) => (
                <option key={p.fromCurrency} value={p.fromCurrency}>
                  {p.fromCurrency} → EUR
                </option>
              ))}
            </select>

            <input
              type="date"
              value={histDate}
              onChange={(e) => setHistDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 tabular-nums"
            />

            <button
              type="submit"
              disabled={isFetchingHist}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer"
            >
              {isFetchingHist ? "Fetching..." : "Lookup Rate"}
            </button>

            {histResult !== null && (
              <span className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold tabular-nums">
                1 {histCurrency} = €{histResult.toFixed(6)}
              </span>
            )}
          </form>
        </div>
      </div>

      {/* Add / Edit Forex Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
              <h3 className="text-base font-bold text-slate-900">
                {editingPair
                  ? `Edit Forex Pair: ${editingPair.pairLabel}`
                  : "Add Currency Pair (to EUR)"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Source Currency *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={3}
                    placeholder="USD, CAD, SEK..."
                    value={fromCurrency}
                    onChange={(e) => handleFromCurrencyChange(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono uppercase text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Base Currency
                  </label>
                  <input
                    type="text"
                    disabled
                    value="EUR (€)"
                    className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Live Quote Provider
                </label>
                <select
                  value={liveProvider}
                  onChange={(e) =>
                    setLiveProvider(e.target.value as FxProviderType)
                  }
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  <option value="YAHOO">Yahoo Finance (e.g. USDEUR=X)</option>
                  <option value="FRANKFURTER">
                    Frankfurter API (ECB Daily Reference)
                  </option>
                  <option value="MANUAL">Manual Rate Entry</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-600">
                      Yahoo FX Symbol
                    </label>
                    {yahooSymbol.trim() && (
                      <a
                        href={resolveYahooFinanceUrl(yahooSymbol)}
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
                  <input
                    type="text"
                    placeholder="USDEUR=X"
                    value={yahooSymbol}
                    onChange={(e) =>
                      setYahooSymbol(e.target.value.toUpperCase())
                    }
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono uppercase text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Rate to € (1 {fromCurrency} = €)
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={latestRate}
                    onChange={(e) => setLatestRate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm tabular-nums text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Historical Close Rate Provider
                </label>
                <select
                  value={historicalProvider}
                  onChange={(e) =>
                    setHistoricalProvider(e.target.value as FxProviderType)
                  }
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  <option value="FRANKFURTER">
                    Frankfurter API (Official ECB Historical)
                  </option>
                  <option value="MANUAL">Manual Entry</option>
                </select>
              </div>

              {liveProvider !== "MANUAL" && (
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncNow}
                    onChange={(e) => setSyncNow(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Sync live FX rate immediately upon saving</span>
                </label>
              )}

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
                  {isSaving ? "Saving..." : "Save Forex Pair"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

