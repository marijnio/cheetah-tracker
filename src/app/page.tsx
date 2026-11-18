import React from "react";
import { redirect } from "next/navigation";
import {
  getAllForexPairs,
  getAllSecurities,
  getAllTrades,
  getLiveFxMap,
  getLiveQuoteMap,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import { DashboardClient } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const rawTrades = getAllTrades(user.id);
  const quoteMap = getLiveQuoteMap(user.id);
  const fxMap = getLiveFxMap(user.id);
  const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
  const kpis = computePortfolioKPIs(trades);
  const securities = getAllSecurities(user.id);
  const forexPairs = getAllForexPairs(user.id);

  return (
    <DashboardClient
      currentUser={user}
      initialTrades={trades}
      initialKpis={kpis}
      initialSecurities={securities}
      initialForexPairs={forexPairs}
    />
  );
}
