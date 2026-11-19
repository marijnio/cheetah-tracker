"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  X,
  RefreshCw,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";
import type { ComputedTrade, PortfolioKPIs } from "@/lib/trade-math";
import type { SecurityRecord, ForexPairRecord } from "@/lib/db/schema";

interface LivePairChangeItem {
  pairId: number;
  fromCurrency: string;
  pairLabel: string;
  oldRate: number;
  newRate: number;
  previousClose: number | null;
  source: "YAHOO" | "FRANKFURTER";
  statusChange?: string;
}

interface TradeFxFieldChange {
  oldRate: number;
  newRate: number;
  effectiveDate: string;
  source: "YAHOO" | "FRANKFURTER" | "CACHE";
}

interface TradeFxChangeItem {
  tradeId: number;
  ticker: string;
  currency: string;
  isOpen: boolean;
  startDate: string;
  endDate: string | null;
  entryChange?: TradeFxFieldChange;
  exitChange?: TradeFxFieldChange & { kind: "EXIT" | "LIVE" };
  oldPnlEur: number;
  newPnlEur: number;
  pnlDeltaEur: number;
}

interface PreviewResponse {
  mode: "preview";
  livePairChanges: LivePairChangeItem[];
  tradeChanges: TradeFxChangeItem[];
  summary: {
    totalTradesScanned: number;
    tradesAffected: number;
    entryUpdatesCount: number;
    exitUpdatesCount: number;
    liveUpdatesCount: number;
    livePairUpdatesCount: number;
    totalPnlDeltaEur: number;
  };
  warnings: string[];
  error?: string;
}

interface BulkFxSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied: (payload: {
    trades: ComputedTrade[];
    kpis: PortfolioKPIs;
    securities: SecurityRecord[];
    forexPairs: ForexPairRecord[];
    summary?: {
      tradesAffected: number;
      entryUpdatesCount: number;
      exitUpdatesCount: number;
      liveUpdatesCount: number;
      livePairUpdatesCount: number;
    };
  }) => void;
}

function formatEurDelta(val: number): string {
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  return `${sign}€${Math.abs(val).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function BulkFxSyncModal({
  isOpen,
  onClose,
  onApplied,
}: BulkFxSyncModalProps) {
  const [includeLive, setIncludeLive] = useState(true);
  const [includeEntryFx, setIncludeEntryFx] = useState(true);
  const [includeExitFx, setIncludeExitFx] = useState(true);

  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);

  const fetchPreview = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingPreview(true);
      setError(null);
      try {
        const res = await fetch("/api/forex/sync-trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "preview",
            includeLive,
            includeEntryFx,
            includeExitFx,
          }),
          signal,
        });
        const data = (await res.json()) as PreviewResponse;
        if (!res.ok) {
          throw new Error(data.error || "Failed to load FX preview");
        }
        setPreviewData(data);
        setSelectedIds(new Set(data.tradeChanges.map((c) => c.tradeId)));
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Failed to preview FX updates"
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoadingPreview(false);
        }
      }
    },
    [includeLive, includeEntryFx, includeExitFx]
  );

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    fetchPreview(controller.signal);
    return () => controller.abort();
  }, [isOpen, fetchPreview, refreshTick]);

  const tradeChanges = useMemo(
    () => previewData?.tradeChanges ?? [],
    [previewData]
  );
  const livePairChanges = useMemo(
    () => previewData?.livePairChanges ?? [],
    [previewData]
  );
  const warnings = useMemo(() => previewData?.warnings ?? [], [previewData]);

  const selectedSummary = useMemo(() => {
    let entryCount = 0;
    let exitOrLiveCount = 0;
    let pnlDelta = 0;
    for (const ch of tradeChanges) {
      if (!selectedIds.has(ch.tradeId)) continue;
      if (ch.entryChange) entryCount++;
      if (ch.exitChange) exitOrLiveCount++;
      pnlDelta += ch.pnlDeltaEur;
    }
    return {
      selectedTrades: selectedIds.size,
      livePairsCount: includeLive ? livePairChanges.length : 0,
      entryCount,
      exitOrLiveCount,
      pnlDelta,
    };
  }, [tradeChanges, selectedIds, includeLive, livePairChanges]);

  const allSelected =
    tradeChanges.length > 0 && selectedIds.size === tradeChanges.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tradeChanges.map((c) => c.tradeId)));
    }
  };

  const toggleOne = (tradeId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tradeId)) {
        next.delete(tradeId);
      } else {
        next.add(tradeId);
      }
      return next;
    });
  };

  const canApply =
    !isLoadingPreview &&
    !isApplying &&
    (selectedIds.size > 0 || (includeLive && livePairChanges.length > 0));

  const handleApply = async () => {
    if (!canApply) return;
    setIsApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/forex/sync-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "apply",
          includeLive,
          includeEntryFx,
          includeExitFx,
          selectedTradeIds: Array.from(selectedIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to apply FX updates");
      }
      onApplied(data);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to apply FX updates"
      );
    } finally {
      setIsApplying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-2 sm:p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <ArrowRightLeft className="w-4 h-4 stroke-[2.2]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Update All Trade FX Rates
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Sync live FX pairs from Yahoo Finance and backfill official ECB
                historical rates for entry &amp; exit dates.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Scope Toggles + Refresh */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeLive}
                  onChange={(e) => setIncludeLive(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Live FX Pairs &amp; Open Trades</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeEntryFx}
                  onChange={(e) => setIncludeEntryFx(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Historical Entry FX (Start Date)</span>
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeExitFx}
                  onChange={(e) => setIncludeExitFx(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Historical Exit FX (End Date)</span>
              </label>
            </div>

            <button
              type="button"
              disabled={isLoadingPreview}
              onClick={() => setRefreshTick((n) => n + 1)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-blue-600 ${
                  isLoadingPreview ? "animate-spin" : ""
                }`}
              />
              <span>Refresh Preview</span>
            </button>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
            <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Live FX Pairs
              </div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">
                {selectedSummary.livePairsCount}
              </div>
              <div className="text-[11px] text-slate-500">
                Currency feeds to sync
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Entry FX Updates
              </div>
              <div className="text-lg font-bold text-blue-600 mt-0.5">
                {selectedSummary.entryCount}
              </div>
              <div className="text-[11px] text-slate-500">
                Historical start dates
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Exit / Live FX
              </div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">
                {selectedSummary.exitOrLiveCount}
              </div>
              <div className="text-[11px] text-slate-500">
                Selected trade updates
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Net P&amp;L € Impact
              </div>
              <div
                className={`text-lg font-bold mt-0.5 ${
                  selectedSummary.pnlDelta > 0.005
                    ? "text-emerald-600"
                    : selectedSummary.pnlDelta < -0.005
                      ? "text-rose-600"
                      : "text-slate-700"
                }`}
              >
                {formatEurDelta(selectedSummary.pnlDelta)}
              </div>
              <div className="text-[11px] text-slate-500">
                Across {selectedSummary.selectedTrades} selected trades
              </div>
            </div>
          </div>

          {/* Info & Warnings */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50/70 border border-blue-200/70 text-[11px] text-blue-900">
            <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span>
              Uncheck any trade below to preserve manually entered broker FX
              rates. Your Cash Balance will not be modified.
            </span>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Some FX lookups had warnings:</span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Live Currency Pair Preview Strip */}
          {includeLive && livePairChanges.length > 0 && (
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Live Currency Pair Updates ({livePairChanges.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {livePairChanges.map((lp) => (
                  <div
                    key={lp.pairId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] tabular-nums"
                  >
                    <span className="font-bold text-slate-800">
                      {lp.fromCurrency}/EUR
                    </span>
                    <span className="text-slate-400">
                      {lp.oldRate.toFixed(4)} →
                    </span>
                    <span className="font-semibold text-blue-600">
                      {lp.newRate.toFixed(4)}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({lp.source === "YAHOO" ? "Yahoo" : "ECB"})
                    </span>
                    {lp.statusChange && (
                      <span className="px-1 py-0.2 rounded bg-emerald-50 text-emerald-700 text-[10px] font-semibold">
                        {lp.statusChange}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trade Changes Table */}
          {isLoadingPreview ? (
            <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />
              <span>
                Fetching live rates and official ECB historical time series…
              </span>
            </div>
          ) : tradeChanges.length === 0 &&
            (!includeLive || livePairChanges.length === 0) ? (
            <div className="py-10 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 space-y-1.5">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-800">
                All FX rates are already up to date!
              </div>
              <div className="text-xs text-slate-500">
                Every trade&apos;s entry, exit, and live exchange rate matches
                the latest market &amp; ECB reference data.
              </div>
            </div>
          ) : tradeChanges.length > 0 ? (
            <div className="border border-slate-200/90 rounded-xl overflow-hidden">
              <div className="max-h-[40vh] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs tabular-nums">
                  <thead className="sticky top-0 z-10 bg-[#f8fafc] border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2.5 pl-3 pr-2 w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="Select all trades"
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </th>
                      <th className="py-2.5 px-2">Trade</th>
                      <th className="py-2.5 px-2">Dates</th>
                      <th className="py-2.5 px-2 text-right">Entry FX</th>
                      <th className="py-2.5 px-2 text-right">
                        Current / Exit FX
                      </th>
                      <th className="py-2.5 pl-2 pr-4 text-right">
                        P&amp;L € Impact
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {tradeChanges.map((ch) => {
                      const checked = selectedIds.has(ch.tradeId);
                      return (
                        <tr
                          key={ch.tradeId}
                          onClick={() => toggleOne(ch.tradeId)}
                          className={`cursor-pointer transition-colors ${
                            checked
                              ? "bg-white hover:bg-blue-50/40"
                              : "bg-slate-50/70 opacity-60 hover:opacity-90"
                          }`}
                        >
                          <td
                            className="py-2.5 pl-3 pr-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOne(ch.tradeId)}
                              aria-label={`Select ${ch.ticker} (${ch.startDate})`}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                          </td>

                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-slate-900">
                                {ch.ticker}
                              </span>
                              <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                                {ch.currency}
                              </span>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                  ch.isOpen
                                    ? "bg-blue-50 text-blue-700"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {ch.isOpen ? "Open" : "Closed"}
                              </span>
                            </div>
                          </td>

                          <td className="py-2.5 px-2 whitespace-nowrap text-slate-600">
                            <span>{ch.startDate}</span>
                            <span className="text-slate-400">
                              {" "}
                              → {ch.endDate ?? "Live"}
                            </span>
                          </td>

                          <td className="py-2.5 px-2 text-right whitespace-nowrap">
                            {ch.entryChange ? (
                              <div>
                                <div className="font-medium text-slate-800">
                                  <span className="text-slate-400">
                                    {ch.entryChange.oldRate.toFixed(4)} →{" "}
                                  </span>
                                  <span className="font-bold text-blue-600">
                                    {ch.entryChange.newRate.toFixed(4)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {ch.entryChange.source === "YAHOO"
                                    ? "Yahoo Live"
                                    : `ECB ${ch.entryChange.effectiveDate}`}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">Unchanged</span>
                            )}
                          </td>

                          <td className="py-2.5 px-2 text-right whitespace-nowrap">
                            {ch.exitChange ? (
                              <div>
                                <div className="font-medium text-slate-800">
                                  <span className="text-slate-400">
                                    {ch.exitChange.oldRate.toFixed(4)} →{" "}
                                  </span>
                                  <span className="font-bold text-blue-600">
                                    {ch.exitChange.newRate.toFixed(4)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {ch.exitChange.kind === "LIVE"
                                    ? `Live (${ch.exitChange.source === "YAHOO" ? "Yahoo" : "ECB"})`
                                    : `ECB ${ch.exitChange.effectiveDate}`}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">Unchanged</span>
                            )}
                          </td>

                          <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                            <span
                              className={`font-bold ${
                                ch.pnlDeltaEur > 0.005
                                  ? "text-emerald-600"
                                  : ch.pnlDeltaEur < -0.005
                                    ? "text-rose-600"
                                    : "text-slate-500"
                              }`}
                            >
                              {formatEurDelta(ch.pnlDeltaEur)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!canApply}
            onClick={handleApply}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isApplying ? "animate-spin" : ""}`}
            />
            <span>
              {isApplying
                ? "Applying FX Updates..."
                : selectedIds.size > 0
                  ? `Apply ${selectedIds.size} Trade FX Update${selectedIds.size === 1 ? "" : "s"}`
                  : "Apply Live FX Sync"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
