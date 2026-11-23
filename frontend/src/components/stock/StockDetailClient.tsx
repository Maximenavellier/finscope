"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Calculator, LayoutGrid, Target, Users } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { AnalystsTab } from "@/components/stock/AnalystsTab";
import { FinanceGrowthTab } from "@/components/stock/FinanceGrowthTab";
import { OverviewTab } from "@/components/stock/OverviewTab";
import { PeersComparisonTab } from "@/components/stock/PeersComparisonTab";
import { RedFlagsCard } from "@/components/stock/RedFlagsCard";
import { ScoreBanner } from "@/components/stock/ScoreBanner";
import { StockHeader } from "@/components/stock/StockHeader";
import { ValuationTab } from "@/components/stock/ValuationTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStockAnalysts,
  getStockFundamentals,
  getStockOverview,
  getStockPrices,
  getStockSegments,
  getStockSurprises,
} from "@/lib/api";
import type {
  AnalystsResponse,
  FundamentalsResponse,
  PriceHistoryResponse,
  SegmentsResponse,
  StockOverviewResponse,
  SurprisesResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type TabId = "overview" | "finance" | "analysts" | "valuation" | "peers";

export function StockDetailClient({ ticker }: { ticker: string }) {
  const { displayCurrency } = useDisplayCurrency();
  const [overview, setOverview] = useState<StockOverviewResponse | null>(null);
  const [prices, setPrices] = useState<PriceHistoryResponse | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsResponse | null>(null);
  const [surprises, setSurprises] = useState<SurprisesResponse | null>(null);
  const [segments, setSegments] = useState<SegmentsResponse | null>(null);
  const [analysts, setAnalysts] = useState<AnalystsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [hasOpenedPeers, setHasOpenedPeers] = useState(false);
  const [peersRefreshKey, setPeersRefreshKey] = useState(0);

  const loadAll = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const [ovRes, pxRes, fundRes, surpRes, segRes, anRes] = await Promise.allSettled([
          getStockOverview(ticker, forceRefresh),
          getStockPrices(ticker, "5Y", displayCurrency, forceRefresh),
          getStockFundamentals(ticker, "annual", false, forceRefresh),
          getStockSurprises(ticker, forceRefresh),
          getStockSegments(ticker, forceRefresh),
          getStockAnalysts(ticker, forceRefresh),
        ]);

        if (ovRes.status === "rejected") {
          throw ovRes.reason;
        }
        setOverview(ovRes.value);
        if (pxRes.status === "fulfilled") setPrices(pxRes.value);
        if (fundRes.status === "fulfilled") setFundamentals(fundRes.value);
        if (surpRes.status === "fulfilled") setSurprises(surpRes.value);
        if (segRes.status === "fulfilled") setSegments(segRes.value);
        if (anRes.status === "fulfilled") setAnalysts(anRes.value);

        if (forceRefresh && hasOpenedPeers) {
          setPeersRefreshKey((k) => k + 1);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Impossible de charger les données pour ${ticker}.`
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [ticker, hasOpenedPeers]
  );

  useEffect(() => {
    setActiveTab("overview");
    setHasOpenedPeers(false);
    loadAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  if (loading && !overview) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !overview) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 p-6">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            Titre introuvable ({ticker})
          </h1>
          <p className="text-sm text-rose-600 dark:text-rose-400">
            {error || "Aucune donnée financière disponible pour ce symbole."}
          </p>
          <div className="flex items-center gap-3">
            <Button onClick={() => loadAll(false)}>Réessayer</Button>
            <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
              Retour à l&apos;accueil
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isEtf = overview.info.asset_type === "ETF";

  const tabs: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview", label: "Vue d'ensemble", icon: LayoutGrid },
    { id: "finance", label: "Finances & Croissance", icon: BarChart3 },
    { id: "analysts", label: "Prévisions & Analystes", icon: Target },
    { id: "valuation", label: "Valorisation", icon: Calculator },
    { id: "peers", label: "Concurrents", icon: Users },
  ];

  return (
    <div className="space-y-6">
      <StockHeader
        info={overview.info}
        updatedAt={overview.updated_at}
        isStale={overview.is_stale}
        refreshing={refreshing}
        onRefresh={() => loadAll(true)}
      />

      <ScoreBanner scores={overview.scores} currency={overview.info.currency} />

      {!isEtf && <RedFlagsCard redFlags={overview.red_flags || []} />}

      {!isEtf && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-200 pb-2 dark:border-slate-800">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (tab.id === "peers") setHasOpenedPeers(true);
                  setActiveTab(tab.id);
                }}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer",
                  active
                    ? "bg-blue-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {(isEtf || activeTab === "overview") && (
        <OverviewTab
          info={overview.info}
          scores={overview.scores}
          prices={prices}
          fairValue={overview.fair_value?.fair_value}
        />
      )}

      {!isEtf && activeTab === "finance" && (
        <FinanceGrowthTab
          ticker={overview.info.ticker}
          fundamentals={fundamentals}
          segments={segments}
        />
      )}

      {!isEtf && activeTab === "analysts" && (
        <AnalystsTab
          ticker={overview.info.ticker}
          analysts={analysts}
          surprises={surprises}
          currency={overview.info.currency}
        />
      )}

      {!isEtf && activeTab === "valuation" && (
        <ValuationTab
          key={overview.info.ticker}
          ticker={overview.info.ticker}
          fairValue={overview.fair_value}
          fundamentals={fundamentals}
          currency={overview.info.currency}
          currentPe={overview.scores?.metrics?.pe ?? overview.info.pe}
          currentPFcf={overview.scores?.metrics?.p_fcf}
        />
      )}

      {!isEtf && hasOpenedPeers && (
        <div className={cn(activeTab !== "peers" && "hidden")}>
          <PeersComparisonTab ticker={overview.info.ticker} refreshKey={peersRefreshKey} />
        </div>
      )}
    </div>
  );
}
