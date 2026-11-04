"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  Sliders,
} from "lucide-react";
import type { ComputedTrade } from "@/lib/sepa-math";
import type { SecurityRecord, QuoteProviderType } from "@/lib/db/schema";
import { getQuoteAgeInfo } from "@/lib/quote-age";

interface QuickQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  trade: ComputedTrade | null;
  security: SecurityRecord | null;
  onSaveQuote: (
    securityId: number,
    latestPrice: number,
    quoteProvider?: QuoteProviderType
  ) => Promise<void>;
  onSyncLiveQuote?: (securityId: number) => Promise<void>;
}

export function QuickQuoteModal({
  isOpen,
  onClose,
  trade,
  security,
  onSaveQuote,
  onSyncLiveQuote,
}: QuickQuoteModalProps) {
  const [priceInput, setPriceInput] = useState("");
  const [quoteProvider, setQuoteProvider] =
    useState<QuoteProviderType>("YAHOO");
  const [isSaving, setIsSaving] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<{
    text: string;
    isError?: boolean;
    price?: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen && trade) {
      const currentPrice =
        security?.latestPrice ??
        trade.latestPrice ??
        trade.manualLatestPrice ??
        trade.buyPrice;
      setPriceInput(currentPrice ? String(currentPrice) : "");
      setQuoteProvider(
        security?.quoteProvider ?? trade.quoteProvider ?? "YAHOO"
      );
      setLookupMessage(null);
    }
  }, [isOpen, trade, security]);

  if (!isOpen || !trade) return null;

  const currency = trade.currency || security?.currency || "USD";
  const ticker = trade.ticker;
  const name = security?.name || trade.securityName || trade.ticker;
  const lastQuoteAt = security?.lastQuoteAt ?? trade.lastQuoteAt;
  const ageInfo = getQuoteAgeInfo(lastQuoteAt);

  const handleFetchFromYahoo = async () => {
    setIsLookingUp(true);
    setLookupMessage(null);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookupSymbol: ticker }),
      });
      const data = await res.json();
      if (res.ok && data.lookup && data.lookup.latestPrice) {
        const fetchedPrice = Number(data.lookup.latestPrice);
        setPriceInput(String(fetchedPrice));
        setLookupMessage({
          text: `Fetched live price: ${currency} ${fetchedPrice.toLocaleString(
            "en-US",
            { minimumFractionDigits: 2 }
          )} from Yahoo Finance (${ticker})`,
          price: fetchedPrice,
        });
      } else {
        setLookupMessage({
          text: data.error || "Could not fetch quote from Yahoo Finance",
          isError: true,
        });
      }
    } catch {
      setLookupMessage({
        text: "Network error while contacting Yahoo Finance",
        isError: true,
      });
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleDirectSync = async () => {
    if (!security || !onSyncLiveQuote) return;
    setIsSyncing(true);
    try {
      await onSyncLiveQuote(security.id);
      onClose();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numPrice = Number(priceInput);
    if (isNaN(numPrice) || numPrice <= 0) {
      alert("Please enter a valid positive quote price");
      return;
    }

    const secId = security?.id ?? trade.securityId;
    if (!secId) {
      alert("Error: Security record not found for this trade");
      return;
    }

    setIsSaving(true);
    try {
      await onSaveQuote(secId, numPrice, quoteProvider);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                Update Quote: {ticker}
              </h3>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold text-[10px]">
                OPEN TRADE
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs sm:max-w-md">
              {name} • {trade.gicsSector} • {currency}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Recency Banner */}
          {ageInfo.isDaysOld ? (
            <div className="bg-amber-50 border border-amber-200/90 rounded-xl p-3.5 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <span className="font-semibold block text-amber-900">
                  Quote is {ageInfo.label} (Stale)
                </span>
                <span>
                  Last recorded on {ageInfo.fullDate}. Since this quote is days
                  old, refresh it from Yahoo Finance or enter the current market
                  price to keep your P&amp;L and R-multiples accurate.
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Last recorded:{" "}
                  <strong className="text-slate-800 font-semibold">
                    {ageInfo.label}
                  </strong>{" "}
                  <span className="text-slate-400">({ageInfo.fullDate})</span>
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active
              </span>
            </div>
          )}

          {/* Yahoo Auto-Fetch Shortcut */}
          <div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                Quote Ticker:{" "}
                <code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 font-mono text-[11px]">
                  {ticker}
                </code>
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Fetch the live market quote directly from Yahoo Finance.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isLookingUp || isSyncing}
                onClick={handleFetchFromYahoo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isLookingUp ? "Fetching..." : "Fetch Quote"}</span>
              </button>

              {security && onSyncLiveQuote && (
                <button
                  type="button"
                  disabled={isSyncing || isLookingUp}
                  onClick={handleDirectSync}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                  title="Immediately sync and save latest quote from Yahoo"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-blue-600" : ""
                      }`}
                  />
                  <span>{isSyncing ? "Syncing..." : "Sync & Apply"}</span>
                </button>
              )}
            </div>
          </div>

          {lookupMessage && (
            <div
              className={`text-xs rounded-lg px-3 py-2 border ${lookupMessage.isError
                  ? "bg-rose-50 text-rose-700 border-rose-200"
                  : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }`}
            >
              {lookupMessage.text}
            </div>
          )}

          {/* Manual Price Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-700">
                Latest Market Price ({currency}) *
              </label>
              <span className="text-[11px] text-slate-400">
                Trade Buy Price: {currency} {trade.buyPrice}
              </span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                required
                autoFocus
                placeholder="e.g. 142.50"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg pl-3 pr-16 py-2.5 text-base font-semibold tabular-nums text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">
                {currency}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Saving this quote will immediately update open position metrics,
              gain/loss %, R-multiples, and portfolio KPIs.
            </p>
          </div>

          {/* Quote Provider Selection */}
          <div className="pt-1">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Quote Source Preference
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setQuoteProvider("YAHOO")}
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${quoteProvider === "YAHOO"
                    ? "border-blue-600 bg-blue-50/50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
              >
                <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Yahoo Finance</div>
                  <div className="text-[10px] text-slate-500">
                    Syncs automatically on batch refresh
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setQuoteProvider("MANUAL")}
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${quoteProvider === "MANUAL"
                    ? "border-blue-600 bg-blue-50/50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
              >
                <Sliders className="w-4 h-4 text-slate-600 shrink-0" />
                <div>
                  <div className="text-xs font-semibold">Manual Only</div>
                  <div className="text-[10px] text-slate-500">
                    Lock to manually entered quotes
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? "Saving..." : "Save Quote"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

