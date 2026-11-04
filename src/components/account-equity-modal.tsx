"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Wallet,
  Check,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { PortfolioKPIs } from "@/lib/sepa-math";

interface AccountEquityModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAccountValue: number;
  anchorValue: number;
  pnlSinceAnchor: number;
  anchorUpdatedAt: string | null;
  onSaveAccountValue: (newAccountValue: number) => void;
  kpis: PortfolioKPIs;
}

const PRESET_VALUES = [10000, 25000, 50000, 100000, 250000];

export function AccountEquityModal({
  isOpen,
  onClose,
  currentAccountValue,
  anchorValue,
  pnlSinceAnchor,
  anchorUpdatedAt,
  onSaveAccountValue,
  kpis,
}: AccountEquityModalProps) {
  const [inputVal, setInputVal] = useState<string>(
    String(Math.round(currentAccountValue))
  );

  useEffect(() => {
    if (isOpen) {
      setInputVal(String(Math.round(currentAccountValue)));
    }
}, [isOpen, currentAccountValue]);

if (!isOpen) return null;

const enteredEquity = Math.max(0, Number(inputVal) || 0);
const openExposureEur = kpis.openExposureEur;
const cashAvailable = Math.max(0, enteredEquity - openExposureEur);
const investedPct =
  enteredEquity > 0 ? (openExposureEur / enteredEquity) * 100 : 0;
const cashPct =
  enteredEquity > 0 ? (cashAvailable / enteredEquity) * 100 : 0;

    const handleSave = (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!isNaN(enteredEquity) && enteredEquity >= 0) {
        onSaveAccountValue(Math.round(enteredEquity));
        onClose();
      }
    };

    const formattedAnchorDate = anchorUpdatedAt
      ? new Date(anchorUpdatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
      : null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Current Account Value
                </h2>
                <p className="text-xs text-slate-500">
                  Anchor your live portfolio equity &amp; available cash reserves
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Modal Content */}
                <form onSubmit={handleSave} className="p-6 space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Current Total Account Value (€)
                      </label>
                          {formattedAnchorDate && (
                <span className="text-[11px] text-slate-400">
                  Last calibrated: {formattedAnchorDate} (€{Math.round(anchorValue).toLocaleString("en-US")})
                </span>
              )}
                    </div>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
                          €
                        </span>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={inputVal}
                          onChange={(e) => setInputVal(e.target.value)}
                          className="w-full pl-8 pr-4 py-2.5 text-lg font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 tabular-nums shadow-2xs"
                          placeholder="50000"
                          autoFocus
                        />
                      </div>

                          {/* Quick Presets */}
                          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                            <span className="text-[11px] font-medium text-slate-400 mr-1">
                              Quick set:
                            </span>
                            {PRESET_VALUES.map((amt) => (
                              <button
                                key={amt}
                                type="button"
                                onClick={() => setInputVal(String(amt))}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${Math.round(enteredEquity) === amt
                                    ? "bg-blue-50 border-blue-300 text-blue-700"
                                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                  }`}
                              >
                                €{amt.toLocaleString("en-US")}
                              </button>
                            ))}
                          </div>
                        </div>

                            {/* Live Allocation Breakdown Card */}
                            <div className="bg-slate-50/80 rounded-xl border border-slate-200/80 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                  Portfolio Allocation Preview
                                </span>
                                {Math.abs(pnlSinceAnchor) >= 1 && (
                                  <span
                  className={`text-[11px] font-semibold tabular-nums ${pnlSinceAnchor >= 0 ? "text-emerald-600" : "text-rose-500"
                                      }`}
                                  >
                                    {pnlSinceAnchor >= 0 ? "+" : "-"}€
                                    {Math.abs(pnlSinceAnchor).toLocaleString("en-US", {
                                      maximumFractionDigits: 0,
                                    })}{" "}
                                    trade P&amp;L since last calibration
                                  </span>
              )}
                            </div>

                              <div>
                                <div className="flex items-baseline justify-between">
                                  <span className="text-xs font-bold uppercase text-slate-700">
                                    Total Account Equity:
                                  </span>
                                  <span className="text-lg font-extrabold text-slate-900 tabular-nums">
                                    €{Math.round(enteredEquity).toLocaleString("en-US")}
                                  </span>
                                </div>

                                {/* Progress Bar of Invested vs Cash */}
                                  <div className="mt-2.5 h-2.5 w-full bg-slate-200 rounded-full overflow-hidden flex">
                                    <div
                                      className="bg-blue-600 transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, Math.max(0, investedPct))}%`,
                                      }}
                                      title={`In Trades: ${investedPct.toFixed(1)}%`}
                                    />
                                    <div
                                      className="bg-emerald-500 transition-all duration-300"
                                      style={{
                                        width: `${Math.min(100, Math.max(0, cashPct))}%`,
                                      }}
                                      title={`Cash Available: ${cashPct.toFixed(1)}%`}
                                    />
                                  </div>

                                    <div className="flex items-center justify-between mt-2.5 text-xs font-medium tabular-nums">
                                      <span className="text-slate-600">
                                        <span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1.5" />
                                        In Trades:{" "}
                                        <strong className="text-slate-900">
                                          €{Math.round(openExposureEur).toLocaleString("en-US")}
                                        </strong>{" "}
                                        <span className="text-slate-400">
                                          ({investedPct.toFixed(1)}%)
                                        </span>
                                      </span>
                                      <span className="text-slate-600">
                                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                                        Cash:{" "}
                                        <strong className="text-slate-900">
                                          €{Math.round(cashAvailable).toLocaleString("en-US")}
                                        </strong>{" "}
                                        <span className="text-slate-400">
                                          ({cashPct.toFixed(1)}%)
                                        </span>
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                    {/* Philosophy & How It Works Callout */}
                                    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3.5 space-y-2 text-xs text-slate-600">
                                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                                        <Sparkles className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                        <span>Why we don&apos;t ask for Starting Capital or Cash FX</span>
                                      </div>
                                      <p className="leading-relaxed text-[11px] text-slate-600">
                                        What matters in SEPA trading is <strong>how effective your trades are</strong>—not what money you started with or how idle cash fluctuates with currency rates, dividends, or broker fees.
                                      </p>
                                      <div className="flex items-start gap-2 pt-1 border-t border-blue-100/80 text-[11px] text-slate-500">
                                        <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                                        <span>
                                          Enter your current broker balance once. As you open/close trades or sync live quotes, your <strong>Account Value</strong> and <strong>Cash</strong> adjust automatically. Recalibrate here anytime to absorb FX cash drift or fees.
                                        </span>
                                      </div>
                                    </div>

                                {/* Modal Footer */}
                                <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
                                  <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    className="inline-flex items-center gap-1.5 px-4.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer"
                                  >
                                    <Check className="w-4 h-4 stroke-[2.5]" />
                                    <span>Save Account Value</span>
                                  </button>
                                </div>
                              </form>
                            </div>
                          </div>
                          );
}
