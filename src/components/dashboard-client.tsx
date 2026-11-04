"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BookOpen,
  Briefcase,
  Layers,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Menu,
  ShieldCheck,
  Pencil,
  Wallet,
} from "lucide-react";
import { KpiCards } from "./kpi-cards";
import { TradeTable } from "./trade-table";
import { TradeModal } from "./trade-modal";
import { PositionSizerModal } from "./position-sizer-modal";
import { EquityCurveView } from "./equity-curve-view";
import { SecuritiesView } from "./securities-view";
import { ForexView } from "./forex-view";
import { AccountEquityModal } from "./account-equity-modal";
import {
  computePortfolioKPIs,
  type ComputedTrade,
  type PortfolioKPIs,
} from "@/lib/sepa-math";
import type {
  NewTradeInput,
  SecurityRecord,
  NewSecurityInput,
  ForexPairRecord,
  NewForexPairInput,
} from "@/lib/db/schema";

interface DashboardClientProps {
  initialTrades: ComputedTrade[];
  initialKpis: PortfolioKPIs;
  initialSecurities: SecurityRecord[];
  initialForexPairs: ForexPairRecord[];
}

type NavSection = "TRADES" | "EQUITY" | "SECURITIES" | "FOREX";
type TradeFilterTab = "ALL" | "OPEN" | "CLOSED" | "TRIMMED";

export function DashboardClient({
  initialTrades,
  initialKpis,
  initialSecurities,
  initialForexPairs,
}: DashboardClientProps) {
  const [trades, setTrades] = useState<ComputedTrade[]>(initialTrades);
  const [globalKpis, setGlobalKpis] = useState<PortfolioKPIs>(initialKpis);
  const [securities, setSecurities] =
    useState<SecurityRecord[]>(initialSecurities);
  const [forexPairs, setForexPairs] =
    useState<ForexPairRecord[]>(initialForexPairs);

  const [activeSection, setActiveSection] = useState<NavSection>("TRADES");
  const [tradeFilter, setTradeFilter] = useState<TradeFilterTab>("ALL");
  const [sectorFilter, setSectorFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [kpiScope, setKpiScope] = useState<"GLOBAL" | "FILTERED">("GLOBAL");

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<ComputedTrade | null>(null);
  const [preselectedSecurity, setPreselectedSecurity] =
    useState<SecurityRecord | null>(null);
  const [initialSizing, setInitialSizing] = useState<{
    securityId?: number;
    shares?: number;
    buyPrice?: number;
    initialStopLoss?: number;
    fxRateToEur?: number;
  } | null>(null);
  const [isPositionSizerOpen, setIsPositionSizerOpen] = useState(false);
  const [sizerParams, setSizerParams] = useState<
    { securityId?: number; buyPrice?: number; initialStopLoss?: number } | undefined
  >(undefined);
  const [modalMode, setModalMode] = useState<"create" | "edit" | "close">(
    "create"
  );
  const [isImporting, setIsImporting] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [anchorValue, setAnchorValue] = useState<number>(50000);
  const [anchorPnl, setAnchorPnl] = useState<number>(initialKpis.totalGainLossEur);
  const [anchorUpdatedAt, setAnchorUpdatedAt] = useState<string | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const loadFromStorage = () => {
        const rawAnchor = localStorage.getItem("cheetah_account_anchor");
        if (rawAnchor) {
          try {
            const parsed = JSON.parse(rawAnchor);
            if (typeof parsed.value === "number" && !isNaN(parsed.value)) {
              setAnchorValue(parsed.value);
              setAnchorPnl(
                typeof parsed.pnlAtSet === "number"
                  ? parsed.pnlAtSet
                  : initialKpis.totalGainLossEur
              );
              setAnchorUpdatedAt(parsed.updatedAt || null);
              return;
            }
          } catch {
            // fallback below
          }
        }
        const savedEquity = localStorage.getItem("cheetah_account_equity");
        if (savedEquity && !isNaN(Number(savedEquity)) && Number(savedEquity) > 0) {
          setAnchorValue(Number(savedEquity));
          setAnchorPnl(initialKpis.totalGainLossEur);
        }
      };

      loadFromStorage();
      window.addEventListener("storage", loadFromStorage);
      return () => window.removeEventListener("storage", loadFromStorage);
    }
  }, [initialKpis.totalGainLossEur]);

  const handleSaveAccountValue = (newAccountValue: number) => {
    const nowIso = new Date().toISOString();
    setAnchorValue(newAccountValue);
    setAnchorPnl(globalKpis.totalGainLossEur);
    setAnchorUpdatedAt(nowIso);
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "cheetah_account_anchor",
        JSON.stringify({
          value: newAccountValue,
          pnlAtSet: globalKpis.totalGainLossEur,
          updatedAt: nowIso,
        })
      );
      localStorage.setItem("cheetah_account_equity", String(newAccountValue));
      window.dispatchEvent(new Event("storage"));
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyServerPayload = (payload: {
    trades?: ComputedTrade[];
    kpis?: PortfolioKPIs;
    securities?: SecurityRecord[];
    forexPairs?: ForexPairRecord[];
  }) => {
    if (payload.trades) setTrades(payload.trades);
    if (payload.kpis) setGlobalKpis(payload.kpis);
    if (payload.securities) setSecurities(payload.securities);
    if (payload.forexPairs) setForexPairs(payload.forexPairs);
  };

  const sectors = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) {
      if (t.gicsSector) set.add(t.gicsSector);
    }
    return Array.from(set).sort();
  }, [trades]);

  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (tradeFilter === "OPEN" && !t.isOpen) return false;
      if (tradeFilter === "CLOSED" && t.isOpen) return false;
      if (tradeFilter === "TRIMMED" && !t.trimmedAt2R) return false;
      if (sectorFilter !== "ALL" && t.gicsSector !== sectorFilter) return false;
      if (searchQuery.trim() !== "") {
        const q = searchQuery.trim().toLowerCase();
        if (
          !t.ticker.toLowerCase().includes(q) &&
          !(t.securityName && t.securityName.toLowerCase().includes(q)) &&
          !t.gicsSector.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [trades, tradeFilter, sectorFilter, searchQuery]);

  const displayedKpis = useMemo(() => {
    if (kpiScope === "GLOBAL" || activeSection !== "TRADES") {
      return globalKpis;
    }
    return computePortfolioKPIs(filteredTrades);
  }, [kpiScope, activeSection, globalKpis, filteredTrades]);

  const handleOpenCreate = () => {
    setEditingTrade(null);
    setPreselectedSecurity(null);
    setInitialSizing(null);
    setModalMode("create");
    setIsModalOpen(true);
  };

  const handleNewTradeForSecurity = (sec: SecurityRecord) => {
    setEditingTrade(null);
    setPreselectedSecurity(sec);
    setInitialSizing(null);
    setModalMode("create");
    setIsModalOpen(true);
  };

  const handleOpenEdit = (
    trade: ComputedTrade,
    mode: "edit" | "close" = "edit"
  ) => {
    setEditingTrade(trade);
    setPreselectedSecurity(null);
    setInitialSizing(null);
    setModalMode(mode);
    setIsModalOpen(true);
  };

  const handleOpenPositionSizer = (params?: {
    securityId?: number;
    buyPrice?: number;
    initialStopLoss?: number;
  }) => {
    setSizerParams(params);
    setIsPositionSizerOpen(true);
  };

  const handleApplySizingToTrade = (sizing: {
    securityId?: number;
    ticker: string;
    currency: string;
    gicsSector?: string;
    shares: number;
    buyPrice: number;
    initialStopLoss: number;
    fxRateToEur: number;
  }) => {
    setIsPositionSizerOpen(false);
    setInitialSizing(sizing);
    setEditingTrade(null);
    setPreselectedSecurity(null);
    setModalMode("create");
    setIsModalOpen(true);
  };

  const handleSaveTrade = async (data: NewTradeInput, tradeId?: number) => {
    const url = tradeId !== undefined ? `/api/trades/${tradeId}` : "/api/trades";
    const method = tradeId !== undefined ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleToggleField = async (
    trade: ComputedTrade,
    field: "stopMoved" | "trimmedAt2R"
  ) => {
    const nextValue = !trade[field];
    const res = await fetch(`/api/trades/${trade.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: nextValue }),
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleDeleteTrade = async (trade: ComputedTrade) => {
    if (!window.confirm(`Delete trade ${trade.ticker} (${trade.startDate})?`)) {
      return;
    }
    const res = await fetch(`/api/trades/${trade.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleCreateSecurity = async (
    data: NewSecurityInput & { syncQuoteNow?: boolean }
  ) => {
    const res = await fetch("/api/securities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleUpdateSecurity = async (
    id: number,
    data: Partial<NewSecurityInput> & { syncQuote?: boolean }
  ) => {
    const res = await fetch(`/api/securities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = await res.json();
    if (res.ok) {
      applyServerPayload(payload);
      if (payload.error) {
        alert(`Quote update notice: ${payload.error}`);
      }
    } else {
      alert(`Failed to update security: ${payload.error || "Unknown error"}`);
    }
  };

  const handleDeleteSecurity = async (sec: SecurityRecord) => {
    if (
      !window.confirm(
        `Delete security ${sec.ticker} (${sec.name})? Existing trades will remain intact.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/securities/${sec.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleCreateForex = async (
    data: NewForexPairInput & { syncNow?: boolean }
  ) => {
    const res = await fetch("/api/forex", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleUpdateForex = async (
    id: number,
    data: Partial<NewForexPairInput> & { syncNow?: boolean }
  ) => {
    const res = await fetch(`/api/forex/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleDeleteForex = async (pair: ForexPairRecord) => {
    if (!window.confirm(`Delete currency pair ${pair.pairLabel}?`)) {
      return;
    }
    const res = await fetch(`/api/forex/${pair.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      applyServerPayload(await res.json());
    }
  };

  const handleBatchSync = async (
    scope: "OPEN_ONLY" | "ALL_SECURITIES" | "FOREX_ONLY"
  ) => {
    setIsSyncingAll(true);
    try {
      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const payload = await res.json();
      if (res.ok) {
        applyServerPayload(payload);
        if (payload.errors && payload.errors.length > 0) {
          const sample = payload.errors
            .slice(0, 3)
            .map((e: { symbol: string; error: string }) => `${e.symbol}: ${e.error}`)
            .join("\n");
          alert(
            `Synced ${payload.syncedSecurities} securities & ${payload.syncedForex} FX pairs.\n\nNotice: ${payload.errors.length} failed:\n${sample}`
          );
        }
      } else {
        alert(`Sync failed: ${payload.error || "Unknown server error"}`);
      }
    } catch (e) {
      alert(`Network error during sync: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSyncingAll(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const replaceExisting = window.confirm(
        "Do you want to REPLACE existing trades with this CSV? (Click Cancel to append instead)"
      );
      const res = await fetch("/api/trades/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent: text, replaceExisting }),
      });
      if (res.ok) {
        applyServerPayload(await res.json());
      }
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleResetToSample = async () => {
    if (
      !window.confirm(
        "Reset database to the original 132 trades from sample-data/SEPA Trading Performance Tracker - Trades.csv?"
      )
    ) {
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch("/api/trades/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useSampleCsv: true, replaceExisting: true }),
      });
      if (res.ok) {
        applyServerPayload(await res.json());
      }
    } finally {
      setIsImporting(false);
    }
  };

  const openCount = trades.filter((t) => t.isOpen).length;
  const closedCount = trades.filter((t) => !t.isOpen).length;
  const trimmedCount = trades.filter((t) => t.trimmedAt2R).length;
  const isPositiveNet = displayedKpis.totalGainLossEur >= 0;
  const pnlSinceAnchor = globalKpis.totalGainLossEur - anchorPnl;
  const currentTotalEquity = Math.max(0, anchorValue + pnlSinceAnchor);
  const cashAvailable = Math.max(
    0,
    currentTotalEquity - displayedKpis.openExposureEur
  );
  const investedPercent =
    currentTotalEquity > 0
      ? (displayedKpis.openExposureEur / currentTotalEquity) * 100
      : 0;
  const cashPercent =
    currentTotalEquity > 0 ? (cashAvailable / currentTotalEquity) * 100 : 0;

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "cheetah_account_equity",
        String(Math.round(currentTotalEquity))
      );
    }
  }, [currentTotalEquity]);

  const navMenuItems = [
    {
      id: "TRADES" as NavSection,
      label: "Trade Ledger",
      icon: BookOpen,
      count: trades.length,
      badgeColor: "bg-blue-50 text-blue-700",
    },
    {
      id: "EQUITY" as NavSection,
      label: "Equity & Drawdown",
      icon: TrendingUp,
      count: closedCount,
      badgeColor: "bg-emerald-50 text-emerald-700",
    },
    {
      id: "SECURITIES" as NavSection,
      label: "Securities Master",
      icon: Briefcase,
      count: securities.length,
      badgeColor: "bg-slate-100 text-slate-600",
    },
    {
      id: "FOREX" as NavSection,
      label: "Forex & Currencies",
      icon: ArrowRightLeft,
      count: forexPairs.length,
      badgeColor: "bg-slate-100 text-slate-600",
    },
  ];

  return (
    <div className="min-h-screen bg-[#f8fafc] flex">
      {/* Hidden File Input for CSV Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Modern Fixed Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200/90 flex flex-col transition-all duration-200 ease-in-out lg:static ${isSidebarCollapsed ? "w-18" : "w-64"
          } ${isMobileSidebarOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0"
          }`}
      >
        {/* App Logo & Title */}
        <div
          className={`h-18 flex items-center border-b border-slate-100 transition-all ${isSidebarCollapsed ? "px-0 justify-center" : "px-4 justify-between"
            }`}
        >
          <div
            className={`flex items-center gap-3 overflow-hidden ${isSidebarCollapsed ? "justify-center w-full" : ""
              }`}
          >
            <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-xs flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.svg"
                alt="Cheetah Logo"
                className="w-10 h-10 object-contain rounded-xl"
              />
            </div>
            {!isSidebarCollapsed && (
              <div className="truncate">
                <div className="font-bold text-sm tracking-tight text-slate-900 leading-tight">
                  Trade Tracker
                </div>
                <div className="text-[11px] text-slate-400 font-medium">
                  Performance Ledger
                </div>
              </div>
            )}
          </div>
          {!isSidebarCollapsed && (
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(true)}
              className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Expand button when sidebar is collapsed */}
        {isSidebarCollapsed && (
          <div className="hidden lg:flex justify-center pt-2">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Expand sidebar"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Sidebar Menu Items */}
        <div className="p-3 space-y-1.5 flex-1">
          <div
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 ${isSidebarCollapsed ? "text-center" : ""
              }`}
          >
            {isSidebarCollapsed ? "•••" : "Menu"}
          </div>

          {navMenuItems.map((item) => {
            const active = activeSection === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveSection(item.id);
                  setIsMobileSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${active
                  ? "bg-blue-50 text-blue-700 font-bold shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  } ${isSidebarCollapsed ? "justify-center px-2" : ""}`}
                title={item.label}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${active ? "text-blue-600" : "text-slate-400"
                    }`}
                />
                {!isSidebarCollapsed && (
                  <>
                    <span className="flex-1 text-left truncate">
                      {item.label}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium tabular-nums ${item.badgeColor}`}
                    >
                      {item.count}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer Info */}
        <div className="p-3 border-t border-slate-100">
          {!isSidebarCollapsed ? (
            <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 space-y-1">
              <div className="font-semibold text-slate-700 flex items-center justify-between">
                <span>Base Currency</span>
                <span className="px-1.5 py-0.2 rounded bg-white border border-slate-200 text-slate-800 font-mono text-[10px]">
                  EUR (€)
                </span>
              </div>
              <div className="text-[10px] text-slate-400">
                132 trades registered
              </div>
            </div>
          ) : (
            <div className="text-center font-mono text-[10px] text-slate-400 py-1">
              EUR
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30">
          <div className="px-4 sm:px-8 pt-5 pb-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              {/* Left: Mobile hamburger + Hero Value */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden cursor-pointer"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
                    <span>
                      {activeSection === "TRADES"
                        ? "Trading Portfolio • Total Account Value"
                        : activeSection === "EQUITY"
                          ? "Performance Analytics • Total Account Value"
                          : activeSection === "SECURITIES"
                            ? "Master Entity Repository • Securities & Quote Feeds"
                            : "Currency Conversion • Live & Historical ECB Feeds"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAccountModalOpen(true)}
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50/80 hover:bg-blue-100 border border-blue-200/80 rounded px-1.5 py-0.2 transition-colors cursor-pointer capitalize tracking-normal"
                      title="Anchored to your current broker account value — auto-adjusts as trade P&L changes. Click to recalibrate anytime."
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      <span>Edit Equity</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setIsAccountModalOpen(true)}
                      suppressHydrationWarning
                      className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 tabular-nums hover:text-blue-600 transition-colors text-left cursor-pointer group"
                      title="Anchored to your broker balance (auto-adjusts with new trade P&L). Click to recalibrate."
                    >
                      €{Math.round(currentTotalEquity).toLocaleString("en-US")}
                    </button>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold tabular-nums ${isPositiveNet
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-rose-50 text-rose-500"
                        }`}
                    >
                      {isPositiveNet ? (
                        <TrendingUp className="w-3.5 h-3.5" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isPositiveNet ? "+" : "-"}€
                        {Math.abs(displayedKpis.totalGainLossEur).toLocaleString(
                          "en-US",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }
                        )}{" "}
                        Total P&amp;L
                      </span>
                    </span>

                    {/* Breakdown: In Trades vs Cash */}
                    <div className="flex items-center gap-2.5 text-xs text-slate-500 font-medium tabular-nums sm:border-l sm:border-slate-200 sm:pl-3">
                      <span title="Capital currently invested in open positions">
                        In Trades:{" "}
                        <strong className="text-slate-800 font-semibold">
                          €{Math.round(displayedKpis.openExposureEur).toLocaleString("en-US")}
                        </strong>{" "}
                        <span className="text-slate-400">({investedPercent.toFixed(1)}%)</span>
                      </span>
                      <span className="text-slate-300">•</span>
                      <span title="Available cash balance for new setups">
                        Cash:{" "}
                        <strong className="text-slate-800 font-semibold">
                          €{Math.round(cashAvailable).toLocaleString("en-US")}
                        </strong>{" "}
                        <span className="text-slate-400">({cashPercent.toFixed(1)}%)</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Action Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                  title="Configure Account Starting Capital & Equity"
                >
                  <Wallet className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden sm:inline">Account</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenPositionSizer()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                  title="Risk-First Position Sizing Calculator"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                  <span>Position Sizer</span>
                </button>

                <button
                  type="button"
                  disabled={isSyncingAll}
                  onClick={() => handleBatchSync("OPEN_ONLY")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
                  title="Sync live quotes & FX rates for open positions from Yahoo Finance"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-blue-600 ${isSyncingAll ? "animate-spin" : ""
                      }`}
                  />
                  <span>{isSyncingAll ? "Syncing..." : "Sync Quotes"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Add Trade</span>
                </button>
              </div>
            </div>

            {/* Sub-header Filter Tabs (Active when in Trade Ledger view) */}
            {activeSection === "TRADES" ? (
              <nav className="flex items-center gap-6 mt-5 -mb-px overflow-x-auto">
                {(
                  [
                    { id: "ALL", label: "Summary (All)", count: trades.length },
                    { id: "OPEN", label: "Open Positions", count: openCount },
                    { id: "CLOSED", label: "Closed Trades", count: closedCount },
                    { id: "TRIMMED", label: "2R Trimmed", count: trimmedCount },
                  ] as const
                ).map((tab) => {
                  const active = tradeFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setTradeFilter(tab.id)}
                      className={`pb-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${active
                        ? "border-blue-600 text-blue-600 font-semibold"
                        : "border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300"
                        }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`text-[11px] px-1.5 py-0.2 rounded-full tabular-nums ${active
                          ? "bg-blue-50 text-blue-600 font-semibold"
                          : "bg-slate-100 text-slate-500"
                          }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </nav>
            ) : (
              <div className="h-3" />
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="p-4 sm:p-8 space-y-6 flex-1">
          {activeSection === "TRADES" && (
            <KpiCards
              kpis={displayedKpis}
              filterLabel={
                kpiScope === "FILTERED"
                  ? `${tradeFilter} (${filteredTrades.length} trades)`
                  : undefined
              }
              onOpenEquityCurve={() => setActiveSection("EQUITY")}
              accountEquity={currentTotalEquity}
            />
          )}

          {activeSection === "EQUITY" ? (
            <EquityCurveView
              trades={trades}
              currentAccountEquity={currentTotalEquity}
              onOpenAccountModal={() => setIsAccountModalOpen(true)}
            />
          ) : activeSection === "SECURITIES" ? (
            <SecuritiesView
              securities={securities}
              onCreateSecurity={handleCreateSecurity}
              onUpdateSecurity={handleUpdateSecurity}
              onDeleteSecurity={handleDeleteSecurity}
              onSyncAllSecurities={(scope) => handleBatchSync(scope)}
              onNewTradeForSecurity={handleNewTradeForSecurity}
              isSyncingAll={isSyncingAll}
            />
          ) : activeSection === "FOREX" ? (
            <ForexView
              forexPairs={forexPairs}
              onCreateForex={handleCreateForex}
              onUpdateForex={handleUpdateForex}
              onDeleteForex={handleDeleteForex}
              onSyncAllForex={() => handleBatchSync("FOREX_ONLY")}
              isSyncingAll={isSyncingAll}
            />
          ) : (
            <TradeTable
              trades={filteredTrades}
              securities={securities}
              onToggleField={handleToggleField}
              onEditTrade={handleOpenEdit}
              onDeleteTrade={handleDeleteTrade}
              onUpdateQuote={async (secId, price, provider) => {
                await handleUpdateSecurity(secId, {
                  latestPrice: price,
                  ...(provider ? { quoteProvider: provider } : {}),
                });
              }}
              onSyncSecurityQuote={async (secId) => {
                await handleUpdateSecurity(secId, { syncQuote: true });
              }}
              onSyncAllOpenQuotes={() => handleBatchSync("OPEN_ONLY")}
              isSyncingAll={isSyncingAll}
              sectorFilter={sectorFilter}
              onSectorFilterChange={setSectorFilter}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              sectors={sectors}
              kpiScope={kpiScope}
              onToggleKpiScope={() =>
                setKpiScope((prev) => (prev === "GLOBAL" ? "FILTERED" : "GLOBAL"))
              }
              onImportCsvClick={() => fileInputRef.current?.click()}
              onResetSampleClick={handleResetToSample}
              isImporting={isImporting}
            />
          )}
        </main>
      </div>

      <TradeModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setInitialSizing(null);
        }}
        onSubmit={handleSaveTrade}
        initialTrade={editingTrade}
        preselectedSecurity={preselectedSecurity}
        initialSizing={initialSizing}
        securities={securities}
        forexPairs={forexPairs}
        mode={modalMode}
        onNavigateToSecurities={() => setActiveSection("SECURITIES")}
        onOpenPositionSizer={handleOpenPositionSizer}
      />

      <PositionSizerModal
        isOpen={isPositionSizerOpen}
        onClose={() => setIsPositionSizerOpen(false)}
        securities={securities}
        forexPairs={forexPairs}
        onApplyToTrade={handleApplySizingToTrade}
        initialSecurityId={sizerParams?.securityId}
        initialBuyPrice={sizerParams?.buyPrice}
        initialStopLoss={sizerParams?.initialStopLoss}
        onAccountEquityChange={handleSaveAccountValue}
      />

      <AccountEquityModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        currentAccountValue={currentTotalEquity}
        anchorValue={anchorValue}
        pnlSinceAnchor={pnlSinceAnchor}
        anchorUpdatedAt={anchorUpdatedAt}
        onSaveAccountValue={handleSaveAccountValue}
        kpis={globalKpis}
      />
    </div>
  );
}
