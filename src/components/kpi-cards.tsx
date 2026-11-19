"use client";

import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  TrendingUp,
} from "lucide-react";
import type { PortfolioKPIs } from "@/lib/trade-math";

interface KpiCardsProps {
  kpis: PortfolioKPIs;
  onOpenEquityCurve?: () => void;
  accountEquity?: number;
}

function formatEur(val: number): string {
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  const abs = Math.abs(val);
  return `${sign}€${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUsd(val: number): string {
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  const abs = Math.abs(val);
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPct(val: number, decimals = 1, showPlus = false): string {
  const pct = val * 100;
  const sign = showPlus && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

  export function KpiCards({ kpis, onOpenEquityCurve, accountEquity }: KpiCardsProps) {
    const [showDetails, setShowDetails] = useState(false);
    const expectancyPct = kpis.mathExpectancy * 100;
    const investedPct = accountEquity && accountEquity > 0 ? (kpis.openExposureEur / accountEquity) * 100 : undefined;
    const riskPct = accountEquity && accountEquity > 0 ? (kpis.openRiskEur / accountEquity) * 100 : undefined;

    return (
      <section aria-label="Portfolio Performance KPIs" className="space-y-2">
        {/* Slim Unified KPI Header Card */}
        <div className="bg-white border border-slate-200/80 rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.03)] overflow-hidden">
          {/* Primary Row: Essential 4 metrics in a compact, single-line format */}
          <div className="grid grid-cols-2 lg:grid-cols-4">
            {/* 1. Win Rate */}
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between border-b border-r border-slate-100 lg:border-b-0">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Win Rate
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5 tabular-nums">
                  <span className="text-base sm:text-lg font-bold text-slate-900">
                    {formatPct(kpis.winRate, 1)}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    <span className="text-emerald-600 font-semibold">{kpis.winningTrades}W</span>
                    {" "}/{" "}
                    <span className="text-rose-500 font-semibold">{kpis.losingTrades}L</span>
                  </span>
                </div>
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums hidden sm:inline">
                {kpis.totalTrades} trades
              </span>
            </div>

            {/* 2. Avg Win / Avg Loss */}
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between border-b border-slate-100 lg:border-b-0 lg:border-r">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Avg Win / Avg Loss
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 mt-0.5 tabular-nums">
                  <span className="text-base sm:text-lg font-bold text-emerald-600">
                    {formatPct(kpis.avgWinPercent, 1, true)}
                  </span>
                  <span className="text-slate-300 font-light">/</span>
                  <span className="text-base sm:text-lg font-bold text-rose-500">
                    {formatPct(kpis.avgLossPercent, 1)}
                  </span>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 tabular-nums hidden sm:block text-right">
                <span className="text-emerald-600">+{kpis.avgWinR.toFixed(2)}R</span>
                {" / "}
                <span className="text-rose-500">{kpis.avgLossR.toFixed(2)}R</span>
              </div>
            </div>

            {/* 3. Gain / Loss Ratio */}
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between border-r border-slate-100">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Gain / Loss Ratio
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-0.5 tabular-nums">
                  <span className="text-base sm:text-lg font-bold text-slate-900">
                    {kpis.gainLossRatio.toFixed(2)}x
                  </span>
                  <span
                    className={`text-[10px] font-bold px-1 py-0.2 rounded ${kpis.gainLossRatio >= 2.0
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-amber-50 text-amber-600"
                      }`}
                  >
                    {kpis.gainLossRatio >= 2.0 ? "≥ 2.0x" : "< 2.0x"}
                  </span>
                </div>
              </div>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                Target: ≥ 2.0x
              </span>
            </div>

            {/* 4. Expectancy & Total P&L */}
            <div className="px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Expectancy / P&amp;L
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-0.5 tabular-nums">
                  <span className="text-base sm:text-lg font-bold text-slate-900">
                    {kpis.mathExpectancy >= 0 ? "+" : ""}
                    {kpis.mathExpectancy.toFixed(2)}
                  </span>
                  <span
                    className={`text-[11px] sm:text-xs font-semibold ${kpis.totalGainLossEur >= 0 ? "text-emerald-600" : "text-rose-500"
                      }`}
                  >
                    ({formatEur(kpis.totalGainLossEur)})
                  </span>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                {onOpenEquityCurve && (
                  <button
                    type="button"
                    onClick={onOpenEquityCurve}
                    className="text-xs text-slate-500 hover:text-blue-600 font-medium inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Open Equity Curve & Drawdown Visualizer"
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                    <span className="hidden xl:inline">Curve</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDetails((prev) => !prev)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium inline-flex items-center gap-0.5 cursor-pointer"
                >
                  <span>{showDetails ? "Less" : "More"}</span>
                  {showDetails ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Quick Action Footer for KPI Card */}
          <div className="sm:hidden border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 flex items-center justify-between text-xs">
            {onOpenEquityCurve ? (
              <button
                type="button"
                onClick={onOpenEquityCurve}
                className="text-slate-600 hover:text-blue-600 font-medium inline-flex items-center gap-1.5 py-0.5 cursor-pointer"
              >
                <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                <span>Equity Curve</span>
              </button>
            ) : (
              <span className="text-[11px] text-slate-400 tabular-nums">
                {kpis.totalTrades} trades
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-0.5 py-0.5 cursor-pointer"
            >
              <span>{showDetails ? "Hide Details" : "More KPIs"}</span>
              {showDetails ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Collapsible Secondary Metrics (Slim drawer when user clicks "More") */}
          {showDetails && (
            <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums text-slate-600">
              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">
                  Open Positions & Risk
                </span>
                <div className="font-semibold text-slate-800 mt-0.5">
                  {kpis.openPositions} active (€{Math.round(kpis.openExposureEur).toLocaleString("en-US")}
                  {investedPct !== undefined ? ` • ${investedPct.toFixed(1)}%` : " invested"})
                </div>
                <div className="text-[11px] text-amber-600">
                  Risk at stop: €{kpis.openRiskEur.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  {riskPct !== undefined ? ` (${riskPct.toFixed(2)}% acct)` : ""}
                </div>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">
                  Total Gain / Loss (€)
                </span>
                <div
                  className={`font-semibold mt-0.5 ${kpis.totalGainLossEur >= 0 ? "text-emerald-600" : "text-rose-500"
                    }`}
                >
                  {formatEur(kpis.totalGainLossEur)}
                </div>
                <div className="text-[11px] text-slate-400">
                  Realized: {formatEur(kpis.realizedGainLossEur)}
                </div>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">
                  Total Gain / Loss ($ / Local)
                </span>
                <div
                  className={`font-semibold mt-0.5 ${kpis.totalGainLossUsdEquivalent >= 0
                    ? "text-emerald-600"
                    : "text-rose-500"
                    }`}
                >
                  {formatUsd(kpis.totalGainLossUsdEquivalent)}
                </div>
                <div className="text-[11px] text-slate-400">
                  Open P&L: {formatEur(kpis.unrealizedGainLossEur)}
                </div>
              </div>

              <div>
                <span className="text-slate-400 text-[10px] uppercase font-semibold block">
                  Average Trade Return
                </span>
                <div className="font-semibold text-slate-800 mt-0.5">
                  {kpis.avgRMultiple >= 0 ? "+" : ""}
                  {kpis.avgRMultiple.toFixed(2)}R avg
                </div>
                <div className="text-[11px] text-slate-400">
                  {expectancyPct >= 0 ? "+" : ""}
                  {expectancyPct.toFixed(2)}% expectancy/trade
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }
