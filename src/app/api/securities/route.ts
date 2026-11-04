import { NextResponse } from "next/server";
import {
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  upsertSecurity,
  updateSecurityById,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import { fetchYahooQuote } from "@/lib/quote-provider";
import { mapToYahooTicker } from "@/lib/ticker-mapper";
import type { NewSecurityInput } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function buildFullPayload() {
  const rawTrades = getAllTrades();
  const quoteMap = getLiveQuoteMap();
  const fxMap = getLiveFxMap();
  const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
  const kpis = computePortfolioKPIs(trades);
  const securities = getAllSecurities();
  const forexPairs = getAllForexPairs();
  return { trades, kpis, securities, forexPairs };
}

export async function GET() {
  try {
    return NextResponse.json(buildFullPayload());
  } catch (error) {
    console.error("GET /api/securities error:", error);
    return NextResponse.json(
      { error: "Failed to fetch securities" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as NewSecurityInput & {
      syncQuoteNow?: boolean;
    };

    if (!body.ticker) {
      return NextResponse.json(
        { error: "Ticker is required" },
        { status: 400 }
      );
    }

    const mapped = mapToYahooTicker(body.ticker, body.currency);
    const unifiedTicker = (mapped.yahooTicker || mapped.rawTicker).toUpperCase();

    let created = upsertSecurity({
      ...body,
      ticker: unifiedTicker,
      currency: body.currency || mapped.inferredCurrency,
    });

    if (body.syncQuoteNow && created.quoteProvider === "YAHOO") {
      try {
        const quote = await fetchYahooQuote(created.ticker, true);
        created =
          updateSecurityById(created.id, {
            latestPrice: quote.regularMarketPrice,
            previousClose: quote.previousClose,
            name:
              !body.name || body.name === created.ticker
                ? quote.longName || quote.shortName || created.name
                : created.name,
            gicsSector:
              (!body.gicsSector || body.gicsSector === "Uncategorized") &&
                quote.sector
                ? quote.sector
                : created.gicsSector,
            currency: quote.currency || created.currency,
            lastQuoteAt: new Date().toISOString(),
            quoteStatus: "OK",
            quoteError: null,
          }) || created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Quote fetch failed";
        created =
          updateSecurityById(created.id, {
            quoteStatus: "ERROR",
            quoteError: msg,
          }) || created;
      }
    }

    return NextResponse.json(
      { security: created, ...buildFullPayload() },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/securities error:", error);
    return NextResponse.json(
      { error: "Failed to create security" },
      { status: 500 }
    );
  }
}

