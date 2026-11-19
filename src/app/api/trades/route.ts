import { NextResponse } from "next/server";
import {
  getAllTrades,
  getAllSecurities,
  getAllForexPairs,
  createTrade,
  getLiveQuoteMap,
  getLiveFxMap,
  getUserById,
  updateUserPreferences,
} from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computeTradesWithMetrics, computePortfolioKPIs } from "@/lib/trade-math";
import type { NewTradeInput } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function buildFullPayload(userId: number) {
  const rawTrades = getAllTrades(userId);
  const quoteMap = getLiveQuoteMap(userId);
  const fxMap = getLiveFxMap(userId);
  const trades = computeTradesWithMetrics(rawTrades, quoteMap, fxMap);
  const kpis = computePortfolioKPIs(trades);
  const securities = getAllSecurities(userId);
  const forexPairs = getAllForexPairs(userId);
  return { trades, kpis, securities, forexPairs };
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    return NextResponse.json(buildFullPayload(auth.user.id));
  } catch (error) {
    console.error("GET /api/trades error:", error);
    return NextResponse.json(
      { error: "Failed to fetch trades" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  try {
    const body = (await request.json()) as NewTradeInput;

    if (
      !body.ticker ||
      !body.startDate ||
      body.shares === undefined ||
      body.buyPrice === undefined ||
      body.initialStopLoss === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required trade fields (ticker, startDate, shares, buyPrice, initialStopLoss)",
        },
        { status: 400 }
      );
    }

    const created = createTrade({
      securityId: body.securityId ?? null,
      ticker: body.ticker,
      gicsSector: body.gicsSector || "Uncategorized",
      startDate: body.startDate,
      endDate: body.endDate || null,
      shares: Number(body.shares),
      buyPrice: Number(body.buyPrice),
      sellPrice:
        body.sellPrice !== null &&
          body.sellPrice !== undefined &&
          String(body.sellPrice) !== ""
          ? Number(body.sellPrice)
          : null,
      currency: body.currency || "USD",
      initialStopLoss: Number(body.initialStopLoss),
      stopMoved: Boolean(body.stopMoved),
      trimmedAt2R: Boolean(body.trimmedAt2R),
      manualLatestPrice:
        body.manualLatestPrice !== null &&
          body.manualLatestPrice !== undefined &&
          String(body.manualLatestPrice) !== ""
          ? Number(body.manualLatestPrice)
          : null,
      fxRateToEur:
        body.fxRateToEur !== undefined && body.fxRateToEur !== null
          ? Number(body.fxRateToEur)
          : undefined,
      entryFxRateToEur:
        body.entryFxRateToEur !== undefined && body.entryFxRateToEur !== null
          ? Number(body.entryFxRateToEur)
          : undefined,
      positionGroupId: body.positionGroupId ?? null,
      notes: body.notes || null,
    }, auth.user.id);

    let updatedUser = undefined;
    if (body.deductFromCash === true) {
      const entryFx =
        created.currency.toUpperCase() === "EUR" ? 1.0 : created.entryFxRateToEur;
      const entryCostEur = created.shares * created.buyPrice * entryFx;
      if (Number.isFinite(entryCostEur) && entryCostEur > 0) {
        const currentUser = getUserById(auth.user.id);
        if (currentUser) {
          const nextCashBalance = Math.max(
            0,
            Number((currentUser.cashBalance - entryCostEur).toFixed(2))
          );
          updatedUser =
            updateUserPreferences(auth.user.id, {
              cashBalance: nextCashBalance,
            }) ?? undefined;
        }
      }
    } else if (body.addToCash === true && Boolean(created.endDate?.trim())) {
      const exitPrice = created.sellPrice;
      const exitFx =
        created.currency.toUpperCase() === "EUR" ? 1.0 : created.fxRateToEur;
      if (exitPrice !== null && exitPrice !== undefined) {
        const exitProceedsEur =
          Number(created.shares) * Number(exitPrice) * Number(exitFx);
        if (Number.isFinite(exitProceedsEur) && exitProceedsEur > 0) {
          const currentUser = getUserById(auth.user.id);
          if (currentUser) {
            const nextCashBalance = Number(
              (currentUser.cashBalance + exitProceedsEur).toFixed(2)
            );
            updatedUser =
              updateUserPreferences(auth.user.id, {
                cashBalance: nextCashBalance,
              }) ?? undefined;
          }
        }
      }
    }

    return NextResponse.json(
      {
        created,
        ...buildFullPayload(auth.user.id),
        ...(updatedUser ? { user: updatedUser } : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/trades error:", error);
    return NextResponse.json(
      { error: "Failed to create trade" },
      { status: 500 }
    );
  }
}
