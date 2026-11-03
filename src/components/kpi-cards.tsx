"use client";

import React from "react";
import {
  Activity,
  Briefcase,
  Target,
  TrendingUp,
  Scale,
  Euro,
  DollarSign,
  Sparkles,
} from "lucide-react";
import type { PortfolioKPIs } from "@/lib/sepa-math";

interface KpiCardsProps {
  kpis: PortfolioKPIs;
  filterLabel?: string;
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

export function KpiCards({ kpis, filterLabel }: KpiCardsProps) {
  const expectancyPct = kpis.mathExpectancy * 100;

  return (
    <section aria-label="Portfolio Performance KPIs" className="space-y-3">
      {filterLabel && (
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200/80 rounded-lg px-3 py-1.5 w-fit">
          <span>KPIs filtered by:</span>
          <strong className="font-semibold">{filterLabel}</strong>
        </div>
      )}

      {/* Row 1: Primary SEPA Performance Strip (Unified Card like Portfolio Dividend Tracker) */}
      <div className="bg-white border border-slate-200/80 rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.03)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        {/* Win Rate */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Win Rate
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
              {formatPct(kpis.winRate, 1)}
            </div>
            <div className="text-xs text-slate-500 mt-1 tabular-nums">
              <span className="text-emerald-600 font-medium">
                {kpis.winningTrades}W
              </span>{" "}
              /{" "}
              <span className="text-rose-500 font-medium">
                {kpis.losingTrades}L
              </span>{" "}
              ({kpis.totalTrades} total)
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5" />
          </div>
        </div>

        {/* Average Win % / Average Loss % */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Avg Win / Avg Loss
            </div>
            <div className="flex items-baseline gap-1.5 mt-1 tabular-nums">
              <span className="text-2xl font-bold text-emerald-600">
                {formatPct(kpis.avgWinPercent, 1, true)}
              </span>
              <span className="text-slate-300 font-light">/</span>
              <span className="text-2xl font-bold text-rose-500">
                {formatPct(kpis.avgLossPercent, 1)}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1 tabular-nums">
              Avg R:{" "}
              <span className="text-emerald-600 font-medium">
                +{kpis.avgWinR.toFixed(2)}R
              </span>{" "}
              /{" "}
              <span className="text-rose-500 font-medium">
                {kpis.avgLossR.toFixed(2)}R
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* Gain / Loss Ratio */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Gain / Loss Ratio
            </div>
            <div className="flex items-baseline gap-2 mt-1 tabular-nums">
              <span className="text-2xl font-bold text-slate-900">
                {kpis.gainLossRatio.toFixed(2)}
              </span>
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                  kpis.gainLossRatio >= 2.0
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-amber-50 text-amber-600"
                }`}
              >
                {kpis.gainLossRatio >= 2.0 ? "≥ 2.0x Target" : "< 2.0x"}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Avg Win % ÷ |Avg Loss %|
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5" />
          </div>
        </div>

        {/* Mathematical Expectancy */}
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Math. Expectancy
            </div>
            <div className="flex items-baseline gap-2 mt-1 tabular-nums">
              <span className="text-2xl font-bold text-slate-900">
                {kpis.mathExpectancy >= 0 ? "+" : ""}
                {kpis.mathExpectancy.toFixed(2)}
              </span>
              <span
                className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                  expectancyPct >= 0
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-rose-50 text-rose-500"
                }`}
              >
                {expectancyPct >= 0 ? "+" : ""}
                {expectancyPct.toFixed(2)}% / trade
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1 tabular-nums">
              Avg R-Multiple:{" "}
              <span
                className={
                  kpis.avgRMultiple >= 0
                    ? "text-emerald-600 font-medium"
                    : "text-rose-500 font-medium"
                }
              >
                {kpis.avgRMultiple >= 0 ? "+" : ""}
                {kpis.avgRMultiple.toFixed(2)}R
              </span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Row 2: Secondary Ledger & P&L Strip */}
      <div className="bg-white border border-slate-200/80 rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.03)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        {/* Total Trades */}
        <div className="p-4 px-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Total Trades
            </div>
            <div className="text-xl font-bold text-slate-900 mt-0.5 tabular-nums">
              {kpis.totalTrades}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              {kpis.closedTrades} closed • {kpis.openPositions} active
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" />
          </div>
        </div>

        {/* Open Positions & Active Risk */}
        <div className="p-4 px-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Open Positions
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 tabular-nums">
              <span className="text-xl font-bold text-slate-900">
                {kpis.openPositions}
              </span>
              <span className="text-xs text-slate-500">
                (€{Math.round(kpis.openExposureEur).toLocaleString("en-US")} invested)
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Open Stop Risk:{" "}
              <span className="text-amber-600 font-medium">
                €{kpis.openRiskEur.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Briefcase className="w-4 h-4" />
          </div>
        </div>

        {/* Total Gain / Loss (€) */}
        <div className="p-4 px-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Total Gain / Loss (€)
            </div>
            <div
              className={`text-xl font-bold mt-0.5 tabular-nums ${
                kpis.totalGainLossEur >= 0 ? "text-emerald-600" : "text-rose-500"
              }`}
            >
              {formatEur(kpis.totalGainLossEur)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Realized: {formatEur(kpis.realizedGainLossEur)}
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Euro className="w-4 h-4" />
          </div>
        </div>

        {/* Total Gain / Loss ($ / Local) */}
        <div className="p-4 px-5 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Total Gain / Loss ($)
            </div>
            <div
              className={`text-xl font-bold mt-0.5 tabular-nums ${
                kpis.totalGainLossUsdEquivalent >= 0
                  ? "text-emerald-600"
                  : "text-rose-500"
              }`}
            >
              {formatUsd(kpis.totalGainLossUsdEquivalent)}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Open P&L: {formatEur(kpis.unrealizedGainLossEur)}
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4" />
          </div>
        </div>
      </div>
    </section>
  );
}
