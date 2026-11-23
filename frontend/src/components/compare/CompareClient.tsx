"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Scale } from "lucide-react";
import { CompareChartsGrid } from "@/components/compare/CompareChartsGrid";
import { CompareSelectorBar } from "@/components/compare/CompareSelectorBar";
import { CompareWinnerTable } from "@/components/compare/CompareWinnerTable";
import { DuelVerdictBanner } from "@/components/compare/DuelVerdictBanner";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStockFundamentals,
  getStockOverview,
  getStockPrices,
} from "@/lib/api";
import type {
  FundamentalsResponse,
  PriceHistoryResponse,
  StockOverviewResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface AssetBundle {
  overview: StockOverviewResponse | null;
  prices: PriceHistoryResponse | null;
  fundamentals: FundamentalsResponse | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_BUNDLE: AssetBundle = {
  overview: null,
  prices: null,
  fundamentals: null,
  loading: false,
  error: null,
};

export function CompareClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { displayCurrency } = useDisplayCurrency();

  const paramA = (searchParams.get("a") || "").trim().toUpperCase();
  const paramB = (searchParams.get("b") || "").trim().toUpperCase();

  const initialA = paramA || "NVDA";
  const initialB = paramB || (paramA ? "" : "AMD");

  const [tickerA, setTickerA] = useState(initialA);
  const [tickerB, setTickerB] = useState(initialB);
  const [pricePeriod, setPricePeriod] = useState("5Y");

  const [bundleA, setBundleA] = useState<AssetBundle>(EMPTY_BUNDLE);
  const [bundleB, setBundleB] = useState<AssetBundle>(EMPTY_BUNDLE);

  const reqIdA = useRef(0);
  const reqIdB = useRef(0);

  const syncUrl = useCallback(
    (nextA: string, nextB: string) => {
      const qs = new URLSearchParams();
      if (nextA) qs.set("a", nextA);
      if (nextB) qs.set("b", nextB);
      const q = qs.toString();
      router.replace(q ? `/compare?${q}` : "/compare", { scroll: false });
    },
    [router]
  );

  const fetchSide = useCallback(
    async (
      sym: string,
      side: "A" | "B",
      period: string,
      cur: string,
      forceRefresh = false
    ) => {
      const ref = side === "A" ? reqIdA : reqIdB;
      const setter = side === "A" ? setBundleA : setBundleB;
      const cleaned = sym.trim().toUpperCase();
      if (!cleaned) {
        setter(EMPTY_BUNDLE);
        return;
      }

      const token = ++ref.current;
      setter((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const [ovRes, pxRes, fundRes] = await Promise.allSettled([
          getStockOverview(cleaned, forceRefresh),
          getStockPrices(cleaned, period, cur, forceRefresh),
          getStockFundamentals(cleaned, "annual", false, forceRefresh),
        ]);
        if (ref.current !== token) return;
        if (ovRes.status === "rejected") {
          throw ovRes.reason;
        }
        setter({
          overview: ovRes.value,
          prices: pxRes.status === "fulfilled" ? pxRes.value : null,
          fundamentals: fundRes.status === "fulfilled" ? fundRes.value : null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (ref.current !== token) return;
        setter({
          overview: null,
          prices: null,
          fundamentals: null,
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : `Impossible de charger ${cleaned}.`,
        });
      }
    },
    []
  );

  useEffect(() => {
    fetchSide(tickerA, "A", pricePeriod, displayCurrency, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerA]);

  useEffect(() => {
    fetchSide(tickerB, "B", pricePeriod, displayCurrency, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerB]);

  // Only refresh price curves when displayCurrency or pricePeriod changes
  useEffect(() => {
    const updatePricesOnly = async (
      sym: string,
      side: "A" | "B"
    ) => {
      if (!sym) return;
      const setter = side === "A" ? setBundleA : setBundleB;
      const ref = side === "A" ? reqIdA : reqIdB;
      const token = ref.current;
      try {
        const px = await getStockPrices(sym, pricePeriod, displayCurrency, false);
        if (ref.current === token) {
          setter((prev) => ({ ...prev, prices: px }));
        }
      } catch {
        // keep previous series on error
      }
    };
    updatePricesOnly(tickerA, "A");
    updatePricesOnly(tickerB, "B");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricePeriod, displayCurrency]);

  const handleSelectA = (next: string) => {
    const sym = next.trim().toUpperCase();
    if (!sym) return;
    setTickerA(sym);
    syncUrl(sym, tickerB);
  };

  const handleSelectB = (next: string) => {
    const sym = next.trim().toUpperCase();
    if (!sym) return;
    setTickerB(sym);
    syncUrl(tickerA, sym);
  };

  const handleSwap = () => {
    if (!tickerA && !tickerB) return;
    const prevA = tickerA;
    const prevB = tickerB;
    setTickerA(prevB);
    setTickerB(prevA);
    setBundleA(bundleB);
    setBundleB(bundleA);
    syncUrl(prevB, prevA);
  };

  const handlePreset = (a: string, b: string) => {
    setTickerA(a);
    setTickerB(b);
    syncUrl(a, b);
  };

  const handleRefreshAll = () => {
    if (tickerA) fetchSide(tickerA, "A", pricePeriod, displayCurrency, true);
    if (tickerB) fetchSide(tickerB, "B", pricePeriod, displayCurrency, true);
  };

  const anyLoading = bundleA.loading || bundleB.loading;
  const bothReady = Boolean(bundleA.overview && bundleB.overview);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Comparateur Face-à-Face
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Comparez deux actions ou ETF côte à côte sur les prix, piliers /100, marges et valorisation.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={anyLoading}
          onClick={handleRefreshAll}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", anyLoading && "animate-spin")} />
          <span>Rafraîchir les données</span>
        </Button>
      </div>

      {/* Side-by-side search & presets */}
      <CompareSelectorBar
        tickerA={tickerA}
        tickerB={tickerB}
        nameA={bundleA.overview?.info.name}
        nameB={bundleB.overview?.info.name}
        loadingA={bundleA.loading}
        loadingB={bundleB.loading}
        onChangeA={handleSelectA}
        onChangeB={handleSelectB}
        onSwap={handleSwap}
        onSelectPreset={handlePreset}
      />

      {/* Prompt to pick Action B if opened from /stock/[ticker] */}
      {!tickerB && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Sélectionnez une <strong>Action B</strong> ci-dessus (ou cliquez un duel rapide) pour lancer la comparaison avec{" "}
            <strong className="text-slate-900 dark:text-white">{tickerA}</strong>.
          </CardContent>
        </Card>
      )}

      {/* Error messages */}
      {(bundleA.error || bundleB.error) && (
        <div className="grid gap-3 md:grid-cols-2">
          {bundleA.error && (
            <Card className="border-rose-200 dark:border-rose-900/60">
              <CardContent className="p-4 text-xs text-rose-600 dark:text-rose-400">
                <strong>{tickerA} :</strong> {bundleA.error}
              </CardContent>
            </Card>
          )}
          {bundleB.error && (
            <Card className="border-rose-200 dark:border-rose-900/60">
              <CardContent className="p-4 text-xs text-rose-600 dark:text-rose-400">
                <strong>{tickerB} :</strong> {bundleB.error}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Skeleton when loading initial duel */}
      {tickerB && !bothReady && anyLoading && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <Skeleton className="h-28 w-full" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      )}

      {/* Full Duel */}
      {bothReady && bundleA.overview && bundleB.overview && (
        <div className="space-y-6">
          <DuelVerdictBanner
            overviewA={bundleA.overview}
            overviewB={bundleB.overview}
          />

          <CompareChartsGrid
            overviewA={bundleA.overview}
            overviewB={bundleB.overview}
            pricesA={bundleA.prices}
            pricesB={bundleB.prices}
            fundamentalsA={bundleA.fundamentals}
            fundamentalsB={bundleB.fundamentals}
            pricePeriod={pricePeriod}
            onPeriodChange={setPricePeriod}
          />

          <CompareWinnerTable
            overviewA={bundleA.overview}
            overviewB={bundleB.overview}
            fundamentalsA={bundleA.fundamentals}
            fundamentalsB={bundleB.fundamentals}
          />
        </div>
      )}
    </div>
  );
}
