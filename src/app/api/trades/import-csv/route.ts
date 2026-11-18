import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { parseTradesCsv } from "@/lib/csv-parser";
import {
  bulkInsertTrades,
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as {
      csvContent?: string;
      useSampleCsv?: boolean;
      replaceExisting?: boolean;
      parseOnly?: boolean;
    };

    let csvText = body.csvContent || "";

    if (body.useSampleCsv) {
      const samplePath = path.join(
        process.cwd(),
        "sample-data",
        "sample-trades.csv"
      );
      if (!fs.existsSync(samplePath)) {
        return NextResponse.json(
          { error: "Sample CSV file not found in sample-data/" },
          { status: 404 }
        );
      }
      csvText = fs.readFileSync(samplePath, "utf-8");
    }

    if (!csvText.trim()) {
      return NextResponse.json(
        { error: "No CSV content provided" },
        { status: 400 }
      );
    }

    const parsedItems = parseTradesCsv(csvText);
    if (parsedItems.length === 0) {
      return NextResponse.json(
        { error: "No valid trade rows found in CSV" },
        { status: 400 }
      );
    }

    if (body.parseOnly) {
      return NextResponse.json({
        importedCount: parsedItems.length,
        parsedItems,
      });
    }

    const importedCount = bulkInsertTrades(
      parsedItems,
      auth.user.id,
      undefined,
      Boolean(body.replaceExisting)
    );

    const rawTrades = getAllTrades(auth.user.id);
    const trades = computeTradesWithMetrics(
      rawTrades,
      getLiveQuoteMap(auth.user.id),
      getLiveFxMap(auth.user.id)
    );
    const kpis = computePortfolioKPIs(trades);
    const securities = getAllSecurities(auth.user.id);
    const forexPairs = getAllForexPairs(auth.user.id);

    return NextResponse.json({
      importedCount,
      trades,
      kpis,
      securities,
      forexPairs,
    });
  } catch (error) {
    console.error("POST /api/trades/import-csv error:", error);
    return NextResponse.json(
      { error: "Failed to import CSV" },
      { status: 500 }
    );
  }
}
