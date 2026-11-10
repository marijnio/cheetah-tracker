import React from "react";
import { getAllForexPairs, getLiveFxMap } from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import { DashboardClient } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const fxMap = getLiveFxMap();
  const forexPairs = getAllForexPairs();

  // Clean empty initial state: no sample trades, no sample securities
  const trades = computeTradesWithMetrics([], {}, fxMap);
  const kpis = computePortfolioKPIs(trades);

  return (
    <DashboardClient
      initialTrades={[]}
      initialKpis={kpis}
      initialSecurities={[]}
      initialForexPairs={forexPairs}
    />
  );
}
