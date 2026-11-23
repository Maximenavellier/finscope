"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  getStockNews,
  getStockOverview,
  getStockPrices,
  getStockScoreHistory,
  getStockSegments,
  getStockSurprises,
} from "@/lib/api";
import type {
  AnalystsResponse,
  FundamentalsResponse,
  PriceHistoryResponse,
  ScoreHistoryResponse,
  SegmentsResponse,
  StockNewsResponse,
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
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryResponse | null>(null);
  const [news, setNews] = useState<StockNewsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tabLoading, setTabLoading] = useState<TabId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [hasOpenedPeers, setHasOpenedPeers] = useState(false);
  const [peersRefreshKey, setPeersRefreshKey] = useState(0);

  const requestIdRef = useRef(0);
  const openedTabsRef = useRef<Set<TabId>>(new Set(["overview"]));

  const loadTabData = useCallback(
    async (tabId: TabId, forceRefresh = false, reqId?: number) => {
      const activeReqId = reqId ?? requestIdRef.current;
      if (tabId === "finance") {
        setTabLoading("finance");
        try {
          const [fundRes, segRes] = await Promise.allSettled([
            getStockFundamentals(ticker, "annual", false, forceRefresh),
            getStockSegments(ticker, forceRefresh),
          ]);
          if (requestIdRef.current !== activeReqId) return;
          if (fundRes.status === "fulfilled") setFundamentals(fundRes.value);
          if (segRes.status === "fulfilled") setSegments(segRes.value);
        } finally {
          if (requestIdRef.current === activeReqId) setTabLoading(null);
        }
      } else if (tabId === "valuation") {
        setTabLoading("valuation");
        try {
          const fundRes = await Promise.allSettled([
            getStockFundamentals(ticker, "annual", false, forceRefresh),
          ]);
          if (requestIdRef.current !== activeReqId) return;
          if (fundRes[0].status === "fulfilled") setFundamentals(fundRes[0].value);
        } finally {
          if (requestIdRef.current === activeReqId) setTabLoading(null);
        }
      } else if (tabId === "analysts") {
        setTabLoading("analysts");
        try {
          const [anRes, surpRes] = await Promise.allSettled([
            getStockAnalysts(ticker, forceRefresh),
            getStockSurprises(ticker, forceRefresh),
          ]);
          if (requestIdRef.current !== activeReqId) return;
          if (anRes.status === "fulfilled") setAnalysts(anRes.value);
          if (surpRes.status === "fulfilled") setSurprises(surpRes.value);
        } finally {
          if (requestIdRef.current === activeReqId) setTabLoading(null);
        }
      }
    },
    [ticker]
  );

  const loadAll = useCallback(
    async (forceRefresh = false) => {
      const reqId = ++requestIdRef.current;
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setOverview(null);
        setPrices(null);
        setFundamentals(null);
        setSurprises(null);
        setSegments(null);
        setAnalysts(null);
        setScoreHistory(null);
        setNews(null);
      }
      setError(null);

      try {
        // Phase 1: Overview first (populates backend caches in a single call and avoids Render 512MB RAM spikes)
        const ov = await getStockOverview(ticker, forceRefresh);
        if (requestIdRef.current !== reqId) return;
        setOverview(ov);
        setLoading(false);

        // Phase 2: Overview tab data staggered in batches of max 2 concurrent requests
        const [pxRes, shRes] = await Promise.allSettled([
          getStockPrices(ticker, "5Y", displayCurrency, forceRefresh),
          getStockScoreHistory(ticker, forceRefresh),
        ]);
        if (requestIdRef.current !== reqId) return;
        if (pxRes.status === "fulfilled") setPrices(pxRes.value);
        if (shRes.status === "fulfilled") setScoreHistory(shRes.value);

        const [newsRes, surpRes] = await Promise.allSettled([
          getStockNews(ticker, 5, forceRefresh),
          ov.info.asset_type === "ETF"
            ? Promise.resolve(null)
            : getStockSurprises(ticker, forceRefresh),
        ]);
        if (requestIdRef.current !== reqId) return;
        if (newsRes.status === "fulfilled") setNews(newsRes.value);
        if (surpRes.status === "fulfilled" && surpRes.value) setSurprises(surpRes.value);

        // Phase 3 on forceRefresh: refresh already-opened lazy tabs sequentially
        if (forceRefresh) {
          if (openedTabsRef.current.has("finance")) {
            await loadTabData("finance", true, reqId);
          } else if (openedTabsRef.current.has("valuation")) {
            await loadTabData("valuation", true, reqId);
          }
          if (openedTabsRef.current.has("analysts")) {
            await loadTabData("analysts", true, reqId);
          }
          if (hasOpenedPeers && requestIdRef.current === reqId) {
            setPeersRefreshKey((k) => k + 1);
          }
        }
      } catch (err) {
        if (requestIdRef.current !== reqId) return;
        setError(
          err instanceof Error
            ? err.message
            : `Impossible de charger les données pour ${ticker}.`
        );
      } finally {
        if (requestIdRef.current === reqId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [ticker, displayCurrency, hasOpenedPeers, loadTabData]
  );

  useEffect(() => {
    setActiveTab("overview");
    setHasOpenedPeers(false);
    openedTabsRef.current = new Set(["overview"]);
    loadAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const handleSelectTab = (tabId: TabId) => {
    openedTabsRef.current.add(tabId);
    setActiveTab(tabId);
    if (tabId === "peers") {
      setHasOpenedPeers(true);
      return;
    }
    if (tabId === "finance" && (!fundamentals || !segments)) {
      loadTabData("finance", false);
    } else if (tabId === "valuation" && !fundamentals) {
      loadTabData("valuation", false);
    } else if (tabId === "analysts" && !analysts) {
      loadTabData("analysts", false);
    }
  };

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
                onClick={() => handleSelectTab(tab.id)}
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
          scoreHistory={scoreHistory}
          surprises={surprises}
          news={news}
        />
      )}

      {!isEtf && activeTab === "finance" && (
        tabLoading === "finance" && !fundamentals ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <FinanceGrowthTab
            ticker={overview.info.ticker}
            fundamentals={fundamentals}
            segments={segments}
          />
        )
      )}

      {!isEtf && activeTab === "analysts" && (
        tabLoading === "analysts" && !analysts ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <AnalystsTab
            ticker={overview.info.ticker}
            analysts={analysts}
            surprises={surprises}
            currency={overview.info.currency}
          />
        )
      )}

      {!isEtf && activeTab === "valuation" && (
        tabLoading === "valuation" && !fundamentals ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <ValuationTab
            key={overview.info.ticker}
            ticker={overview.info.ticker}
            fairValue={overview.fair_value}
            fundamentals={fundamentals}
            currency={overview.info.currency}
            currentPe={overview.scores?.metrics?.pe ?? overview.info.pe}
            currentPFcf={overview.scores?.metrics?.p_fcf}
          />
        )
      )}

      {!isEtf && hasOpenedPeers && (
        <div className={cn(activeTab !== "peers" && "hidden")}>
          <PeersComparisonTab ticker={overview.info.ticker} refreshKey={peersRefreshKey} />
        </div>
      )}
    </div>
  );
}
