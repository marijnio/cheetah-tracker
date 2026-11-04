"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Wallet,
  Check,
  ShieldCheck,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface AccountEquityModalProps {
  isOpen: boolean;
  onClose: () => void;
  cashBalance: number;
  openExposureEur: number;
  onSaveCashBalance: (newCash: number) => void;
}

const PRESET_VALUES = [5000, 10000, 25000, 50000, 100000];

export function AccountEquityModal({
  isOpen,
  onClose,
  cashBalance,
  openExposureEur,
  onSaveCashBalance,
}: AccountEquityModalProps) {
  const [inputVal, setInputVal] = useState<string>(
    String(Math.round(cashBalance))
  );

  useEffect(() => {
    if (isOpen) {
      setInputVal(String(Math.round(cashBalance)));
    }
  }, [isOpen, cashBalance]);

  if (!isOpen) return null;

  const enteredCash = Math.max(0, Number(inputVal) || 0);
  const totalAccountValue = enteredCash + openExposureEur;
  const investedPct =
    totalAccountValue > 0 ? (openExposureEur / totalAccountValue) * 100 : 0;
  const cashPct =
    totalAccountValue > 0 ? (enteredCash / totalAccountValue) * 100 : 0;

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isNaN(enteredCash) && enteredCash >= 0) {
      onSaveCashBalance(Math.round(enteredCash));
      onClose();
    }
  };

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
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Current Cash Balance
              </h2>
              <p className="text-xs text-slate-500">
                Enter your uninvested cash to compute your live Total Account Value
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
                Current Broker Cash Balance (€)
              </label>
              <span className="text-[11px] text-slate-400">
                Uninvested cash / Settled EUR
              </span>
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
                className="w-full pl-8 pr-4 py-2.5 text-lg font-bold text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 tabular-nums shadow-2xs"
                placeholder="25000"
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
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    Math.round(enteredCash) === amt
                      ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  €{amt.toLocaleString("en-US")}
                </button>
              ))}
            </div>
          </div>

          {/* Live Dynamic Calculation Card */}
          <div className="bg-slate-50/80 rounded-xl border border-slate-200/80 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Live Account Value Formula
              </span>
              <span className="text-[11px] text-slate-500 font-medium">
                Cash + Open Positions
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
              <div>
                <span className="text-slate-400 text-[11px] block">Cash Balance</span>
                <span className="font-semibold text-emerald-600 text-sm">
                  €{Math.round(enteredCash).toLocaleString("en-US")}
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  ({cashPct.toFixed(1)}% of total)
                </span>
              </div>

              <div>
                <span className="text-slate-400 text-[11px] block">In Trades (Open Positions)</span>
                <span className="font-semibold text-blue-600 text-sm">
                  €{Math.round(openExposureEur).toLocaleString("en-US")}
                </span>
                <span className="text-[11px] text-slate-400 block mt-0.5">
                  ({investedPct.toFixed(1)}% of total)
                </span>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-bold uppercase text-slate-700">
                  Total Account Value:
                </span>
                <span className="text-xl font-extrabold text-slate-900 tabular-nums">
                  €{Math.round(totalAccountValue).toLocaleString("en-US")}
                </span>
              </div>

              {/* Progress Bar of Invested vs Cash */}
              <div className="mt-2.5 h-2.5 w-full bg-slate-200 rounded-full overflow-hidden flex">
                <div
                  className="bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(0, cashPct))}%`,
                  }}
                  title={`Cash: ${cashPct.toFixed(1)}%`}
                />
                <div
                  className="bg-blue-600 transition-all duration-300"
                  style={{
                    width: `${Math.min(100, Math.max(0, investedPct))}%`,
                  }}
                  title={`In Trades: ${investedPct.toFixed(1)}%`}
                />
              </div>

              <div className="flex items-center justify-between mt-2.5 text-xs font-medium tabular-nums">
                <span className="text-slate-600">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5" />
                  Cash: <strong>€{Math.round(enteredCash).toLocaleString("en-US")}</strong> ({cashPct.toFixed(1)}%)
                </span>
                <span className="text-slate-600">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-600 mr-1.5" />
                  In Trades: <strong>€{Math.round(openExposureEur).toLocaleString("en-US")}</strong> ({investedPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>

          {/* Why filling in cash is best */}
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3.5 space-y-2 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Why filling in Cash is clean &amp; exact</span>
            </div>
            <p className="leading-relaxed text-[11px] text-slate-600">
              Your broker&apos;s cash balance is a clear, stable number. Unlike total account equity (which constantly changes with tick-by-tick stock quotes), cash only shifts when you open or close positions, receive dividends, or deposit funds.
            </p>
            <div className="flex items-start gap-2 pt-1 border-t border-emerald-100/80 text-[11px] text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                Cheetah Tracker adds your exact cash to your live open positions (<strong>€{Math.round(openExposureEur).toLocaleString("en-US")}</strong>) to dynamically power your <strong>Total Account Value</strong> and <strong>Position Sizing</strong>.
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
              className="inline-flex items-center gap-1.5 px-4.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Save Cash Balance</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
