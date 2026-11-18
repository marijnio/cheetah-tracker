"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BookOpen,
  Briefcase,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  ShieldCheck,
  Pencil,
  Settings,
  LogOut,
  CheckCircle2,
} from "lucide-react";
import { KpiCards } from "./kpi-cards";
import { TradeTable } from "./trade-table";
import { TradeModal } from "./trade-modal";
import { PositionSizerModal } from "./position-sizer-modal";
import { EquityCurveView } from "./equity-curve-view";
import { SecuritiesView } from "./securities-view";
import { ForexView } from "./forex-view";
import { SettingsView } from "./settings-view";
import { AccountEquityModal } from "./account-equity-modal";
import { AboutModal } from "./about-modal";
import { APP_VERSION, APP_BUILD_LABEL } from "@/lib/version";
import {
  computePortfolioKPIs,
  type ComputedTrade,
  type PortfolioKPIs,
} from "@/lib/trade-math";
import type {
  PublicUser,
  NewTradeInput,
  SecurityRecord,
  NewSecurityInput,
  ForexPairRecord,
  NewForexPairInput,
} from "@/lib/db/schema";
import {
  serializePortfolioToXml,
  parsePortfolioXml,
} from "@/lib/portfolio-xml";
import type { TrimTradeInput } from "@/lib/client-portfolio-store";

interface DashboardClientProps {
  currentUser: PublicUser;
  initialTrades: ComputedTrade[];
  initialKpis: PortfolioKPIs;
  initialSecurities: SecurityRecord[];
  initialForexPairs: ForexPairRecord[];
}

type NavSection = "TRADES" | "EQUITY" | "SECURITIES" | "FOREX" | "SETTINGS";
type TradeFilterTab = "OPEN" | "ALL" | "CLOSED" | "TRIMMED";

export function DashboardClient({
  currentUser,
  initialTrades,
  initialKpis,
  initialSecurities,
  initialForexPairs,
}: DashboardClientProps) {
  const router = useRouter();
  const [trades, setTrades] = useState<ComputedTrade[]>(initialTrades);
  const [globalKpis, setGlobalKpis] = useState<PortfolioKPIs>(initialKpis);
  const [securities, setSecurities] =
    useState<SecurityRecord[]>(initialSecurities);
  const [forexPairs, setForexPairs] =
    useState<ForexPairRecord[]>(initialForexPairs);

  const [activeSection, setActiveSection] = useState<NavSection>("TRADES");
  const [tradeFilter, setTradeFilter] = useState<TradeFilterTab>("OPEN");
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
  const [modalMode, setModalMode] = useState<"create" | "edit" | "close" | "trim">(
    "create"
  );
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [cashBalance, setCashBalance] = useState<number>(currentUser.cashBalance);
  const [riskPercent, setRiskPercent] = useState<number>(currentUser.riskPercent);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const flashNotification = (msg: string) => {
    setNotificationMsg(msg);
    setTimeout(() => {
      setNotificationMsg((curr) => (curr === msg ? null : curr));
    }, 4500);
  };

  const applyServerPayload = (data: {
    trades?: ComputedTrade[];
    kpis?: PortfolioKPIs;
    securities?: SecurityRecord[];
    forexPairs?: ForexPairRecord[];
    user?: PublicUser;
  }) => {
    if (data.trades) setTrades(data.trades);
    if (data.kpis) setGlobalKpis(data.kpis);
    if (data.securities) setSecurities(data.securities);
    if (data.forexPairs) setForexPairs(data.forexPairs);
    if (data.user) {
      setCashBalance(data.user.cashBalance);
      setRiskPercent(data.user.riskPercent);
      if (typeof window !== "undefined") {
        localStorage.setItem(
          "cheetah_cash_balance",
          String(data.user.cashBalance)
        );
      }
    }
  };

  const handleSaveCashBalance = async (newCash: number) => {
    setCashBalance(newCash);
    try {
      const res = await fetch("/api/portfolio/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashBalance: newCash }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save cash balance");
      }
      if (typeof window !== "undefined") {
        const total = newCash + displayedKpis.openExposureEur;
        localStorage.setItem("cheetah_cash_balance", String(newCash));
        localStorage.setItem("cheetah_account_equity", String(Math.round(total)));
        window.dispatchEvent(new Event("storage"));
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save cash balance");
    }
  };

  const handleAccountEquityChangeFromSizer = (newTotal: number) => {
    const newCash = Math.max(0, newTotal - displayedKpis.openExposureEur);
    handleSaveCashBalance(newCash);
  };

  const handleExportXml = () => {
    const xmlString = serializePortfolioToXml(
      {
        cashBalance,
        riskPercent,
        trades,
        securities,
        forexPairs,
      },
      APP_VERSION
    );
    const dateStamp = new Date().toISOString().slice(0, 10);
    const safeFileName = `cheetah-portfolio-${currentUser.username}-${dateStamp}.xml`;
    const blob = new Blob([xmlString], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    flashNotification(`Exported "${safeFileName}".`);
  };

  const handleImportXmlFile = async (file: File) => {
    const xmlContent = await file.text();
    const parsed = parsePortfolioXml(xmlContent, file.name);
    const res = await fetch("/api/portfolio/import-xml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cashBalance: parsed.cashBalance,
        riskPercent: parsed.riskPercent,
        trades: parsed.trades,
        securities: parsed.securities,
        forexPairs: parsed.forexPairs,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Import failed: ${data.error || "Unknown error"}`);
      return;
    }
    applyServerPayload(data);
    flashNotification(
      `Imported "${file.name}" (${data.importedCount ?? 0} trades).`
    );
  };

  const handleLoadSampleCsv = async () => {
    const res = await fetch("/api/trades/import-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useSampleCsv: true, replaceExisting: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Failed to load sample portfolio: ${data.error || "Unknown error"}`);
      return;
    }
    applyServerPayload(data);
    flashNotification(`Loaded ${data.importedCount ?? 0} sample trades.`);
  };

  const handleClearPortfolio = async (confirmUsername: string) => {
    const res = await fetch("/api/portfolio/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmUsername }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to clear portfolio");
    }
    applyServerPayload(data);
    flashNotification("Portfolio cleared.");
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
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
      if (tradeFilter === "TRIMMED" && !t.trimmedAt2R && !t.positionGroupId) return false;
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
    mode: "edit" | "close" | "trim" = "edit"
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
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Failed to save trade");
    }
    applyServerPayload(payload);
    if (tradeId === undefined && payload.user) {
      flashNotification(
        `Added ${data.ticker} — cash balance updated to €${Math.round(payload.user.cashBalance).toLocaleString("en-US")}.`
      );
    }
  };

  const handleTrimTrade = async (tradeId: number, data: TrimTradeInput) => {
    const existing = trades.find((t) => t.id === tradeId);
    if (!existing) return;

    const remainingShares = Math.max(0, existing.shares - data.trimmedShares);
    const groupId =
      existing.positionGroupId ||
      `grp-${existing.id}-${Date.now().toString(36)}`;

    // 1. Update original trade with remaining shares
    const patchRes = await fetch(`/api/trades/${tradeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shares: remainingShares,
        trimmedAt2R: data.trimmedAt2R ?? true,
        stopMoved: data.stopMoved ?? existing.stopMoved,
        positionGroupId: groupId,
      }),
    });
    if (!patchRes.ok) {
      const err = await patchRes.json();
      throw new Error(err.error || "Failed to update original trade");
    }

    // 2. Create closed trade for the trimmed lot
    const postRes = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        securityId: existing.securityId,
        ticker: existing.ticker,
        gicsSector: existing.gicsSector,
        startDate: existing.startDate,
        endDate: data.trimDate,
        shares: data.trimmedShares,
        buyPrice: existing.buyPrice,
        sellPrice: data.trimPrice,
        currency: existing.currency,
        initialStopLoss: existing.initialStopLoss,
        stopMoved: data.stopMoved ?? existing.stopMoved,
        trimmedAt2R: data.trimmedAt2R ?? true,
        entryFxRateToEur: existing.entryFxRateToEur,
        fxRateToEur: data.fxRateToEur ?? existing.fxRateToEur,
        positionGroupId: groupId,
        notes: data.notes ?? `Trimmed ${data.trimmedShares} shares`,
      }),
    });
    const postPayload = await postRes.json();
    if (!postRes.ok) {
      throw new Error(postPayload.error || "Failed to create trimmed trade");
    }
    applyServerPayload(postPayload);
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
    const res = await fetch(`/api/trades/${trade.id}`, { method: "DELETE" });
    if (res.ok) {
      applyServerPayload(await res.json());
      setIsModalOpen(false);
      setEditingTrade(null);
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
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Failed to create security");
    }
    applyServerPayload(payload);
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
    if (!res.ok) {
      throw new Error(payload.error || "Failed to update security");
    }
    applyServerPayload(payload);
  };

  const handleDeleteSecurity = async (sec: SecurityRecord) => {
    if (
      !window.confirm(
        `Delete security ${sec.ticker} (${sec.name})? Existing trades will remain intact.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/securities/${sec.id}`, { method: "DELETE" });
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
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Failed to create forex pair");
    }
    applyServerPayload(payload);
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
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.error || "Failed to update forex pair");
    }
    applyServerPayload(payload);
  };

  const handleDeleteForex = async (pair: ForexPairRecord) => {
    if (!window.confirm(`Delete currency pair ${pair.pairLabel}?`)) {
      return;
    }
    const res = await fetch(`/api/forex/${pair.id}`, { method: "DELETE" });
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
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Batch sync failed");
      }
      applyServerPayload(data);
      flashNotification(
        `Refreshed ${data.syncedSecurities ?? 0} quotes & ${data.syncedForex ?? 0} FX rates.`
      );
    } catch (e) {
      alert(
        `Network error during sync: ${e instanceof Error ? e.message : "Unknown error"}`
      );
    } finally {
      setIsSyncingAll(false);
    }
  };

  const openCount = trades.filter((t) => t.isOpen).length;
  const closedCount = trades.filter((t) => !t.isOpen).length;
  const trimmedCount = trades.filter((t) => t.trimmedAt2R || Boolean(t.positionGroupId)).length;
  const isPositiveNet = displayedKpis.totalGainLossEur >= 0;
  const openExposureEur = displayedKpis.openExposureEur;
  const currentTotalEquity = Math.max(0, cashBalance + openExposureEur);
  const cashAvailable = cashBalance;
  const investedPercent =
    currentTotalEquity > 0
      ? (openExposureEur / currentTotalEquity) * 100
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

  React.useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobileSidebarOpen]);

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
    {
      id: "SETTINGS" as NavSection,
      label: "Settings",
      icon: Settings,
      count: null as number | null,
      badgeColor: "bg-slate-100 text-slate-600",
    },
  ];

  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-clip bg-[#f8fafc] flex">
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs lg:hidden"
        />
      )}

      {/* Modern Fixed Sidebar */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 h-dvh bg-white border-r border-slate-200/90 flex flex-col transition-all duration-200 ease-in-out lg:sticky lg:top-0 lg:bottom-auto lg:left-auto lg:z-30 lg:self-start lg:shrink-0 ${isSidebarCollapsed ? "w-18" : "w-64 max-w-[82vw]"
          } ${isMobileSidebarOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0"
          }`}
      >
        {/* App Logo & Title */}
        <div
          className={`h-18 shrink-0 flex items-center border-b border-slate-100 transition-all ${isSidebarCollapsed ? "px-0 justify-center" : "px-4 justify-between"
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
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm tracking-tight text-slate-900 leading-tight">
                    Trade Tracker
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsAboutModalOpen(true)}
                    className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors cursor-pointer border border-slate-200/60"
                    title="Click for app version & details"
                  >
                    v{APP_VERSION}
                  </button>
                </div>
                <div className="text-[11px] text-slate-400 font-medium">
                  Performance Ledger
                </div>
              </div>
            )}
          </div>
          {!isSidebarCollapsed && (
            <>
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed(true)}
                className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(false)}
                className="flex lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Expand button when sidebar is collapsed */}
        {isSidebarCollapsed && (
          <div className="hidden lg:flex justify-center pt-2 shrink-0">
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
        <div className="p-3 space-y-1.5 flex-1 min-h-0 overflow-y-auto">
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
                    {item.count !== null && (
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium tabular-nums ${item.badgeColor}`}
                      >
                        {item.count}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Sidebar Footer Info */}
        <div className="p-3 border-t border-slate-100 space-y-2 shrink-0">
          {!isSidebarCollapsed ? (
            <>
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-[11px] text-slate-500 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[9px] font-bold uppercase flex items-center justify-center shrink-0">
                      {currentUser.username.slice(0, 2)}
                    </span>
                    <span className="font-semibold text-slate-800 truncate">
                      {currentUser.username}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Sign out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{trades.length} trades &middot; EUR (€)</span>
                  <button
                    type="button"
                    onClick={() => setIsAboutModalOpen(true)}
                    className="font-mono text-slate-400 hover:text-slate-700 transition-colors cursor-pointer hover:underline"
                    title="Click for app version & details"
                  >
                    {APP_BUILD_LABEL}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex justify-center py-1.5 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
              title={`Signed in as ${currentUser.username} — Click to sign out`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200/80 lg:sticky lg:top-0 z-30">
          {notificationMsg && (
            <div className="bg-blue-600 text-white text-xs py-1.5 px-4 font-medium flex items-center justify-between animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{notificationMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotificationMsg(null)}
                className="text-blue-100 hover:text-white cursor-pointer ml-3"
              >
                ✕
              </button>
            </div>
          )}
          <div className="px-3.5 sm:px-8 pt-3.5 sm:pt-5 pb-0">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 sm:gap-4">
              {/* Left: Mobile hamburger + Hero Value */}
              <div className="flex items-start gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden cursor-pointer shrink-0"
                >
                  <Menu className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    {activeSection === "TRADES"
                      ? "Trading Portfolio • Total Account Value"
                      : activeSection === "EQUITY"
                        ? "Performance Analytics • Total Account Value"
                        : activeSection === "SECURITIES"
                          ? "Master Entity Repository • Securities & Quote Feeds"
                          : activeSection === "FOREX"
                            ? "Currency Conversion • Live & Historical ECB Feeds"
                            : "Account, Backup & Administration • Settings"}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      suppressHydrationWarning
                      className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 tabular-nums"
                      title="Total Account Value = Cash (€) + In Trades (€)"
                    >
                      €{Math.round(currentTotalEquity).toLocaleString("en-US")}
                    </span>
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
                  </div>

                  {/* Breakdown: Cash vs In Trades */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1.5 text-xs text-slate-500 font-medium tabular-nums">
                    <button
                      type="button"
                      onClick={() => setIsAccountModalOpen(true)}
                      className="hover:text-emerald-700 transition-colors cursor-pointer inline-flex items-center gap-1 group"
                      title="Click to edit Cash balance"
                    >
                      <span className="text-slate-500">Cash:</span>{" "}
                      <strong className="text-slate-800 font-semibold group-hover:text-emerald-700">
                        €{Math.round(cashAvailable).toLocaleString("en-US")}
                      </strong>{" "}
                      <span className="text-slate-400">({cashPercent.toFixed(1)}%)</span>
                      <Pencil className="w-2.5 h-2.5 text-slate-400 group-hover:text-emerald-600" />
                    </button>
                    <span className="text-slate-300">•</span>
                    <span title="Capital currently invested in open positions">
                      In Trades:{" "}
                      <strong className="text-slate-800 font-semibold">
                        €{Math.round(displayedKpis.openExposureEur).toLocaleString("en-US")}
                      </strong>{" "}
                      <span className="text-slate-400">({investedPercent.toFixed(1)}%)</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Action Buttons */}
              <div className="flex flex-col lg:items-end gap-2.5 shrink-0">
                {/* Action Buttons */}
                <div className="grid grid-cols-3 sm:flex sm:flex-nowrap items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenPositionSizer()}
                    className="inline-flex items-center justify-center gap-1.5 px-2 sm:px-3.5 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer whitespace-nowrap"
                    title="Risk-First Position Sizing Calculator"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    <span className="sm:hidden">Sizer</span>
                    <span className="hidden sm:inline">Position Sizer</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSyncingAll}
                    onClick={() => handleBatchSync("OPEN_ONLY")}
                    className="inline-flex items-center justify-center gap-1.5 px-2 sm:px-3.5 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                    title="Sync live quotes & FX rates for open positions from Yahoo Finance"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 text-blue-600 shrink-0 ${isSyncingAll ? "animate-spin" : ""
                        }`}
                    />
                    <span className="sm:hidden">{isSyncingAll ? "Sync..." : "Sync"}</span>
                    <span className="hidden sm:inline">{isSyncingAll ? "Syncing..." : "Sync Quotes"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenCreate}
                    className="inline-flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5] shrink-0" />
                    <span>Add Trade</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Sub-header Filter Tabs (Active when in Trade Ledger view) */}
            {activeSection === "TRADES" ? (
              <nav className="flex items-center gap-4 sm:gap-6 mt-3.5 sm:mt-5 -mb-px overflow-x-auto no-scrollbar">
                {(
                  [
                    { id: "OPEN", label: "Open Positions", count: openCount },
                    { id: "ALL", label: "Summary (All)", count: trades.length },
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
        <main className="p-3 sm:p-8 space-y-4 sm:space-y-6 flex-1 min-w-0">
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
          ) : activeSection === "SETTINGS" ? (
            <SettingsView
              currentUser={currentUser}
              tradeCount={trades.length}
              securityCount={securities.length}
              onExportXml={handleExportXml}
              onImportXmlFile={handleImportXmlFile}
              onLoadSampleCsv={handleLoadSampleCsv}
              onClearPortfolio={handleClearPortfolio}
              onSignOut={handleSignOut}
            />
          ) : (
            <TradeTable
              trades={filteredTrades}
              securities={securities}
              onToggleField={handleToggleField}
              onEditTrade={handleOpenEdit}
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
            />
          )}

          {/* Page Footer */}
          <footer className="pt-6 pb-2 border-t border-slate-200/70 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-500">Trade Tracker</span>
              <span>•</span>
              <span>Performance &amp; Risk Ledger</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Version:</span>
              <button
                type="button"
                onClick={() => setIsAboutModalOpen(true)}
                className="font-mono font-medium px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200/80 transition-colors cursor-pointer"
                title="Click for full version details"
              >
                {APP_BUILD_LABEL}
              </button>
            </div>
          </footer>
        </main>
      </div>

      <TradeModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setInitialSizing(null);
        }}
        onSubmit={handleSaveTrade}
        onTrim={handleTrimTrade}
        onDeleteTrade={handleDeleteTrade}
        initialTrade={editingTrade}
        preselectedSecurity={preselectedSecurity}
        initialSizing={initialSizing}
        securities={securities}
        forexPairs={forexPairs}
        cashBalance={cashBalance}
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
        onAccountEquityChange={handleAccountEquityChangeFromSizer}
      />

      <AccountEquityModal
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
        cashBalance={cashBalance}
        openExposureEur={displayedKpis.openExposureEur}
        onSaveCashBalance={handleSaveCashBalance}
      />

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
        version={APP_VERSION}
      />
    </div>
  );
}
