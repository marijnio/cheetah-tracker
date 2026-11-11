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
  Download,
  Save,
  FolderOpen,
  FileCode2,
  FilePlus2,
  CheckCircle2,
} from "lucide-react";
import { KpiCards } from "./kpi-cards";
import { TradeTable } from "./trade-table";
import { TradeModal } from "./trade-modal";
import { PositionSizerModal } from "./position-sizer-modal";
import { EquityCurveView } from "./equity-curve-view";
import { SecuritiesView } from "./securities-view";
import { ForexView } from "./forex-view";
import { AccountEquityModal } from "./account-equity-modal";
import { AboutModal } from "./about-modal";
import { APP_VERSION } from "@/lib/version";
import {
  computePortfolioKPIs,
  type ComputedTrade,
  type PortfolioKPIs,
} from "@/lib/trade-math";
import type {
  TradeRecord,
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
import {
  isFileSystemAccessSupported,
  openPortfolioWithPicker,
  savePortfolioToFile,
  getStoredFileHandle,
  clearStoredFileHandle,
} from "@/lib/file-system-api";
import {
  loadWorkspaceFromLocalStorage,
  saveWorkspaceToLocalStorage,
  normalizeAndComputeWorkspace,
  createDefaultForexPairs,
  clientCreateTrade,
  clientUpdateTrade,
  clientDeleteTrade,
  clientBulkImportTrades,
  clientUpsertSecurity,
  clientUpdateSecurityById,
  clientDeleteSecurityById,
  clientUpsertForexPair,
  clientUpdateForexPairById,
  clientDeleteForexPairById,
  type ComputedWorkspacePayload,
} from "@/lib/client-portfolio-store";
import { parseTradesCsv } from "@/lib/csv-parser";

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
  const [cashBalance, setCashBalance] = useState<number>(25000);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

  // File-management state (XML)
  const [currentFileName, setCurrentFileName] = useState<string>("cheetah-portfolio.xml");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);
  const [hasDirectFileConnection, setHasDirectFileConnection] = useState<boolean>(false);

  // Reference to active direct file handle (File System Access API)
  const activeFileHandleRef = useRef<FileSystemFileHandle | null>(null);

  // Reference for fallback XML file input upload
  const xmlFileInputRef = useRef<HTMLInputElement | null>(null);

  // Check for cached file handle in IndexedDB on mount
  React.useEffect(() => {
    if (!isFileSystemAccessSupported()) return;
    getStoredFileHandle()
      .then((handle) => {
        if (handle) {
          activeFileHandleRef.current = handle;
          setHasDirectFileConnection(true);
        }
      })
      .catch(() => { });
  }, []);

  // Load from local storage on mount (first checking for an active saved XML portfolio workspace)
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const savedWorkspace = loadWorkspaceFromLocalStorage();
    if (savedWorkspace) {
      const computed = normalizeAndComputeWorkspace(
        savedWorkspace.trades,
        savedWorkspace.securities,
        savedWorkspace.forexPairs
      );
      setTrades(computed.trades);
      setGlobalKpis(computed.kpis);
      setSecurities(computed.securities);
      setForexPairs(computed.forexPairs);
      setCashBalance(savedWorkspace.cashBalance);
      setRiskPercent(savedWorkspace.riskPercent);
      setCurrentFileName(savedWorkspace.fileName);
      setLastSavedTime(savedWorkspace.lastSavedAt);
      setHasUnsavedChanges(savedWorkspace.isDirty);
      return;
    }

    // Fallback: load cash balance if set
    const savedCash = localStorage.getItem("cheetah_cash_balance");
    if (savedCash && !isNaN(Number(savedCash)) && Number(savedCash) >= 0) {
      setCashBalance(Number(savedCash));
    }
  }, []);

  const flashNotification = (msg: string) => {
    setNotificationMsg(msg);
    setTimeout(() => {
      setNotificationMsg((curr) => (curr === msg ? null : curr));
    }, 4500);
  };

  // Helper to persist current working state to browser localStorage
  const persistWorkingState = (
    nextTrades: TradeRecord[] | ComputedTrade[],
    nextSecurities: SecurityRecord[],
    nextForex: ForexPairRecord[],
    nextCash = cashBalance,
    nextRisk = riskPercent,
    markDirty = true
  ) => {
    setHasUnsavedChanges(markDirty);
    saveWorkspaceToLocalStorage({
      fileName: currentFileName,
      lastSavedAt: lastSavedTime,
      isDirty: markDirty,
      cashBalance: nextCash,
      riskPercent: nextRisk,
      trades: nextTrades,
      securities: nextSecurities,
      forexPairs: nextForex,
    });
  };

  const handleSaveCashBalance = (newCash: number) => {
    setCashBalance(newCash);
    persistWorkingState(trades, securities, forexPairs, newCash, riskPercent, true);
    if (typeof window !== "undefined") {
      const total = newCash + displayedKpis.openExposureEur;
      localStorage.setItem("cheetah_cash_balance", String(newCash));
      localStorage.setItem("cheetah_account_equity", String(Math.round(total)));
      window.dispatchEvent(new Event("storage"));
    }
  };

  const handleAccountEquityChangeFromSizer = (newTotal: number) => {
    const newCash = Math.max(0, newTotal - displayedKpis.openExposureEur);
    handleSaveCashBalance(newCash);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // File Action: Open/Load an XML File with File System Access API (or fallback)
  const handleOpenAction = async () => {
    if (
      hasUnsavedChanges &&
      !window.confirm(
        "You have unsaved changes in your current portfolio. Do you want to open another file and replace the current workspace?"
      )
    ) {
      return;
    }

    if (isFileSystemAccessSupported()) {
      try {
        const result = await openPortfolioWithPicker();
        if (!result) return; // User cancelled

        activeFileHandleRef.current = result.handle;
        setHasDirectFileConnection(true);

        const loaded = parsePortfolioXml(result.text, result.file.name);
        const computed = normalizeAndComputeWorkspace(
          loaded.trades,
          loaded.securities,
          loaded.forexPairs
        );

        setTrades(computed.trades);
        setGlobalKpis(computed.kpis);
        setSecurities(computed.securities);
        setForexPairs(computed.forexPairs);
        setCashBalance(loaded.cashBalance);
        setRiskPercent(loaded.riskPercent);
        setCurrentFileName(result.file.name);
        const nowTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        setLastSavedTime(nowTime);
        setHasUnsavedChanges(false);

        saveWorkspaceToLocalStorage({
          fileName: result.file.name,
          lastSavedAt: nowTime,
          isDirty: false,
          cashBalance: loaded.cashBalance,
          riskPercent: loaded.riskPercent,
          trades: computed.trades,
          securities: computed.securities,
          forexPairs: computed.forexPairs,
        });

        flashNotification(
          `Opened "${result.file.name}" (${computed.trades.length} trades, ${computed.securities.length} securities). Direct save enabled.`
        );
      } catch (err: unknown) {
        alert(`Could not open file: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    } else {
      // Fallback for browsers / non-HTTPS without File System Access API
      xmlFileInputRef.current?.click();
    }
  };

  // File Action: Save XML File directly back to file handle or export via download
  const handleSaveAction = async (forceSaveAs = false) => {
    try {
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

      let safeFileName = currentFileName.endsWith(".xml")
        ? currentFileName
        : `${currentFileName.replace(/\.[^/.]+$/, "")}.xml`;

      const nowTime = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      // 1. Try File System Access API (direct write in Chrome, Edge, Brave, Arc)
      if (isFileSystemAccessSupported()) {
        const res = await savePortfolioToFile(
          xmlString,
          activeFileHandleRef.current,
          safeFileName,
          forceSaveAs
        );

        if (!res) return; // User cancelled save picker

        activeFileHandleRef.current = res.handle;
        setHasDirectFileConnection(true);
        setCurrentFileName(res.fileName);
        setLastSavedTime(nowTime);
        setHasUnsavedChanges(false);

        saveWorkspaceToLocalStorage({
          fileName: res.fileName,
          lastSavedAt: nowTime,
          isDirty: false,
          cashBalance,
          riskPercent,
          trades,
          securities,
          forexPairs,
        });

        flashNotification(`Saved directly to "${res.fileName}".`);
        return;
      }

      // 2. Fallback (Firefox, Safari, non-HTTPS):
      // If "Save As" was clicked, prompt the user for the new file name
      if (forceSaveAs) {
        const promptName = window.prompt("Save As - Enter XML file name:", safeFileName);
        if (!promptName || !promptName.trim()) return;
        safeFileName = promptName.trim().endsWith(".xml")
          ? promptName.trim()
          : `${promptName.trim()}.xml`;
        setCurrentFileName(safeFileName);
      }
      const blob = new Blob([xmlString], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setLastSavedTime(nowTime);
      setHasUnsavedChanges(false);

      saveWorkspaceToLocalStorage({
        fileName: safeFileName,
        lastSavedAt: nowTime,
        isDirty: false,
        cashBalance,
        riskPercent,
        trades,
        securities,
        forexPairs,
      });

      flashNotification(`Exported "${safeFileName}" to your computer.`);
    } catch (err: unknown) {
      alert(`Failed to save XML file: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  // Keyboard shortcut: Cmd+S / Ctrl+S to save
  const handleSaveActionRef = useRef(handleSaveAction);
  handleSaveActionRef.current = handleSaveAction;

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveActionRef.current(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fallback File Action: Open/Load an XML File via traditional file input
  const handleLoadXmlFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      hasUnsavedChanges &&
      !window.confirm(
        "You have unsaved changes in your current portfolio. Do you want to open another file and replace the current workspace?"
      )
    ) {
      if (xmlFileInputRef.current) xmlFileInputRef.current.value = "";
      return;
    }

    try {
      const text = await file.text();
      const loaded = parsePortfolioXml(text, file.name);

      const computed = normalizeAndComputeWorkspace(
        loaded.trades,
        loaded.securities,
        loaded.forexPairs
      );

      // Traditional upload does not retain direct handle
      activeFileHandleRef.current = null;
      setHasDirectFileConnection(false);
      clearStoredFileHandle().catch(() => { });

      setTrades(computed.trades);
      setGlobalKpis(computed.kpis);
      setSecurities(computed.securities);
      setForexPairs(computed.forexPairs);
      setCashBalance(loaded.cashBalance);
      setRiskPercent(loaded.riskPercent);
      setCurrentFileName(file.name);
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setHasUnsavedChanges(false);

      saveWorkspaceToLocalStorage({
        fileName: file.name,
        lastSavedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        isDirty: false,
        cashBalance: loaded.cashBalance,
        riskPercent: loaded.riskPercent,
        trades: computed.trades,
        securities: computed.securities,
        forexPairs: computed.forexPairs,
      });

      flashNotification(
        `Loaded "${file.name}" (${computed.trades.length} trades, ${computed.securities.length} securities).`
      );
    } catch (err) {
      alert(`Could not open file: ${err instanceof Error ? err.message : "Unknown XML format"}`);
    } finally {
      if (xmlFileInputRef.current) {
        xmlFileInputRef.current.value = "";
      }
    }
  };

  // File Action: Start New Blank Portfolio File
  const handleNewPortfolioFile = () => {
    if (
      hasUnsavedChanges &&
      !window.confirm(
        "Start a new blank portfolio file? Any unsaved edits in your current portfolio will be discarded."
      )
    ) {
      return;
    }

    activeFileHandleRef.current = null;
    setHasDirectFileConnection(false);
    clearStoredFileHandle().catch(() => { });

    const defaultForex = createDefaultForexPairs();
    const computed = normalizeAndComputeWorkspace([], [], defaultForex);
    const newName = "my-cheetah-portfolio.xml";

    setTrades([]);
    setGlobalKpis(computed.kpis);
    setSecurities([]);
    setForexPairs(computed.forexPairs);
    setCashBalance(25000);
    setRiskPercent(1.0);
    setCurrentFileName(newName);
    setLastSavedTime(null);
    setHasUnsavedChanges(true);

    persistWorkingState([], [], computed.forexPairs, 25000, 1.0, true);
    flashNotification(`Started new portfolio file "${newName}".`);
  };

  const applyWorkspacePayload = (payload: ComputedWorkspacePayload) => {
    setTrades(payload.trades);
    setGlobalKpis(payload.kpis);
    setSecurities(payload.securities);
    setForexPairs(payload.forexPairs);
    persistWorkingState(payload.trades, payload.securities, payload.forexPairs);
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
    if (tradeId !== undefined) {
      const next = clientUpdateTrade(trades, securities, forexPairs, tradeId, data);
      applyWorkspacePayload(next);
    } else {
      const next = clientCreateTrade(trades, securities, forexPairs, data);
      applyWorkspacePayload(next);
    }
  };

  const handleToggleField = async (
    trade: ComputedTrade,
    field: "stopMoved" | "trimmedAt2R"
  ) => {
    const nextValue = !trade[field];
    const next = clientUpdateTrade(trades, securities, forexPairs, trade.id, {
      [field]: nextValue,
    });
    applyWorkspacePayload(next);
  };

  const handleDeleteTrade = async (trade: ComputedTrade) => {
    if (!window.confirm(`Delete trade ${trade.ticker} (${trade.startDate})?`)) {
      return;
    }
    const next = clientDeleteTrade(trades, securities, forexPairs, trade.id);
    applyWorkspacePayload(next);
    setIsModalOpen(false);
    setEditingTrade(null);
  };

  const handleCreateSecurity = async (
    data: NewSecurityInput & { syncQuoteNow?: boolean }
  ) => {
    let { security, payload } = clientUpsertSecurity(
      trades,
      securities,
      forexPairs,
      data
    );

    if (data.syncQuoteNow && security.quoteProvider === "YAHOO") {
      try {
        const res = await fetch("/api/quotes/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookupSymbol: security.ticker }),
        });
        const quoteData = await res.json();
        if (res.ok && quoteData.lookup) {
          const l = quoteData.lookup;
          const updated = clientUpdateSecurityById(
            payload.trades,
            payload.securities,
            payload.forexPairs,
            security.id,
            {
              latestPrice: l.latestPrice,
              previousClose: l.previousClose,
              name: security.name === security.ticker ? l.name : security.name,
              gicsSector:
                security.gicsSector === "Uncategorized"
                  ? l.gicsSector
                  : security.gicsSector,
              currency: l.currency || security.currency,
              lastQuoteAt: new Date().toISOString(),
              quoteStatus: "OK",
              quoteError: null,
            }
          );
          payload = updated.payload;
        }
      } catch (err) {
        console.warn("Could not sync quote on creation:", err);
      }
    }

    applyWorkspacePayload(payload);
  };

  const handleUpdateSecurity = async (
    id: number,
    data: Partial<NewSecurityInput> & { syncQuote?: boolean }
  ) => {
    let { security, payload } = clientUpdateSecurityById(
      trades,
      securities,
      forexPairs,
      id,
      data
    );

    if (data.syncQuote && security) {
      try {
        const res = await fetch("/api/quotes/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookupSymbol: security.ticker }),
        });
        const quoteData = await res.json();
        if (res.ok && quoteData.lookup) {
          const l = quoteData.lookup;
          const updated = clientUpdateSecurityById(
            payload.trades,
            payload.securities,
            payload.forexPairs,
            id,
            {
              latestPrice: l.latestPrice,
              previousClose: l.previousClose,
              name: security.name === security.ticker ? l.name : security.name,
              gicsSector:
                security.gicsSector === "Uncategorized"
                  ? l.gicsSector
                  : security.gicsSector,
              currency: l.currency || security.currency,
              lastQuoteAt: new Date().toISOString(),
              quoteStatus: "OK",
              quoteError: null,
            }
          );
          payload = updated.payload;
        } else {
          const errUpdated = clientUpdateSecurityById(
            payload.trades,
            payload.securities,
            payload.forexPairs,
            id,
            {
              quoteStatus: "ERROR",
              quoteError: quoteData.error || "Lookup failed",
            }
          );
          payload = errUpdated.payload;
        }
      } catch (err) {
        const errUpdated = clientUpdateSecurityById(
          payload.trades,
          payload.securities,
          payload.forexPairs,
          id,
          {
            quoteStatus: "ERROR",
            quoteError: err instanceof Error ? err.message : "Sync failed",
          }
        );
        payload = errUpdated.payload;
      }
    }

    applyWorkspacePayload(payload);
  };

  const handleDeleteSecurity = async (sec: SecurityRecord) => {
    if (
      !window.confirm(
        `Delete security ${sec.ticker} (${sec.name})? Existing trades will remain intact.`
      )
    ) {
      return;
    }
    const next = clientDeleteSecurityById(trades, securities, forexPairs, sec.id);
    applyWorkspacePayload(next);
  };

  const handleCreateForex = async (
    data: NewForexPairInput & { syncNow?: boolean }
  ) => {
    let { pair, payload } = clientUpsertForexPair(
      trades,
      securities,
      forexPairs,
      data
    );

    if (data.syncNow && pair.liveProvider !== "MANUAL") {
      try {
        const res = await fetch("/api/quotes/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lookupSymbol: pair.yahooSymbol,
          }),
        });
        const quoteData = await res.json();
        if (res.ok && quoteData.lookup) {
          const updated = clientUpdateForexPairById(
            payload.trades,
            payload.securities,
            payload.forexPairs,
            pair.id,
            {
              latestRate: quoteData.lookup.latestPrice,
              previousClose: quoteData.lookup.previousClose,
              lastUpdated: new Date().toISOString(),
              syncStatus: "OK",
              syncError: null,
            }
          );
          if (updated.payload) payload = updated.payload;
        }
      } catch (err) {
        console.warn("Could not sync forex rate on creation:", err);
      }
    }

    applyWorkspacePayload(payload);
  };

  const handleUpdateForex = async (
    id: number,
    data: Partial<NewForexPairInput> & { syncNow?: boolean }
  ) => {
    let { pair, payload } = clientUpdateForexPairById(
      trades,
      securities,
      forexPairs,
      id,
      data
    );

    if (data.syncNow && pair && pair.liveProvider !== "MANUAL") {
      try {
        const res = await fetch("/api/quotes/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookupSymbol: pair.yahooSymbol }),
        });
        const quoteData = await res.json();
        if (res.ok && quoteData.lookup) {
          const updated = clientUpdateForexPairById(
            payload.trades,
            payload.securities,
            payload.forexPairs,
            id,
            {
              latestRate: quoteData.lookup.latestPrice,
              previousClose: quoteData.lookup.previousClose,
              lastUpdated: new Date().toISOString(),
              syncStatus: "OK",
              syncError: null,
            }
          );
          if (updated.payload) payload = updated.payload;
        }
      } catch (err) {
        console.warn("Could not sync forex pair:", err);
      }
    }

    applyWorkspacePayload(payload);
  };

  const handleDeleteForex = async (pair: ForexPairRecord) => {
    if (!window.confirm(`Delete currency pair ${pair.pairLabel}?`)) {
      return;
    }
    const next = clientDeleteForexPairById(trades, securities, forexPairs, pair.id);
    applyWorkspacePayload(next);
  };

  const handleBatchSync = async (
    scope: "OPEN_ONLY" | "ALL_SECURITIES" | "FOREX_ONLY"
  ) => {
    setIsSyncingAll(true);
    try {
      const targetSec =
        scope === "FOREX_ONLY"
          ? []
          : securities.filter((s) => {
            if (s.quoteProvider === "MANUAL") return false;
            if (scope === "OPEN_ONLY") return (s.openTradeCount ?? 0) > 0;
            return true;
          });

      const symbols = [
        ...targetSec.map((s) => s.ticker),
        ...forexPairs.filter((p) => p.liveProvider === "YAHOO").map((p) => p.yahooSymbol),
      ];

      const res = await fetch("/api/quotes/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statelessBatch: {
            symbols,
            forexCurrencies: forexPairs.map((p) => p.fromCurrency),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Batch sync failed");
      }

      const { batchResults, frankfurterMap, timestamp } = data;
      const now = timestamp || new Date().toISOString();
      let syncedSecCount = 0;
      let syncedFxCount = 0;

      // Update Securities
      const nextSecurities = securities.map((sec) => {
        const entry = batchResults[sec.ticker.toUpperCase()] || batchResults[sec.ticker];
        if (entry?.result) {
          syncedSecCount++;
          return {
            ...sec,
            latestPrice: entry.result.regularMarketPrice,
            previousClose: entry.result.previousClose,
            name:
              !sec.name || sec.name === sec.ticker
                ? entry.result.longName || entry.result.shortName || sec.name
                : sec.name,
            lastQuoteAt: now,
            quoteStatus: "OK" as const,
            quoteError: null,
          };
        } else if (entry?.error) {
          return {
            ...sec,
            quoteStatus: "ERROR" as const,
            quoteError: entry.error,
          };
        }
        return sec;
      });

      // Update Forex Pairs
      const nextForex = forexPairs.map((pair) => {
        if (pair.liveProvider === "MANUAL") return pair;
        const entry =
          batchResults[pair.yahooSymbol.toUpperCase()] ||
          batchResults[pair.yahooSymbol];
        const ecbRate = frankfurterMap?.[pair.fromCurrency.toUpperCase()];

        if (entry?.result) {
          syncedFxCount++;
          return {
            ...pair,
            latestRate: entry.result.regularMarketPrice,
            previousClose: entry.result.previousClose,
            lastUpdated: now,
            syncStatus: "OK" as const,
            syncError: null,
          };
        } else if (ecbRate) {
          syncedFxCount++;
          return {
            ...pair,
            latestRate: ecbRate,
            lastUpdated: now,
            syncStatus: "OK" as const,
            syncError: null,
          };
        } else if (entry?.error) {
          return {
            ...pair,
            syncStatus: "ERROR" as const,
            syncError: entry.error,
          };
        }
        return pair;
      });

      const next = normalizeAndComputeWorkspace(trades, nextSecurities, nextForex);
      applyWorkspacePayload(next);
      flashNotification(`Refreshed ${syncedSecCount} quotes & ${syncedFxCount} FX rates.`);
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
      const parsedItems = parseTradesCsv(text);
      if (parsedItems.length === 0) {
        alert("No valid trade rows found in the CSV.");
        return;
      }
      const next = clientBulkImportTrades(
        trades,
        securities,
        forexPairs,
        parsedItems,
        replaceExisting
      );
      applyWorkspacePayload(next);
      flashNotification(`Imported ${parsedItems.length} trades from "${file.name}".`);
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
        "Reset portfolio to the original 132 sample trades? Any unsaved edits will be replaced."
      )
    ) {
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch("/api/trades/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useSampleCsv: true, parseOnly: true }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.parsedItems)) {
        const next = clientBulkImportTrades(
          [],
          [],
          createDefaultForexPairs(),
          data.parsedItems,
          true
        );
        setCurrentFileName("cheetah-sample-portfolio.xml");
        setLastSavedTime(null);
        setHasUnsavedChanges(true);
        applyWorkspacePayload(next);
        flashNotification("Loaded sample 132 trades into portfolio.");
      }
    } finally {
      setIsImporting(false);
    }
  };

  const openCount = trades.filter((t) => t.isOpen).length;
  const closedCount = trades.filter((t) => !t.isOpen).length;
  const trimmedCount = trades.filter((t) => t.trimmedAt2R).length;
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

      {/* Hidden File Input for XML Portfolio Load */}
      <input
        ref={xmlFileInputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        onChange={handleLoadXmlFile}
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

          {/* Portfolio File Management Sidebar Section */}
          <div className="pt-3">
            <div
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 ${isSidebarCollapsed ? "text-center" : ""
                }`}
            >
              {isSidebarCollapsed ? "•••" : "Portfolio File"}
            </div>

            <div className="space-y-1">
              <button
                type="button"
                onClick={handleOpenAction}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer ${isSidebarCollapsed ? "justify-center px-2" : ""}`}
                title="Open Portfolio XML file from Desktop / Google Drive"
              >
                <FolderOpen className="w-4 h-4 text-slate-400 shrink-0" />
                {!isSidebarCollapsed && <span className="flex-1 text-left truncate">Open File...</span>}
              </button>

              <button
                type="button"
                onClick={() => handleSaveAction(false)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50/70 transition-colors cursor-pointer ${isSidebarCollapsed ? "justify-center px-2" : ""}`}
                title={
                  hasDirectFileConnection
                    ? `Save directly to ${currentFileName} (⌘S)`
                    : "Save Portfolio XML file (⌘S)"
                }
              >
                <Save className="w-4 h-4 text-emerald-600 shrink-0" />
                {!isSidebarCollapsed && (
                  <>
                    <span className="flex-1 text-left truncate">Save File</span>
                    {hasUnsavedChanges && (
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Unsaved changes" />
                    )}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSaveAction(true)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer ${isSidebarCollapsed ? "justify-center px-2" : ""}`}
                title="Save current portfolio to a new file location (Save As)"
              >
                <Download className="w-4 h-4 text-slate-400 shrink-0" />
                {!isSidebarCollapsed && <span className="flex-1 text-left truncate">Save As...</span>}
              </button>

              <button
                type="button"
                onClick={handleNewPortfolioFile}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer ${isSidebarCollapsed ? "justify-center px-2" : ""}`}
                title="Create a new blank portfolio file"
              >
                <FilePlus2 className="w-4 h-4 text-slate-400 shrink-0" />
                {!isSidebarCollapsed && <span className="flex-1 text-left truncate">New File</span>}
              </button>
            </div>
          </div>
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
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>{trades.length} trades registered</span>
                <button
                  type="button"
                  onClick={() => setIsAboutModalOpen(true)}
                  className="font-mono text-slate-400 hover:text-slate-700 transition-colors cursor-pointer hover:underline"
                  title="Click for app version & details"
                >
                  v{APP_VERSION}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAboutModalOpen(true)}
              className="w-full text-center font-mono text-[10px] text-slate-400 hover:text-slate-700 transition-colors cursor-pointer py-1"
              title={`Trade Tracker v${APP_VERSION} (click for details)`}
            >
              v{APP_VERSION}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30">
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
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 rounded px-1.5 py-0.2 transition-colors cursor-pointer capitalize tracking-normal"
                      title="Update Current Cash Balance"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      <span>Edit Cash</span>
                    </button>
                    {/* Active File Pill */}
                    <div
                      className="inline-flex items-center gap-1.5 px-2 py-0.2 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-mono"
                      title={
                        hasDirectFileConnection
                          ? `Connected to local/Google Drive file: ${currentFileName}${lastSavedTime ? ` (last saved ${lastSavedTime})` : ""}`
                          : lastSavedTime
                            ? `Portfolio file: ${currentFileName} (saved at ${lastSavedTime})`
                            : `Portfolio file: ${currentFileName} (unsaved changes)`
                      }
                    >
                      <FileCode2 className="w-3 h-3 text-slate-500" />
                      <span className="truncate max-w-[130px] sm:max-w-[200px]">{currentFileName}</span>
                      {hasDirectFileConnection && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"
                          title="Direct File Sync connected"
                        />
                      )}
                      {hasUnsavedChanges ? (
                        <span className="px-1 py-0.1 text-[9px] font-bold rounded bg-amber-100 text-amber-800 uppercase font-sans">
                          Unsaved
                        </span>
                      ) : (
                        <span className="text-emerald-600 flex items-center" title="All changes saved to file">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setIsAccountModalOpen(true)}
                      suppressHydrationWarning
                      className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 tabular-nums hover:text-blue-600 transition-colors text-left cursor-pointer group"
                      title="Total Account Value = Cash (€) + In Trades (€). Click to update Cash."
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

                    {/* Breakdown: Cash vs In Trades */}
                    <div className="flex items-center gap-2.5 text-xs text-slate-500 font-medium tabular-nums sm:border-l sm:border-slate-200 sm:pl-3">
                      <button
                        type="button"
                        onClick={() => setIsAccountModalOpen(true)}
                        className="hover:text-emerald-700 transition-colors cursor-pointer flex items-center gap-1 group"
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
              </div>

              {/* Right Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                  title="Update your current cash balance"
                >
                  <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden sm:inline">Cash: €{Math.round(cashBalance).toLocaleString("en-US")}</span>
                  <span className="sm:hidden">Cash</span>
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
                v{APP_VERSION}
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
        onDeleteTrade={handleDeleteTrade}
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
