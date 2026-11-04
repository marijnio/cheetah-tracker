"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  Activity,
  BarChart3,
  ShieldAlert,
  Info,
  CheckCircle2,
  Flame,
  Snowflake,
} from "lucide-react";
import type { ComputedTrade } from "@/lib/trade-math";

interface EquityCurveViewProps {
  trades: ComputedTrade[];
  currentAccountEquity?: number;
  onOpenAccountModal?: () => void;
}

type MetricMode = "EUR" | "R_MULTIPLE" | "ACCOUNT_PCT";
type ScopeFilter = "ALL" | "CLOSED_ONLY" | "LAST_50" | "LAST_25";

interface EquityPoint {
  index: number; // 1-based trade sequence index
  trade: ComputedTrade;
  date: string;
  tradeReturnEur: number;
  tradeReturnR: number;
  cumulativeEur: number;
  cumulativeR: number;
  accountEquityEur: number;
  peakEur: number;
  peakR: number;
  peakAccountEur: number;
  drawdownEur: number; // <= 0
  drawdownR: number; // <= 0
  drawdownPct: number; // <= 0 (percentage drop from peak account equity)
  isNewHigh: boolean;
}

function formatEur(val: number, decimals = 0): string {
  const sign = val > 0 ? "+" : val < 0 ? "-" : "";
  const abs = Math.abs(val);
  return `${sign}€${abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function EquityCurveView({
  trades,
  currentAccountEquity: currentAccountEquityProp,
  onOpenAccountModal,
}: EquityCurveViewProps) {
  const [metricMode, setMetricMode] = useState<MetricMode>("EUR");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("ALL");
  const [currentAccountEquity, setCurrentAccountEquity] = useState<number>(
    currentAccountEquityProp ?? 50000
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (currentAccountEquityProp !== undefined) {
      setCurrentAccountEquity(currentAccountEquityProp);
      return;
    }
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("cheetah_account_equity");
      if (saved && !isNaN(Number(saved)) && Number(saved) > 0) {
        setCurrentAccountEquity(Number(saved));
      }
    }
  }, [currentAccountEquityProp]);

  // Sort trades chronologically (by endDate if closed, otherwise startDate)
  const sortedTrades = useMemo(() => {
    let base = [...trades];
    if (scopeFilter === "CLOSED_ONLY") {
      base = base.filter((t) => !t.isOpen);
    }

    base.sort((a, b) => {
      const dateA = a.endDate || a.startDate;
      const dateB = b.endDate || b.startDate;
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.id - b.id;
    });

    if (scopeFilter === "LAST_50") {
      base = base.slice(-50);
    } else if (scopeFilter === "LAST_25") {
      base = base.slice(-25);
    }

    return base;
  }, [trades, scopeFilter]);

  // Build chronological equity & underwater drawdown points
  const {
    points,
    maxDrawdownEur,
    maxDrawdownR,
    maxDrawdownPct,
    maxDrawdownPeakDate,
    maxDrawdownTroughDate,
    profitFactor,
    recoveryFactor,
    maxWinStreak,
    maxLossStreak,
    currentStreak,
    recent10WinRate,
    recent10AvgR,
    rDistribution,
    impliedBaseEquity,
  } = useMemo(() => {
    const totalCumEur = sortedTrades.reduce((s, t) => s + t.gainLossEur, 0);
    const targetEndEquity = currentAccountEquity > 0 ? currentAccountEquity : 50000;
    const baseEquity = Math.max(1000, targetEndEquity - totalCumEur);
    let cumEur = 0;
    let cumR = 0;
    let peakEur = 0;
    let peakR = 0;
    let peakAccountEur = baseEquity;

    let worstDdEur = 0;
    let worstDdR = 0;
    let worstDdPct = 0;
    let currentPeakDate = sortedTrades[0]?.startDate || "—";
    let worstDdPeakDate = currentPeakDate;
    let worstDdTroughDate = currentPeakDate;

    let grossWinsEur = 0;
    let grossLossesEur = 0;

    let winStreak = 0;
    let lossStreak = 0;
    let bestWinStreak = 0;
    let worstLossStreak = 0;

    const pts: EquityPoint[] = [];

    for (let i = 0; i < sortedTrades.length; i++) {
      const t = sortedTrades[i];
      const date = t.endDate || t.startDate;
      const retEur = t.gainLossEur;
      const retR = t.rMultiple;

      cumEur += retEur;
      cumR += retR;
      const acctEur = baseEquity + cumEur;

      if (retEur > 0) {
        grossWinsEur += retEur;
        winStreak++;
        lossStreak = 0;
        if (winStreak > bestWinStreak) bestWinStreak = winStreak;
      } else {
        grossLossesEur += Math.abs(retEur);
        lossStreak++;
        winStreak = 0;
        if (lossStreak > worstLossStreak) worstLossStreak = lossStreak;
      }

      let isNewHigh = false;
      if (cumEur >= peakEur) {
        peakEur = cumEur;
        currentPeakDate = date;
        isNewHigh = true;
      }
      if (cumR >= peakR) {
        peakR = cumR;
      }
      if (acctEur >= peakAccountEur) {
        peakAccountEur = acctEur;
      }

      const ddEur = cumEur - peakEur; // <= 0
      const ddR = cumR - peakR; // <= 0
      const ddPct =
        peakAccountEur > 0 ? ((acctEur - peakAccountEur) / peakAccountEur) * 100 : 0;

      if (ddEur < worstDdEur) {
        worstDdEur = ddEur;
        worstDdPeakDate = currentPeakDate;
        worstDdTroughDate = date;
      }
      if (ddR < worstDdR) {
        worstDdR = ddR;
      }
      if (ddPct < worstDdPct) {
        worstDdPct = ddPct;
      }

      pts.push({
        index: i + 1,
        trade: t,
        date,
        tradeReturnEur: retEur,
        tradeReturnR: retR,
        cumulativeEur: cumEur,
        cumulativeR: cumR,
        accountEquityEur: acctEur,
        peakEur,
        peakR,
        peakAccountEur,
        drawdownEur: ddEur,
        drawdownR: ddR,
        drawdownPct: ddPct,
        isNewHigh,
      });
    }

    const pf = grossLossesEur > 0 ? grossWinsEur / grossLossesEur : grossWinsEur > 0 ? 99 : 0;
    const rf = Math.abs(worstDdEur) > 0 ? cumEur / Math.abs(worstDdEur) : 0;

    // Recent 10 trades feedback
    const last10 = sortedTrades.slice(-10);
    const last10Wins = last10.filter((t) => t.gainLossPercent > 0).length;
    const rec10WinRate = last10.length > 0 ? (last10Wins / last10.length) * 100 : 0;
    const rec10AvgR =
      last10.length > 0
        ? last10.reduce((acc, t) => acc + t.rMultiple, 0) / last10.length
        : 0;

    // R-Multiple buckets
    const buckets = [
      { label: "< -2R", min: -Infinity, max: -2, count: 0, isWin: false },
      { label: "-2R to -1R", min: -2, max: -1, count: 0, isWin: false },
      { label: "-1R to 0R", min: -1, max: 0, count: 0, isWin: false },
      { label: "0R to +1R", min: 0, max: 1, count: 0, isWin: true },
      { label: "+1R to +2R", min: 1, max: 2, count: 0, isWin: true },
      { label: "+2R to +3R", min: 2, max: 3, count: 0, isWin: true },
      { label: "> +3R", min: 3, max: Infinity, count: 0, isWin: true },
    ];

    for (const t of sortedTrades) {
      const r = t.rMultiple;
      for (const b of buckets) {
        if (r > b.min && r <= b.max) {
          b.count++;
          break;
        }
      }
    }

    return {
      points: pts,
      maxDrawdownEur: worstDdEur,
      maxDrawdownR: worstDdR,
      maxDrawdownPct: worstDdPct,
      maxDrawdownPeakDate: worstDdPeakDate,
      maxDrawdownTroughDate: worstDdTroughDate,
      profitFactor: pf,
      recoveryFactor: rf,
      maxWinStreak: bestWinStreak,
      maxLossStreak: worstLossStreak,
      currentStreak:
        winStreak > 0
          ? { type: "WIN" as const, count: winStreak }
          : { type: "LOSS" as const, count: lossStreak },
      recent10WinRate: rec10WinRate,
      recent10AvgR: rec10AvgR,
      rDistribution: buckets,
      impliedBaseEquity: baseEquity,
    };
  }, [sortedTrades, currentAccountEquity]);

  const latestPoint = points.length > 0 ? points[points.length - 1] : null;
  const activePoint =
    hoveredIndex !== null && points[hoveredIndex]
      ? points[hoveredIndex]
      : latestPoint;

  // SVG Chart dimensions & coordinate mapping
  const width = 920;
  const equityHeight = 250;
  const ddHeight = 120;
  const padLeft = 68;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 26;

  const plotWidth = width - padLeft - padRight;
  const eqPlotHeight = equityHeight - padTop - padBottom;
  const ddPlotHeight = ddHeight - 14 - 22;

  const getEquityVal = (p: EquityPoint) => {
    if (metricMode === "EUR") return p.cumulativeEur;
    if (metricMode === "R_MULTIPLE") return p.cumulativeR;
    return (p.cumulativeEur / impliedBaseEquity) * 100;
  };

  const getPeakVal = (p: EquityPoint) => {
    if (metricMode === "EUR") return p.peakEur;
    if (metricMode === "R_MULTIPLE") return p.peakR;
    return (p.peakEur / impliedBaseEquity) * 100;
  };

  const getDdVal = (p: EquityPoint) => {
    if (metricMode === "EUR") return p.drawdownEur;
    if (metricMode === "R_MULTIPLE") return p.drawdownR;
    return p.drawdownPct;
  };

  const eqValues = points.map(getEquityVal);
  const minEq = Math.min(0, ...eqValues);
  const maxEq = Math.max(1, ...eqValues);
  const eqSpan = maxEq - minEq || 1;

  const ddValues = points.map(getDdVal);
  const minDd = Math.min(-0.1, ...ddValues);
  const ddSpan = Math.abs(minDd) || 1;

  const xForIndex = (idx: number) => {
    if (points.length <= 1) return padLeft + plotWidth / 2;
    return padLeft + (idx / (points.length - 1)) * plotWidth;
  };

  const yForEq = (val: number) => {
    return padTop + eqPlotHeight - ((val - minEq) / eqSpan) * eqPlotHeight;
  };

  const yForDd = (val: number) => {
    // 0 is at top (14), minDd is at bottom (14 + ddPlotHeight)
    return 14 + (Math.abs(val) / ddSpan) * ddPlotHeight;
  };

  const zeroY = yForEq(0);

  // Build SVG path strings
  const eqLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(1)} ${yForEq(getEquityVal(p)).toFixed(1)}`)
    .join(" ");

  const peakLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(1)} ${yForEq(getPeakVal(p)).toFixed(1)}`)
    .join(" ");

  const eqAreaPath =
    points.length > 0
      ? `${eqLinePath} L ${xForIndex(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${xForIndex(0).toFixed(1)} ${zeroY.toFixed(1)} Z`
      : "";

  const ddLinePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i).toFixed(1)} ${yForDd(getDdVal(p)).toFixed(1)}`)
    .join(" ");

  const ddAreaPath =
    points.length > 0
      ? `${ddLinePath} L ${xForIndex(points.length - 1).toFixed(1)} 14 L ${xForIndex(0).toFixed(1)} 14 Z`
      : "";

  const formatMetricValue = (val: number) => {
    if (metricMode === "EUR") return formatEur(val, 0);
    if (metricMode === "R_MULTIPLE") return `${val >= 0 ? "+" : ""}${val.toFixed(1)}R`;
    return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  };

  const maxBucketCount = Math.max(1, ...rDistribution.map((b) => b.count));

  return (
    <div className="space-y-6">
      {/* Top Controls & Guidance Card */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Cumulative Equity Curve & Underwater Drawdown
              </h2>
              {latestPoint && latestPoint.drawdownEur === 0 ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <Award className="w-3 h-3" /> High-Water Mark
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  In Drawdown ({latestPoint ? formatEur(latestPoint.drawdownEur, 0) : "€0"})
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Track your realized & open capital trajectory, high-water marks, and peak-to-trough drawdowns across every trade.
            </p>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Current Account Equity Badge */}
            <button
              type="button"
              onClick={onOpenAccountModal}
              className="flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
              title="Anchored to your current broker account value — click to recalibrate"
            >
              <span className="text-[11px] font-semibold text-slate-500">Current Equity:</span>
              <span className="text-xs font-bold text-slate-900 tabular-nums">
                €{Math.round(currentAccountEquity).toLocaleString("en-US")}
              </span>
            </button>

            {/* Metric Unit Switcher */}
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/80">
              {(
                [
                  { id: "EUR", label: "Euro (€)" },
                  { id: "R_MULTIPLE", label: "R-Multiple (R)" },
                  { id: "ACCOUNT_PCT", label: "Return (%)" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetricMode(m.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${metricMode === m.id
                    ? "bg-white text-blue-600 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                    }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Trade Scope Filter */}
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
              className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer focus:outline-hidden focus:border-blue-600"
            >
              <option value="ALL">All Trades ({trades.length})</option>
              <option value="CLOSED_ONLY">Closed Only</option>
              <option value="LAST_50">Last 50 Trades</option>
              <option value="LAST_25">Last 25 Trades</option>
            </select>
          </div>
        </div>

        {/* Summary KPI Strip for Drawdown, Profit Factor & Streaks */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          {/* 1. Max Drawdown */}
          <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Max Peak-to-Trough Drawdown
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 tabular-nums">
              <span className="text-base font-bold text-rose-600">
                {formatEur(maxDrawdownEur, 0)}
              </span>
              <span className="text-xs font-semibold text-rose-500">
                ({maxDrawdownPct.toFixed(1)}% · {maxDrawdownR.toFixed(1)}R)
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 truncate">
              {maxDrawdownPeakDate} → {maxDrawdownTroughDate}
            </div>
          </div>

          {/* 2. Current Drawdown / High-Water Mark */}
          <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Current Drawdown vs Peak
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 tabular-nums">
              <span
                className={`text-base font-bold ${latestPoint && latestPoint.drawdownEur < 0
                  ? "text-amber-600"
                  : "text-emerald-600"
                  }`}
              >
                {latestPoint ? formatEur(latestPoint.drawdownEur, 0) : "€0"}
              </span>
              {latestPoint && (
                <span className="text-xs text-slate-500">
                  ({latestPoint.drawdownPct.toFixed(1)}% · {latestPoint.drawdownR.toFixed(1)}R)
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Peak Cumulative: {latestPoint ? formatEur(latestPoint.peakEur, 0) : "€0"}
            </div>
          </div>

          {/* 3. Profit Factor & Recovery Factor */}
          <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Profit Factor / Recovery
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 tabular-nums">
              <span className="text-base font-bold text-slate-900">
                {profitFactor.toFixed(2)}x
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${profitFactor >= 2.0
                  ? "bg-emerald-50 text-emerald-600"
                  : profitFactor >= 1.5
                    ? "bg-blue-50 text-blue-600"
                    : "bg-amber-50 text-amber-600"
                  }`}
              >
                {profitFactor >= 2.0 ? "Strong Edge" : "Positive"}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
              Recovery Factor: <strong>{recoveryFactor.toFixed(2)}x</strong> net/maxDD
            </div>
          </div>

          {/* 4. Rolling 10-Trade Market Feedback & Streaks */}
          <div className="p-3 rounded-xl bg-slate-50/70 border border-slate-200/60">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Last 10 Trades Rhythm</span>
              {recent10WinRate >= 50 ? (
                <Flame className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Snowflake className="w-3.5 h-3.5 text-amber-500" />
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-0.5 tabular-nums">
              <span className="text-base font-bold text-slate-900">
                {recent10WinRate.toFixed(0)}% Win
              </span>
              <span
                className={`text-xs font-semibold ${recent10AvgR >= 0 ? "text-emerald-600" : "text-rose-500"
                  }`}
              >
                ({recent10AvgR >= 0 ? "+" : ""}
                {recent10AvgR.toFixed(2)}R avg)
              </span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
              Best Streak: <span className="text-emerald-600 font-semibold">{maxWinStreak}W</span> · Max Cold:{" "}
              <span className="text-rose-500 font-semibold">{maxLossStreak}L</span> · Now:{" "}
              <strong className={currentStreak.type === "WIN" ? "text-emerald-600" : "text-rose-500"}>
                {currentStreak.count}
                {currentStreak.type === "WIN" ? "W" : "L"}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dual Synchronized Chart Card */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.03)] space-y-4">
        {/* Active Hover Readout Bar */}
        {activePoint && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs tabular-nums">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[11px]">
                Trade #{activePoint.index}
              </span>
              <span className="font-bold text-slate-900 font-mono">
                {activePoint.trade.ticker}
              </span>
              <span className="text-slate-400">{activePoint.date}</span>
              <span
                className={`font-semibold px-1.5 py-0.2 rounded text-[11px] ${activePoint.tradeReturnEur >= 0
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-rose-50 text-rose-500"
                  }`}
              >
                {formatEur(activePoint.tradeReturnEur, 2)} (
                {activePoint.tradeReturnR >= 0 ? "+" : ""}
                {activePoint.tradeReturnR.toFixed(2)}R)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div>
                <span className="text-slate-400 mr-1">Cumulative:</span>
                <strong
                  className={
                    activePoint.cumulativeEur >= 0
                      ? "text-emerald-600"
                      : "text-rose-500"
                  }
                >
                  {formatEur(activePoint.cumulativeEur, 2)}
                </strong>{" "}
                <span className="text-slate-400">
                  ({activePoint.cumulativeR >= 0 ? "+" : ""}
                  {activePoint.cumulativeR.toFixed(2)}R)
                </span>
              </div>

              <div>
                <span className="text-slate-400 mr-1">Account Equity:</span>
                <strong className="text-slate-900">
                  €{activePoint.accountEquityEur.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                </strong>
              </div>

              <div>
                <span className="text-slate-400 mr-1">Drawdown:</span>
                <strong
                  className={
                    activePoint.drawdownEur < 0 ? "text-rose-600" : "text-emerald-600"
                  }
                >
                  {activePoint.drawdownEur === 0
                    ? "0.0% (Peak)"
                    : `${formatEur(activePoint.drawdownEur, 0)} (${activePoint.drawdownPct.toFixed(1)}%)`}
                </strong>
              </div>
            </div>
          </div>
        )}

        {/* SVG Interactive Canvas */}
        {points.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-400">
            No trades available for the selected filter.
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <div className="min-w-[680px]">
              {/* Top Chart: Cumulative Equity & High-Water Mark */}
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center justify-between px-1">
                <span>
                  1. Cumulative Performance Trajectory (
                  {metricMode === "EUR"
                    ? "Euro P&L"
                    : metricMode === "R_MULTIPLE"
                      ? "Cumulative R-Multiples"
                      : "% Return on Base Equity"}
                  )
                </span>
                <div className="flex items-center gap-4 text-[11px] font-normal normal-case">
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <span className="w-2.5 h-0.5 bg-blue-600 inline-block" /> Equity Curve
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="w-2.5 h-0.5 border-b border-dashed border-emerald-500 inline-block" /> High-Water Mark
                  </span>
                </div>
              </div>

              <svg
                viewBox={`0 0 ${width} ${equityHeight}`}
                className="w-full h-auto select-none overflow-visible"
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <defs>
                  <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                  const val = minEq + t * eqSpan;
                  const y = yForEq(val);
                  return (
                    <g key={t}>
                      <line
                        x1={padLeft}
                        y1={y}
                        x2={width - padRight}
                        y2={y}
                        stroke="#f1f5f9"
                        strokeWidth="1"
                      />
                      <text
                        x={padLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-400 text-[10px] font-mono"
                      >
                        {formatMetricValue(val)}
                      </text>
                    </g>
                  );
                })}

                {/* Zero Baseline */}
                {minEq <= 0 && maxEq >= 0 && (
                  <line
                    x1={padLeft}
                    y1={zeroY}
                    x2={width - padRight}
                    y2={zeroY}
                    stroke="#cbd5e1"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                )}

                {/* Shaded Area under Equity Curve */}
                <path d={eqAreaPath} fill="url(#eqGradient)" />

                {/* High-Water Mark Dashed Line */}
                <path
                  d={peakLinePath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="1.25"
                  strokeDasharray="4 4"
                  opacity="0.75"
                />

                {/* Primary Equity Line */}
                <path
                  d={eqLinePath}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* New High Dots */}
                {points.map((p, i) =>
                  p.isNewHigh && i % Math.max(1, Math.floor(points.length / 25)) === 0 ? (
                    <circle
                      key={p.index}
                      cx={xForIndex(i)}
                      cy={yForEq(getEquityVal(p))}
                      r="2.5"
                      className="fill-emerald-500"
                    />
                  ) : null
                )}

                {/* Active Hover Crosshair & Highlight Dot */}
                {activePoint && (
                  <g>
                    <line
                      x1={xForIndex(activePoint.index - 1)}
                      y1={padTop}
                      x2={xForIndex(activePoint.index - 1)}
                      y2={equityHeight - padBottom}
                      stroke="#94a3b8"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                    />
                    <circle
                      cx={xForIndex(activePoint.index - 1)}
                      cy={yForEq(getEquityVal(activePoint))}
                      r="4.5"
                      className="fill-blue-600 stroke-white stroke-2"
                    />
                  </g>
                )}

                {/* Invisible Interactive Hit Columns */}
                {points.map((p, i) => {
                  const colW = plotWidth / points.length;
                  return (
                    <rect
                      key={p.index}
                      x={xForIndex(i) - colW / 2}
                      y={padTop}
                      width={Math.max(4, colW)}
                      height={eqPlotHeight}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoveredIndex(i)}
                    />
                  );
                })}
              </svg>

              {/* Bottom Synchronized Chart: Underwater Drawdown Curve */}
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mt-3 mb-1 flex items-center justify-between px-1">
                <span>2. Underwater Drawdown Depth (From High-Water Mark)</span>
                <span className="text-[11px] font-normal normal-case text-rose-500">
                  Max Trough:{" "}
                  {metricMode === "EUR"
                    ? formatEur(maxDrawdownEur, 0)
                    : metricMode === "R_MULTIPLE"
                      ? `${maxDrawdownR.toFixed(1)}R`
                      : `${maxDrawdownPct.toFixed(1)}%`}
                </span>
              </div>

              <svg
                viewBox={`0 0 ${width} ${ddHeight}`}
                className="w-full h-auto select-none overflow-visible"
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <defs>
                  <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.06" />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.28" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid Lines for Drawdown */}
                {[0, 0.5, 1].map((t) => {
                  const val = -t * ddSpan;
                  const y = yForDd(val);
                  return (
                    <g key={t}>
                      <line
                        x1={padLeft}
                        y1={y}
                        x2={width - padRight}
                        y2={y}
                        stroke={t === 0 ? "#cbd5e1" : "#f1f5f9"}
                        strokeWidth="1"
                      />
                      <text
                        x={padLeft - 8}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-rose-400 text-[10px] font-mono"
                      >
                        {metricMode === "EUR"
                          ? formatEur(val, 0)
                          : metricMode === "R_MULTIPLE"
                            ? `${val.toFixed(1)}R`
                            : `${val.toFixed(1)}%`}
                      </text>
                    </g>
                  );
                })}

                {/* Shaded Underwater Area */}
                <path d={ddAreaPath} fill="url(#ddGradient)" />

                {/* Drawdown Line */}
                <path
                  d={ddLinePath}
                  fill="none"
                  stroke="#e11d48"
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                />

                {/* Active Hover Crosshair on Drawdown */}
                {activePoint && (
                  <g>
                    <line
                      x1={xForIndex(activePoint.index - 1)}
                      y1={14}
                      x2={xForIndex(activePoint.index - 1)}
                      y2={14 + ddPlotHeight}
                      stroke="#94a3b8"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                    />
                    <circle
                      cx={xForIndex(activePoint.index - 1)}
                      cy={yForDd(getDdVal(activePoint))}
                      r="4"
                      className="fill-rose-600 stroke-white stroke-2"
                    />
                  </g>
                )}

                {/* Date Labels along X-Axis */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                  const idx = Math.min(
                    points.length - 1,
                    Math.floor(pct * (points.length - 1))
                  );
                  const pt = points[idx];
                  if (!pt) return null;
                  return (
                    <text
                      key={pct}
                      x={xForIndex(idx)}
                      y={ddHeight - 4}
                      textAnchor="middle"
                      className="fill-slate-400 text-[10px] font-mono"
                    >
                      #{pt.index} ({pt.date})
                    </text>
                  );
                })}

                {/* Invisible Interactive Hit Columns */}
                {points.map((p, i) => {
                  const colW = plotWidth / points.length;
                  return (
                    <rect
                      key={p.index}
                      x={xForIndex(i) - colW / 2}
                      y={14}
                      width={Math.max(4, colW)}
                      height={ddPlotHeight}
                      fill="transparent"
                      className="cursor-crosshair"
                      onMouseEnter={() => setHoveredIndex(i)}
                    />
                  );
                })}
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Panel: R-Multiple Outcome Distribution & Discipline Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* R-Multiple Histogram */}
        <div className="lg:col-span-2 bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                R-Multiple Distribution (Asymmetric Tail Analysis)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                A healthy risk profile keeps losses contained between -1R and 0R while allowing winners to expand to +2R and +3R+.
              </p>
            </div>
            <BarChart3 className="w-4 h-4 text-slate-400" />
          </div>

          <div className="grid grid-cols-7 gap-2 items-end h-40 pt-6 pb-2 px-2 bg-slate-50/60 rounded-xl border border-slate-100">
            {rDistribution.map((bucket) => {
              const heightPct = Math.max(
                6,
                Math.round((bucket.count / maxBucketCount) * 100)
              );
              const pctOfTotal =
                sortedTrades.length > 0
                  ? ((bucket.count / sortedTrades.length) * 100).toFixed(0)
                  : "0";
              return (
                <div
                  key={bucket.label}
                  className="flex flex-col items-center justify-end h-full group"
                >
                  <span className="text-[11px] font-bold text-slate-700 tabular-nums mb-1">
                    {bucket.count}
                    <span className="text-[9px] text-slate-400 font-normal ml-0.5">
                      ({pctOfTotal}%)
                    </span>
                  </span>
                  <div className="w-full px-1.5 flex items-end justify-center flex-1">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-md transition-all ${bucket.isWin
                        ? "bg-emerald-500/85 group-hover:bg-emerald-600"
                        : "bg-rose-500/80 group-hover:bg-rose-600"
                        }`}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 mt-2 text-center leading-tight">
                    {bucket.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Progressive Exposure & Drawdown Rules */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Equity Curve Feedback Diagnosis
              </h3>
            </div>

            {recent10WinRate >= 50 && recent10AvgR >= 0.4 ? (
              <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>In Sync — Positive Follow-Through</span>
                </div>
                <p className="leading-relaxed text-emerald-800/90">
                  Your last 10 trades show a <strong>{recent10WinRate.toFixed(0)}% batting average</strong> with{" "}
                  <strong>+{recent10AvgR.toFixed(2)}R</strong> average return. Setups are working; standard full position sizing (1.0%–1.25% account risk) is supported.
                </p>
              </div>
            ) : recent10WinRate >= 35 ? (
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Mixed Rhythm — Selective Sizing</span>
                </div>
                <p className="leading-relaxed text-amber-800/90">
                  Your last 10 trades show a <strong>{recent10WinRate.toFixed(0)}% win rate</strong>. Tighten entry criteria and consider scaling risk down to 0.5%–0.75% per trade until new highs resume.
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200 text-xs text-rose-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-rose-800">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Defensive Mode — Protect Capital</span>
                </div>
                <p className="leading-relaxed text-rose-800/90">
                  Recent trades are experiencing low follow-through ({recent10WinRate.toFixed(0)}% win rate). Throttle back to pilot positions (0.5% risk) and avoid forcing trades during drawdown.
                </p>
              </div>
            )}

            <div className="text-xs text-slate-600 space-y-1.5 pt-1">
              <div className="font-semibold text-slate-800">
                Drawdown Control Rules:
              </div>
              <ul className="space-y-1 text-[11px] text-slate-500 list-disc pl-4">
                <li>
                  Never increase position size during a drawdown to &ldquo;make it back faster.&rdquo;
                </li>
                <li>
                  Keep losses contained near <strong>-1.0R</strong>; outliers in the <strong>&lt; -2R</strong> bucket indicate late stops or gap risk.
                </li>
                <li>
                  Scale up exposure progressively only as closed profits push your equity curve to new high-water marks.
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Evaluated Trades: {sortedTrades.length}</span>
            <span>Hover charts to inspect individual trades</span>
          </div>
        </div>
      </div>
    </div>
  );
}

