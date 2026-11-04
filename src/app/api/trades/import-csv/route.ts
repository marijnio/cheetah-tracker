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
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      csvContent?: string;
      useSampleCsv?: boolean;
      replaceExisting?: boolean;
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

    const importedCount = bulkInsertTrades(
      parsedItems,
      undefined,
      Boolean(body.replaceExisting)
    );

    const rawTrades = getAllTrades();
    const trades = computeTradesWithMetrics(
      rawTrades,
      getLiveQuoteMap(),
      getLiveFxMap()
    );
    const kpis = computePortfolioKPIs(trades);
    const securities = getAllSecurities();
    const forexPairs = getAllForexPairs();

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
