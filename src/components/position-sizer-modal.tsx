"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  Calculator,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Target,
  Percent,
  CheckCircle2,
  Info,
} from "lucide-react";
import type { SecurityRecord, ForexPairRecord } from "@/lib/db/schema";

interface PositionSizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  securities: SecurityRecord[];
  forexPairs: ForexPairRecord[];
  onApplyToTrade: (sizing: {
    securityId?: number;
    ticker: string;
    currency: string;
    gicsSector?: string;
    shares: number;
    buyPrice: number;
    initialStopLoss: number;
    fxRateToEur: number;
  }) => void;
  initialSecurityId?: number;
  initialBuyPrice?: number;
  initialStopLoss?: number;
  onAccountEquityChange?: (val: number) => void;
}

const RISK_PRESETS = [
  { label: "0.5%", value: 0.5, tag: "Conservative" },
  { label: "1.0%", value: 1.0, tag: "Recommended" },
  { label: "1.25%", value: 1.25, tag: "Disciplined" },
  { label: "2.0%", value: 2.0, tag: "Max Limit" },
];

const STOP_PRESETS = [-4, -5, -6, -7, -8];

export function PositionSizerModal({
  isOpen,
  onClose,
  securities,
  forexPairs,
  onApplyToTrade,
  initialSecurityId,
  initialBuyPrice,
  initialStopLoss,
  onAccountEquityChange,
}: PositionSizerModalProps) {
  // Persisted or default account equity
  const [accountEquity, setAccountEquity] = useState<string>("50000");
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [selectedSecurityId, setSelectedSecurityId] = useState<string>("");
  const [buyPrice, setBuyPrice] = useState<string>("");
  const [stopLoss, setStopLoss] = useState<string>("");

  // Load saved equity from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedEquity = localStorage.getItem("cheetah_account_equity");
      if (savedEquity && !isNaN(Number(savedEquity))) {
        setAccountEquity(savedEquity);
      }
      const savedRisk = localStorage.getItem("cheetah_risk_percent");
      if (savedRisk && !isNaN(Number(savedRisk))) {
        setRiskPercent(Number(savedRisk));
      }
    }
  }, [isOpen]);

  // Save changes to localStorage
  const handleEquityChange = (val: string) => {
    setAccountEquity(val);
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        onAccountEquityChange?.(num);
        if (typeof window !== "undefined") {
          localStorage.setItem("cheetah_account_equity", val);
          window.dispatchEvent(new Event("storage"));
        }
      }
    };

    const handleRiskChange = (val: number) => {
      setRiskPercent(val);
      if (typeof window !== "undefined") {
        localStorage.setItem("cheetah_risk_percent", String(val));
      }
    };

    // Sync inputs when modal opens or initial values change
    useEffect(() => {
      if (!isOpen) return;

      if (initialSecurityId) {
        setSelectedSecurityId(String(initialSecurityId));
        const sec = securities.find((s) => s.id === initialSecurityId);
        if (sec) {
          if (initialBuyPrice) {
            setBuyPrice(String(initialBuyPrice));
          } else if (sec.latestPrice) {
            setBuyPrice(String(sec.latestPrice));
          }
          if (initialStopLoss) {
            setStopLoss(String(initialStopLoss));
          } else if (sec.latestPrice) {
            setStopLoss((sec.latestPrice * 0.94).toFixed(2));
          }
        }
      } else if (securities.length > 0 && !selectedSecurityId) {
        const first = securities[0];
        setSelectedSecurityId(String(first.id));
        if (first.latestPrice) {
          setBuyPrice(String(first.latestPrice));
          setStopLoss((first.latestPrice * 0.94).toFixed(2));
        }
      }
    }, [isOpen, initialSecurityId, initialBuyPrice, initialStopLoss, securities]);

    const activeSecurity = useMemo(() => {
      return securities.find((s) => String(s.id) === selectedSecurityId) || null;
    }, [securities, selectedSecurityId]);

    const currency = activeSecurity?.currency || "USD";

    const fxRateToEur = useMemo(() => {
      if (currency.toUpperCase() === "EUR") return 1.0;
      const match = forexPairs.find(
        (f) => f.fromCurrency.toUpperCase() === currency.toUpperCase()
      );
      return match ? match.latestRate : 0.89338;
    }, [currency, forexPairs]);

    const handleSelectSecurity = (idStr: string) => {
      setSelectedSecurityId(idStr);
      const sec = securities.find((s) => String(s.id) === idStr);
      if (sec && sec.latestPrice) {
        setBuyPrice(String(sec.latestPrice));
        setStopLoss((sec.latestPrice * 0.94).toFixed(2));
      }
    };

    // Calculations
    const equityNum = Number(accountEquity) || 0;
    const buyPriceNum = Number(buyPrice) || 0;
    const stopLossNum = Number(stopLoss) || 0;

    // Max risk allowed in Base Currency (EUR)
    const maxRiskEur = equityNum * (riskPercent / 100);
    // Max risk allowed in Security Currency
    const maxRiskLocal = fxRateToEur > 0 ? maxRiskEur / fxRateToEur : maxRiskEur;

    // Per share risk
    const riskPerShare = Math.max(0, buyPriceNum - stopLossNum);
    const stopDistancePct =
      buyPriceNum > 0 && riskPerShare > 0
        ? (riskPerShare / buyPriceNum) * 100
        : 0;

    // Recommended shares
    const sharesCalculated =
      riskPerShare > 0 ? Math.floor(maxRiskLocal / riskPerShare) : 0;

    // Position totals
    const totalPositionLocal = sharesCalculated * buyPriceNum;
    const totalPositionEur = totalPositionLocal * fxRateToEur;
    const actualRiskLocal = sharesCalculated * riskPerShare;
    const actualRiskEur = actualRiskLocal * fxRateToEur;
    const actualRiskPctOfEquity =
      equityNum > 0 ? (actualRiskEur / equityNum) * 100 : 0;
    const portfolioAllocationPct =
      equityNum > 0 ? (totalPositionEur / equityNum) * 100 : 0;

    // Profit Milestone Targets
    const target1R = buyPriceNum + riskPerShare * 1;
    const target2R = buyPriceNum + riskPerShare * 2;
    const target3R = buyPriceNum + riskPerShare * 3;

    const handleApply = () => {
      if (!activeSecurity || sharesCalculated <= 0) return;
      onApplyToTrade({
        securityId: activeSecurity.id,
        ticker: activeSecurity.ticker,
        currency: activeSecurity.currency,
        gicsSector: activeSecurity.gicsSector,
        shares: sharesCalculated,
        buyPrice: buyPriceNum,
        initialStopLoss: stopLossNum,
        fxRateToEur,
      });
      onClose();
    };

    if (!isOpen) return null;

    return (
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-2xl overflow-hidden flex flex-col my-auto">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between bg-slate-50/70">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <ShieldCheck className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Risk-First Position Sizing
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    Capital Protection
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Calculate precise share quantity and capital allocation before entering a trade
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 sm:p-6 space-y-5 overflow-y-auto max-h-[80vh]">
            {/* Informational Guidance Box */}
            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-xs text-blue-900 flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong className="font-semibold block mb-0.5">
                  Mathematical Risk Discipline:
                </strong>
                Position size must be dictated by your account equity and stop loss distance,
                never by arbitrary round numbers. By fixing your maximum portfolio risk (0.5% – 1.25%),
                a stopped-out trade will never inflict severe damage on your capital.
              </div>
            </div>

            {/* Form Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Target Security */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Target Security
                </label>
                <select
                  value={selectedSecurityId}
                  onChange={(e) => handleSelectSecurity(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                >
                  {securities.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.ticker} — {s.name || s.ticker} ({s.currency} •{" "}
                      {s.latestPrice !== null ? `${s.currency} ${s.latestPrice.toFixed(2)}` : "No price"})
                    </option>
                  ))}
                </select>
              </div>

              {/* Total Account Equity */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Total Account Equity (€)</span>
                  <span className="text-[10px] text-slate-400 font-normal">Base EUR</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs">
                    €
                  </span>
                  <input
                    type="number"
                    min="1000"
                    step="1000"
                    value={accountEquity}
                    onChange={(e) => handleEquityChange(e.target.value)}
                    className="w-full h-10 pl-7 pr-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    placeholder="50000"
                  />
                </div>
              </div>

              {/* Max Risk % per Trade */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Max Account Risk %</span>
                  <span className="text-[10px] text-emerald-600 font-semibold tabular-nums">
                    €{maxRiskEur.toFixed(0)} max risk
                  </span>
                </label>
                <div className="flex items-center gap-1.5">
                  {RISK_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => handleRiskChange(preset.value)}
                      className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${riskPercent === preset.value
                          ? "bg-blue-600 border-blue-600 text-white shadow-xs"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Buy / Entry Price */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Entry Price ({currency})</span>
                  {activeSecurity?.latestPrice && (
                    <button
                      type="button"
                      onClick={() => {
                        if (activeSecurity.latestPrice) {
                          setBuyPrice(String(activeSecurity.latestPrice));
                          setStopLoss((activeSecurity.latestPrice * 0.94).toFixed(2));
                        }
                      }}
                      className="text-[10px] text-blue-600 hover:underline cursor-pointer"
                    >
                      Use latest ({activeSecurity.latestPrice.toFixed(2)})
                    </button>
                  )}
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  placeholder="100.00"
                />
              </div>

              {/* Initial Stop Loss */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                  <span>Stop Loss ({currency})</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${stopDistancePct === 0
                        ? "text-slate-400"
                        : stopDistancePct <= 6.0
                          ? "bg-emerald-50 text-emerald-600"
                          : stopDistancePct <= 8.0
                            ? "bg-amber-50 text-amber-600"
                            : "bg-rose-50 text-rose-600"
                      }`}
                  >
                    {stopDistancePct > 0 ? `-${stopDistancePct.toFixed(1)}%` : "Enter stop"}
                  </span>
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  placeholder="94.00"
                />
                {/* Quick Stop Presets */}
                <div className="flex items-center gap-1 mt-1.5">
                  <span className="text-[10px] text-slate-400 mr-1">Quick:</span>
                  {STOP_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        if (buyPriceNum > 0) {
                          const calculatedStop = buyPriceNum * (1 + pct / 100);
                          setStopLoss(calculatedStop.toFixed(2));
                        }
                      }}
                      className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded transition-colors cursor-pointer"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Warnings / Feedback */}
            {stopDistancePct > 8.0 && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <strong>Wide Stop Warning (-{stopDistancePct.toFixed(1)}%):</strong> A stop loss wider
                  than 7-8% forces a smaller position size and requires a steep gain just to achieve a
                  favorable 2:1 profit-to-loss ratio.
                </div>
              </div>
            )}

            {portfolioAllocationPct > 25.0 && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>High Allocation ({portfolioAllocationPct.toFixed(1)}% of portfolio):</strong> Sizing
                  more than 20–25% in a single stock concentrates portfolio risk. Consider tightening your stop or capping position size.
                </div>
              </div>
            )}

            {/* Calculated Sizing Results Card */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Recommended Execution Sizing
                </span>
                <span className="text-xs font-medium text-slate-500">
                  Currency: <strong className="text-slate-800">{currency}</strong> (FX: {fxRateToEur.toFixed(4)})
                </span>
              </div>

              {/* Primary KPI Row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Recommended Shares */}
                <div className="bg-white p-3.5 rounded-lg border border-slate-200/80 shadow-2xs">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Shares to Buy
                  </span>
                  <div className="text-2xl font-black text-blue-600 mt-0.5 tabular-nums">
                    {sharesCalculated.toLocaleString()}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    @ {currency} {buyPriceNum.toFixed(2)}
                  </span>
                </div>

                {/* Position Allocation */}
                <div className="bg-white p-3.5 rounded-lg border border-slate-200/80 shadow-2xs">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Total Position Value
                  </span>
                  <div className="text-lg font-bold text-slate-900 mt-1 tabular-nums">
                    €{totalPositionEur.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 tabular-nums">
                    {currency} {totalPositionLocal.toLocaleString("en-US", { maximumFractionDigits: 0 })} ({portfolioAllocationPct.toFixed(1)}% of acct)
                  </span>
                </div>

                {/* Capital at Risk */}
                <div className="bg-white p-3.5 rounded-lg border border-slate-200/80 shadow-2xs col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Max Dollar Risk (at Stop)
                  </span>
                  <div className="text-lg font-bold text-rose-600 mt-1 tabular-nums">
                    -€{actualRiskEur.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <span className="text-[11px] font-medium text-rose-500 tabular-nums">
                    {actualRiskPctOfEquity.toFixed(2)}% of account equity
                  </span>
                </div>
              </div>

              {/* Milestone Profit Targets */}
              <div className="pt-2 border-t border-slate-200/60">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-2">
                  Disciplined Profit Milestones (R-Multiples)
                </span>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-white border border-slate-200/60">
                    <span className="text-[10px] text-slate-400 block font-semibold">1R (Breakeven Trail)</span>
                    <span className="text-xs font-bold text-slate-800 tabular-nums">
                      {currency} {target1R > 0 ? target1R.toFixed(2) : "—"}
                    </span>
                    <span className="text-[10px] text-slate-400 block">+{stopDistancePct.toFixed(1)}%</span>
                  </div>
                  <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                    <span className="text-[10px] text-emerald-700 block font-bold">2R (Take-Profit Trim)</span>
                    <span className="text-xs font-bold text-emerald-800 tabular-nums">
                      {currency} {target2R > 0 ? target2R.toFixed(2) : "—"}
                    </span>
                    <span className="text-[10px] text-emerald-600 block">+{(stopDistancePct * 2).toFixed(1)}%</span>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
                    <span className="text-[10px] text-blue-700 block font-bold">3R (Runner Target)</span>
                    <span className="text-xs font-bold text-blue-800 tabular-nums">
                      {currency} {target3R > 0 ? target3R.toFixed(2) : "—"}
                    </span>
                    <span className="text-[10px] text-blue-600 block">+{(stopDistancePct * 3).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={sharesCalculated <= 0}
              onClick={handleApply}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>Apply to Trade</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }
