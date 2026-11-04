import { NextResponse } from "next/server";
import {
  getSecurityById,
  updateSecurityById,
  deleteSecurityById,
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  getLiveQuoteMap,
  getLiveFxMap,
} from "@/lib/db";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/sepa-math";
import { fetchYahooQuote } from "@/lib/quote-provider";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const secId = Number(id);
    if (Number.isNaN(secId)) {
      return NextResponse.json(
        { error: "Invalid security ID" },
        { status: 400 }
      );
    }

    const body = (await request.json()) as Partial<NewSecurityInput> & {
      syncQuote?: boolean;
    };

    let security = getSecurityById(secId);
    if (!security) {
      return NextResponse.json(
        { error: "Security not found" },
        { status: 404 }
      );
    }

    if (Object.keys(body).some((k) => k !== "syncQuote")) {
      security = updateSecurityById(secId, {
        ...body,
        quoteStatus:
          body.quoteProvider === "MANUAL" ? "MANUAL" : security.quoteStatus,
      });
    }

    let syncErrorMessage: string | null = null;

    if (body.syncQuote && security) {
      try {
        const quote = await fetchYahooQuote(security.ticker, true);
        security = updateSecurityById(secId, {
          latestPrice: quote.regularMarketPrice,
          previousClose: quote.previousClose,
          name:
            !security.name || security.name === security.ticker
              ? quote.longName || quote.shortName || security.name
              : security.name,
          gicsSector:
            security.gicsSector === "Uncategorized" && quote.sector
              ? quote.sector
              : security.gicsSector,
          lastQuoteAt: new Date().toISOString(),
          quoteStatus: "OK",
          quoteError: null,
        });
      } catch (err) {
        syncErrorMessage = err instanceof Error ? err.message : "Quote sync failed";
        security = updateSecurityById(secId, {
          quoteStatus: "ERROR",
          quoteError: syncErrorMessage,
        });
      }
    }

    return NextResponse.json({
      security,
      error: syncErrorMessage || undefined,
      ...buildFullPayload(),
    });
  } catch (error) {
    console.error("PATCH /api/securities/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update security" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const secId = Number(id);
    if (Number.isNaN(secId)) {
      return NextResponse.json(
        { error: "Invalid security ID" },
        { status: 400 }
      );
    }

    const deleted = deleteSecurityById(secId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Security not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true, ...buildFullPayload() });
  } catch (error) {
    console.error("DELETE /api/securities/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete security" },
      { status: 500 }
    );
  }
}

