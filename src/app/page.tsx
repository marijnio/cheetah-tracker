import React from "react";
import {
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import { DashboardClient } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const rawTrades = getAllTrades();
  const quoteMap = getLiveQuoteMap();
  const fxMap = getLiveFxMap();

  const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
  const kpis = computePortfolioKPIs(trades);
  const securities = getAllSecurities();
  const forexPairs = getAllForexPairs();

  return (
    <DashboardClient
      initialTrades={trades}
      initialKpis={kpis}
      initialSecurities={securities}
      initialForexPairs={forexPairs}
    />
  );
}
