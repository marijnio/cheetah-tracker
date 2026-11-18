"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Calculator,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Trash2,
  LineChart,
  Wallet,
} from "lucide-react";
import type { ComputedTrade } from "@/lib/trade-math";
import type { TrimTradeInput } from "@/lib/client-portfolio-store";
import type {
  NewTradeInput,
  SecurityRecord,
  ForexPairRecord,
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

interface TradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: NewTradeInput, tradeId?: number) => Promise<void>;
  onTrim?: (tradeId: number, data: TrimTradeInput) => Promise<void>;
  onDeleteTrade?: (trade: ComputedTrade) => Promise<void>;
  initialTrade?: ComputedTrade | null;
  preselectedSecurity?: SecurityRecord | null;
  initialSizing?: {
    securityId?: number;
    shares?: number;
    buyPrice?: number;
    initialStopLoss?: number;
    fxRateToEur?: number;
  } | null;
  securities: SecurityRecord[];
  forexPairs: ForexPairRecord[];
  cashBalance?: number;
  mode?: "create" | "edit" | "close" | "trim";
  onNavigateToSecurities?: () => void;
  onOpenPositionSizer?: (params?: {
    securityId?: number;
    buyPrice?: number;
    initialStopLoss?: number;
  }) => void;
}

export function TradeModal({
  isOpen,
  onClose,
  onSubmit,
  onTrim,
  onDeleteTrade,
  initialTrade,
  preselectedSecurity,
  initialSizing,
  securities,
  forexPairs,
  cashBalance,
  mode = "create",
  onNavigateToSecurities,
  onOpenPositionSizer,
}: TradeModalProps) {
  const [selectedSecurityId, setSelectedSecurityId] = useState<string>("");
  const [ticker, setTicker] = useState("");
  const [gicsSector, setGicsSector] = useState("Information Technology");
  const [currency, setCurrency] = useState("USD");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState("");
  const [shares, setShares] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [initialStopLoss, setInitialStopLoss] = useState("");
  const [manualLatestPrice, setManualLatestPrice] = useState("");
  const [entryFxRateToEur, setEntryFxRateToEur] = useState("0.89338");
  const [fxRateToEur, setFxRateToEur] = useState("0.89338");
  const [stopMoved, setStopMoved] = useState(false);
  const [trimmedAt2R, setTrimmedAt2R] = useState(false);
  const [deductFromCash, setDeductFromCash] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fetchingEntryFx, setFetchingEntryFx] = useState(false);
  const [fetchingFx, setFetchingFx] = useState(false);
  const [lookingUpYahoo, setLookingUpYahoo] = useState(false);

  const getFxRateForCurrency = (ccy: string): number => {
    const upper = ccy.toUpperCase();
    if (upper === "EUR") return 1.0;
    const match = forexPairs.find((f) => f.fromCurrency === upper);
    return match ? match.latestRate : 0.89338;
  };

  useEffect(() => {
    if (!isOpen) return;
    setDeductFromCash(!initialTrade && mode === "create");
    if (initialTrade) {
      setSelectedSecurityId(
        initialTrade.securityId ? String(initialTrade.securityId) : "NEW"
      );
      setTicker(initialTrade.ticker);
      setGicsSector(initialTrade.gicsSector || "Information Technology");
      setCurrency(initialTrade.currency || "USD");
      setStartDate(initialTrade.startDate);
      setEndDate(
        (mode === "close" || mode === "trim") && !initialTrade.endDate
          ? new Date().toISOString().slice(0, 10)
          : initialTrade.endDate || ""
      );
      setShares(
        mode === "trim"
          ? String(
              initialTrade.shares >= 2
                ? Math.floor(initialTrade.shares / 2)
                : Number((initialTrade.shares / 2).toFixed(4))
            )
          : String(initialTrade.shares)
      );
      setBuyPrice(String(initialTrade.buyPrice));
      setSellPrice(
        initialTrade.sellPrice !== null && initialTrade.sellPrice !== undefined
          ? String(initialTrade.sellPrice)
          : mode === "close" || mode === "trim"
            ? String(initialTrade.latestPrice)
            : ""
      );
      setInitialStopLoss(String(initialTrade.initialStopLoss));
      setManualLatestPrice(
        initialTrade.manualLatestPrice !== null &&
          initialTrade.manualLatestPrice !== undefined
          ? String(initialTrade.manualLatestPrice)
          : ""
      );
      setEntryFxRateToEur(
        String(
          initialTrade.entryFxRateToEur ??
          initialTrade.entryRateToEur ??
          initialTrade.fxRateToEur ??
          1.0
        )
      );
      setFxRateToEur(
        String(
          (mode === "close" || mode === "trim") && !initialTrade.endDate
            ? initialTrade.rateToEur ??
            getFxRateForCurrency(initialTrade.currency || "USD")
            : initialTrade.fxRateToEur ?? 1.0
        )
      );
      setStopMoved(
        mode === "trim"
          ? initialTrade.stopMoved || initialTrade.rMultiple >= 2
          : initialTrade.stopMoved
      );
      setTrimmedAt2R(mode === "trim" ? true : initialTrade.trimmedAt2R);
      setNotes(initialTrade.notes || "");
    } else if (initialSizing) {
      const sec = initialSizing.securityId
        ? securities.find((s) => s.id === initialSizing.securityId)
        : null;
      if (sec) {
        const rateStr = String(
          initialSizing.fxRateToEur ?? getFxRateForCurrency(sec.currency)
        );
        setSelectedSecurityId(String(sec.id));
        setTicker(sec.ticker);
        setGicsSector(sec.gicsSector);
        setCurrency(sec.currency);
        setEntryFxRateToEur(rateStr);
        setFxRateToEur(rateStr);
      }
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate("");
      setShares(initialSizing.shares ? String(initialSizing.shares) : "");
      setBuyPrice(initialSizing.buyPrice ? String(initialSizing.buyPrice) : "");
      setSellPrice("");
      setInitialStopLoss(
        initialSizing.initialStopLoss ? String(initialSizing.initialStopLoss) : ""
      );
      setManualLatestPrice(
        initialSizing.buyPrice ? String(initialSizing.buyPrice) : ""
      );
      setStopMoved(false);
      setTrimmedAt2R(false);
      setNotes("");
    } else if (preselectedSecurity) {
      const rateStr = String(getFxRateForCurrency(preselectedSecurity.currency));
      setSelectedSecurityId(String(preselectedSecurity.id));
      setTicker(preselectedSecurity.ticker);
      setGicsSector(preselectedSecurity.gicsSector);
      setCurrency(preselectedSecurity.currency);
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate("");
      setShares("");
      const priceStr =
        preselectedSecurity.latestPrice !== null
          ? String(preselectedSecurity.latestPrice)
          : "";
      setBuyPrice(priceStr);
      setSellPrice("");
      setInitialStopLoss(
        preselectedSecurity.latestPrice
          ? (preselectedSecurity.latestPrice * 0.94).toFixed(2)
          : ""
      );
      setManualLatestPrice(priceStr);
      setEntryFxRateToEur(rateStr);
      setFxRateToEur(rateStr);
      setStopMoved(false);
      setTrimmedAt2R(false);
      setNotes("");
    } else {
      const firstSec = securities[0];
      if (firstSec) {
        const rateStr = String(getFxRateForCurrency(firstSec.currency));
        setSelectedSecurityId(String(firstSec.id));
        setTicker(firstSec.ticker);
        setGicsSector(firstSec.gicsSector);
        setCurrency(firstSec.currency);
        setStartDate(new Date().toISOString().slice(0, 10));
        setEndDate("");
        setShares("");
        const priceStr = firstSec.latestPrice !== null ? String(firstSec.latestPrice) : "";
        setBuyPrice(priceStr);
        setSellPrice("");
        setInitialStopLoss(
          firstSec.latestPrice ? (firstSec.latestPrice * 0.94).toFixed(2) : ""
        );
        setManualLatestPrice(priceStr);
        setEntryFxRateToEur(rateStr);
        setFxRateToEur(rateStr);
      } else {
        setSelectedSecurityId("");
        setTicker("");
        setGicsSector("Information Technology");
        setCurrency("USD");
        setStartDate(new Date().toISOString().slice(0, 10));
        setEndDate("");
        setShares("");
        setBuyPrice("");
        setSellPrice("");
        setInitialStopLoss("");
        setManualLatestPrice("");
        setEntryFxRateToEur("1.0");
        setFxRateToEur("1.0");
      }
      setStopMoved(false);
      setTrimmedAt2R(false);
      setNotes("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTrade, preselectedSecurity, initialSizing, mode]);

  if (!isOpen) return null;

  const handleSelectSecurity = (val: string) => {
    setSelectedSecurityId(val);
    if (!val) return;
    const sec = securities.find((s) => String(s.id) === val);
    if (sec) {
      const rateStr = String(getFxRateForCurrency(sec.currency));
      setTicker(sec.ticker);
      setGicsSector(sec.gicsSector);
      setCurrency(sec.currency);
      setEntryFxRateToEur(rateStr);
      setFxRateToEur(rateStr);
      if (!initialTrade && sec.latestPrice !== null) {
        setBuyPrice(String(sec.latestPrice));
        setInitialStopLoss((sec.latestPrice * 0.94).toFixed(2));
        setManualLatestPrice(String(sec.latestPrice));
      }
    }
  };

  const handleTickerChange = (val: string) => {
    setTicker(val);
    const exactMatch = securities.find(
      (s) => s.ticker.toUpperCase() === val.trim().toUpperCase()
    );
    if (exactMatch) {
      const rateStr = String(getFxRateForCurrency(exactMatch.currency));
      setSelectedSecurityId(String(exactMatch.id));
      setGicsSector(exactMatch.gicsSector);
      setCurrency(exactMatch.currency);
      setEntryFxRateToEur(rateStr);
      setFxRateToEur(rateStr);
      return;
    }

    setSelectedSecurityId("NEW");
    if (val.includes(":") || val.toUpperCase() === "VWS") {
      const mapped = mapToYahooTicker(val);
      if (mapped.inferredCurrency && mapped.inferredCurrency !== currency) {
        const rateStr = String(getFxRateForCurrency(mapped.inferredCurrency));
        setCurrency(mapped.inferredCurrency);
        setEntryFxRateToEur(rateStr);
        setFxRateToEur(rateStr);
      }
    }
  };

  const handleCurrencyChange = (nextCcy: string) => {
    const rateStr = String(getFxRateForCurrency(nextCcy));
    setCurrency(nextCcy);
    setEntryFxRateToEur(rateStr);
    setFxRateToEur(rateStr);
  };

  const handleLookupTickerOnYahoo = async () => {
    if (!ticker.trim()) return;
    setLookingUpYahoo(true);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookupSymbol: ticker.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.lookup) {
        const info = data.lookup;
        if (info.gicsSector && info.gicsSector !== "Uncategorized") {
          setGicsSector(info.gicsSector);
        }
        if (info.currency) {
          const rateStr = String(getFxRateForCurrency(info.currency));
          setCurrency(info.currency);
          setEntryFxRateToEur(rateStr);
          setFxRateToEur(rateStr);
        }
        if (info.latestPrice) {
          if (!buyPrice) {
            setBuyPrice(String(info.latestPrice));
            setInitialStopLoss((info.latestPrice * 0.94).toFixed(2));
          }
          setManualLatestPrice(String(info.latestPrice));
        }
      }
    } finally {
      setLookingUpYahoo(false);
    }
  };

  const handleFetchEntryHistoricalFx = async () => {
    if (currency === "EUR") return;
    setFetchingEntryFx(true);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookupHistoricalFx: {
            fromCurrency: currency,
            date: startDate || "latest",
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.rateToEur) {
        setEntryFxRateToEur(String(data.rateToEur));
      }
    } finally {
      setFetchingEntryFx(false);
    }
  };

  const handleFetchHistoricalFx = async () => {
    if (currency === "EUR") return;
    setFetchingFx(true);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lookupHistoricalFx: {
            fromCurrency: currency,
            date: endDate || "latest",
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.rateToEur) {
        setFxRateToEur(String(data.rateToEur));
      }
    } finally {
      setFetchingFx(false);
    }
  };

  const applyDefault6PctStop = () => {
    const bp = Number(buyPrice);
    if (bp > 0) {
      setInitialStopLoss((bp * 0.94).toFixed(2));
    }
  };

  // Live preview math
  const numShares = Number(shares) || 0;
  const numBuy = Number(buyPrice) || 0;
  const numStop = Number(initialStopLoss) || 0;
  const numSellOrLatest =
    Number(sellPrice) || Number(manualLatestPrice) || numBuy;
  const numEntryFx =
    currency === "EUR" ? 1.0 : Number(entryFxRateToEur) || Number(fxRateToEur) || 1.0;
  const numFx = currency === "EUR" ? 1.0 : Number(fxRateToEur) || 1.0;

  const previewEntryLocal = numShares * numBuy;
  const previewEntryEur = previewEntryLocal * numEntryFx;
  const previewLatestLocal = numShares * numSellOrLatest;
  const previewLatestEur = previewLatestLocal * numFx;
  const previewGainEur = previewLatestEur - previewEntryEur;
  const previewRiskPct =
    numBuy > 0 && numStop > 0 ? (numBuy - numStop) / numBuy : 0;
  const previewMoveStopAt = numBuy * (1 + 2 * previewRiskPct);
  const previewGainPct =
    numBuy > 0 ? (numSellOrLatest - numBuy) / numBuy : 0;
  const previewR = previewRiskPct > 0 ? previewGainPct / previewRiskPct : 0;

  const parsedTicker = mapToYahooTicker(ticker || "TICKER", currency);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const selectedSec =
        selectedSecurityId !== "NEW"
          ? securities.find((s) => String(s.id) === selectedSecurityId)
          : null;
      const finalTicker = (
        selectedSec?.ticker ||
        parsedTicker.yahooTicker ||
        ticker.trim()
      ).toUpperCase();

      const resolvedExitFx =
        currency === "EUR" ? 1.0 : Number(fxRateToEur) || 1.0;
      const resolvedEntryFx =
        currency === "EUR"
          ? 1.0
          : Number(entryFxRateToEur) || resolvedExitFx;

      if (mode === "trim" && initialTrade && onTrim) {
        await onTrim(initialTrade.id, {
          trimmedShares: Number(shares),
          trimDate: endDate.trim() || new Date().toISOString().slice(0, 10),
          trimPrice: Number(sellPrice),
          fxRateToEur: resolvedExitFx,
          stopMoved,
          trimmedAt2R: true,
          notes: notes.trim() || null,
        });
        onClose();
        return;
      }

      await onSubmit(
        {
          securityId: selectedSec ? selectedSec.id : null,
          ticker: finalTicker,
          gicsSector,
          currency,
          startDate,
          endDate: endDate.trim() || null,
          shares: Number(shares),
          buyPrice: Number(buyPrice),
          sellPrice: sellPrice.trim() !== "" ? Number(sellPrice) : null,
          initialStopLoss: Number(initialStopLoss),
          manualLatestPrice:
            manualLatestPrice.trim() !== "" ? Number(manualLatestPrice) : null,
          entryFxRateToEur: resolvedEntryFx,
          fxRateToEur: resolvedExitFx,
          stopMoved,
          trimmedAt2R,
          notes: notes.trim() || null,
          deductFromCash: !initialTrade && mode === "create" ? deductFromCash : undefined,
        },
        initialTrade?.id
      );
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-2 sm:p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {mode === "trim"
                ? `Trim Position: ${initialTrade?.ticker}`
                : mode === "close"
                  ? `Close Position: ${initialTrade?.ticker}`
                  : initialTrade
                    ? `Edit Trade: ${initialTrade.ticker}`
                    : "Add Trade"}
            </h2>
                <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>
                    Ticker Symbol:{" "}
                    <span className="font-mono font-semibold text-blue-600">
                      {ticker || parsedTicker.yahooTicker}
                    </span>
                  </span>
                  {(ticker || parsedTicker.yahooTicker) && (
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <a
                        href={resolveTradingViewUrl(
                          ticker || parsedTicker.yahooTicker,
                          securities.find((s) => String(s.id) === selectedSecurityId)
                            ?.tradingViewUrl ?? initialTrade?.tradingViewUrl
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-semibold transition-colors"
                        title="Open chart on TradingView"
                      >
                        <LineChart className="w-3 h-3" />
                        <span>TradingView ↗</span>
                      </a>
                      <a
                        href={resolveYahooFinanceUrl(
                          ticker || parsedTicker.yahooTicker,
                          currency ||
                            securities.find(
                              (s) => String(s.id) === selectedSecurityId
                            )?.currency
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 text-[11px] font-semibold transition-colors"
                        title="Open ticker on Yahoo Finance"
                      >
                        <YahooFinanceIcon className="w-3 h-3" />
                        <span>Yahoo Finance ↗</span>
                      </a>
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className="p-4 sm:p-6 space-y-4 sm:space-y-5 max-h-[85dvh] overflow-y-auto"
          >
            {/* Connected Security Information */}
            {mode === "close" || mode === "trim" ? (
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  {mode === "trim" ? "Trimming Position For" : "Closing Position For"}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-slate-900 font-mono">
                        {ticker}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-700">
                        {currency}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        {gicsSector}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Entry: {initialTrade?.shares ?? shares} shares @ {currency} {buyPrice} (Stop: {currency} {initialStopLoss})
                    </div>
                  </div>
                  <div className="text-right">
                    {mode === "trim" && initialTrade ? (
                      <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 font-medium">
                        Splits into closed trim + {Math.max(0, Number((initialTrade.shares - numShares).toFixed(4)))} open shares
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">Security master details are managed under the <strong>Securities</strong> tab</span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-600">
                    Select Existing Security *
                  </label>
                  {onNavigateToSecurities && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigateToSecurities();
                      }}
                      className="text-[11px] text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                    >
                      + Add New Security in Master →
                    </button>
                  )}
                </div>
                <select
                  required
                  value={selectedSecurityId}
                  onChange={(e) => handleSelectSecurity(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  {securities.length === 0 && (
                    <option value="">No securities found. Please add a security first.</option>
                  )}
                  {securities.map((sec) => (
                    <option key={sec.id} value={String(sec.id)}>
                      {sec.ticker} — {sec.name} ({sec.currency} • {sec.gicsSector})
                    </option>
                  ))}
                </select>
                {selectedSecurityId && (
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>
                      Currency: <strong className="text-slate-800">{currency}</strong> • Sector: <strong className="text-slate-800">{gicsSector}</strong>
                    </span>
                    <span>Symbol: <strong className="font-mono text-blue-600">{ticker}</strong></span>
                  </div>
                )}
              </div>
            )}

            {/* Row 2: Shares, Buy Price, Initial Stop Loss */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    {mode === "trim" ? "Shares to Trim *" : "Shares (Quantity) *"}
                  </label>
                  {mode === "trim" && initialTrade ? (
                    <button
                      type="button"
                      onClick={() =>
                        setShares(
                          String(
                            initialTrade.shares >= 2
                              ? Math.floor(initialTrade.shares / 2)
                              : Number((initialTrade.shares / 2).toFixed(4))
                          )
                        )
                      }
                      className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
                    >
                      50% ({initialTrade.shares >= 2 ? Math.floor(initialTrade.shares / 2) : Number((initialTrade.shares / 2).toFixed(4))})
                    </button>
                  ) : (
                    onOpenPositionSizer && mode !== "close" && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenPositionSizer({
                            securityId: selectedSecurityId
                              ? Number(selectedSecurityId)
                              : undefined,
                            buyPrice: buyPrice ? Number(buyPrice) : undefined,
                            initialStopLoss: initialStopLoss
                              ? Number(initialStopLoss)
                              : undefined,
                          })
                        }
                        className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                        title="Open Risk-First Position Sizing Calculator"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                        <span>Risk Sizer</span>
                      </button>
                    )
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  required
                  min={mode === "trim" ? "0.0001" : undefined}
                  max={mode === "trim" && initialTrade ? String(initialTrade.shares) : undefined}
                  placeholder="100"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-blue-600"
                />
                {mode === "trim" && initialTrade && (numShares <= 0 || numShares >= initialTrade.shares) && (
                  <p className="text-[11px] text-rose-600 mt-1">
                    Must be between 0 and {initialTrade.shares} shares.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Buy Price ({currency}) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  disabled={mode === "trim"}
                  placeholder="150.00"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    Initial Stop Loss *
                  </label>
                  {mode !== "trim" && (
                    <button
                      type="button"
                      onClick={applyDefault6PctStop}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Calculator className="w-3 h-3" /> -6% Stop
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  required
                  disabled={mode === "trim"}
                  placeholder="141.00"
                  value={initialStopLoss}
                  onChange={(e) => setInitialStopLoss(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {/* Row 3: Dates, Exit/Current Price & Dual FX Rates */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  required
                  disabled={mode === "trim"}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {mode === "trim" ? "Trim Date *" : "End Date "}
                  {mode !== "trim" && <span className="text-slate-400 font-normal">(Open)</span>}
                </label>
                <input
                  type="date"
                  required={mode === "trim"}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {mode === "trim"
                    ? `Trim Price (${currency}) *`
                    : endDate
                      ? `Sell Price (${currency})`
                      : `Latest Price (${currency})`}
                </label>
                {endDate || mode === "trim" ? (
                  <input
                    type="number"
                    step="any"
                    required={mode === "trim"}
                    placeholder="Exit price"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    className="w-full bg-white border border-emerald-400 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-emerald-600"
                  />
                ) : (
                  <div className="space-y-1">
                    <input
                      type="number"
                      step="any"
                      placeholder="Uses Security Quote"
                      value={manualLatestPrice}
                      onChange={(e) => setManualLatestPrice(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-blue-600"
                    />
                    {initialTrade && initialTrade.lastQuoteAt && (
                      (() => {
                        const age = getQuoteAgeInfo(initialTrade.lastQuoteAt);
                        return age.isDaysOld ? (
                          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>
                              Quote is {age.label} ({age.fullDate}) — Stale
                            </span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>Quote updated: {age.label}</span>
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Row 3b: Entry FX (Start Date) & Exit/Current FX (End Date / Live) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    Entry FX Rate to € <span className="text-slate-400 font-normal">({startDate || "Start"})</span>
                  </label>
                  {currency !== "EUR" && (
                    <button
                      type="button"
                      disabled={fetchingEntryFx}
                      onClick={handleFetchEntryHistoricalFx}
                      title={`Fetch official ECB exchange rate for Start Date (${startDate || "latest"})`}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-2.5 h-2.5 ${fetchingEntryFx ? "animate-spin" : ""}`}
                      />
                      ECB ({startDate || "Start"})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  disabled={currency === "EUR"}
                  value={currency === "EUR" ? "1.0" : entryFxRateToEur}
                  onChange={(e) => setEntryFxRateToEur(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    {endDate ? "Exit FX Rate to €" : "Current FX Rate to €"}{" "}
                    <span className="text-slate-400 font-normal">
                      ({endDate ? endDate : "Live"})
                    </span>
                  </label>
                  {currency !== "EUR" && (
                    <button
                      type="button"
                      disabled={fetchingFx}
                      onClick={handleFetchHistoricalFx}
                      title={`Fetch official ECB exchange rate for ${endDate || "latest"}`}
                      className="text-[11px] font-medium text-blue-600 hover:text-blue-700 flex items-center gap-0.5 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-2.5 h-2.5 ${fetchingFx ? "animate-spin" : ""}`}
                      />
                      ECB ({endDate || "Latest"})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="any"
                  disabled={currency === "EUR"}
                  value={currency === "EUR" ? "1.0" : fxRateToEur}
                  onChange={(e) => setFxRateToEur(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 tabular-nums disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {/* Row 4: Trade Discipline Checkboxes */}
            <div className="flex flex-wrap items-center gap-6 pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={stopMoved}
                  onChange={(e) => setStopMoved(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700 font-medium">
                  Stop Moved to Breakeven / 2R (Done)
                </span>
              </label>

              {mode !== "trim" && (
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={trimmedAt2R}
                    onChange={(e) => setTrimmedAt2R(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-slate-700 font-medium">
                    Trimmed at 2R
                  </span>
                </label>
              )}
            </div>

            {/* Live Trade Math Preview Card */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
              <div>
                <div className="text-slate-400 font-medium uppercase text-[10px]">
                  Entry Value (Start FX)
                </div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">
                  €
                  {previewEntryEur.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-[11px] text-slate-500">
                  {currency}{" "}
                  {previewEntryLocal.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>

              <div>
                <div className="text-slate-400 font-medium uppercase text-[10px]">
                  Initial Risk %
                </div>
                <div
                  className={`text-sm font-bold mt-0.5 ${previewRiskPct > 0.08 ? "text-rose-600" : "text-amber-600"
                    }`}
                >
                  {(previewRiskPct * 100).toFixed(2)}%
                </div>
                <div className="text-[11px] text-slate-500">
                  Disciplined limit: ≤ 6-7%
                </div>
              </div>

              <div>
                <div className="text-slate-400 font-medium uppercase text-[10px]">
                  Move Stop At (2R)
                </div>
                <div className="text-sm font-bold text-blue-600 mt-0.5">
                  {currency} {previewMoveStopAt.toFixed(2)}
                </div>
                <div className="text-[11px] text-slate-500">
                  +{(previewRiskPct * 200).toFixed(1)}% target
                </div>
              </div>

              <div>
                <div className="text-slate-400 font-medium uppercase text-[10px]">
                  Projected R / Net €
                </div>
                <div
                  className={`text-sm font-bold mt-0.5 ${previewR >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                >
                  {previewR >= 0 ? "+" : ""}
                  {previewR.toFixed(2)}R
                </div>
                <div className="text-[11px] text-slate-500">
                  {previewGainEur >= 0 ? "+" : "-"}€
                  {Math.abs(previewGainEur).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  ({(previewGainPct * 100).toFixed(1)}%)
                </div>
              </div>
            </div>

            {/* Cash Balance Deduction (Create Mode) */}
            {!initialTrade && mode === "create" && (
              <div
                className={`rounded-xl border p-3.5 transition-colors ${
                  deductFromCash
                    ? "bg-emerald-50/50 border-emerald-200/80"
                    : "bg-slate-50/70 border-slate-200/80"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={deductFromCash}
                      onChange={(e) => setDeductFromCash(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Deduct entry cost from Cash Balance</span>
                    </span>
                  </label>

                  {cashBalance !== undefined && (
                    <div className="text-xs tabular-nums flex items-center gap-1.5">
                      <span className="text-slate-500">
                        €{Math.round(cashBalance).toLocaleString("en-US")}
                      </span>
                      {deductFromCash && previewEntryEur > 0 && (
                        <>
                          <span className="text-slate-400">→</span>
                          <span
                            className={`font-bold ${
                              previewEntryEur > cashBalance
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            €
                            {Math.round(
                              Math.max(0, cashBalance - previewEntryEur)
                            ).toLocaleString("en-US")}
                          </span>
                          <span className="text-[11px] font-medium text-slate-500">
                            (-€
                            {previewEntryEur.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            )
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {deductFromCash &&
                  cashBalance !== undefined &&
                  previewEntryEur > cashBalance && (
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>
                        Entry cost exceeds available cash — cash balance will be set to €0.
                      </span>
                    </div>
                  )}

                {deductFromCash && endDate && (
                  <div className="mt-1.5 text-[11px] text-slate-500">
                    End date is set (closed trade) — uncheck if logging a past trade that is already reflected in your cash balance.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 pt-2 border-t border-slate-100">
              <div>
                {initialTrade && onDeleteTrade && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={async () => {
                      await onDeleteTrade(initialTrade);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Trade</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    (mode === "trim" &&
                      !!initialTrade &&
                      (numShares <= 0 || numShares >= initialTrade.shares))
                  }
                  className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submitting
                    ? "Saving..."
                    : mode === "trim"
                      ? "Confirm Trim & Split"
                      : mode === "close"
                        ? "Confirm Close Trade"
                        : initialTrade
                          ? "Save Changes"
                          : "Add Trade"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
      );
}
