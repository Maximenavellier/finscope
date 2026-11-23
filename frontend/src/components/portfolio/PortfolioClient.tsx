"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, Plus, RefreshCw, Star, TrendingUp } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { ClosedSalesSection } from "@/components/portfolio/ClosedSalesSection";
import { DcaAssistantCard } from "@/components/portfolio/DcaAssistantCard";
import { ExportBackupMenu } from "@/components/portfolio/ExportBackupMenu";
import { PortfolioDonutCard } from "@/components/portfolio/PortfolioDonutCard";
import { PortfolioPerformanceCard } from "@/components/portfolio/PortfolioPerformanceCard";
import { PortfolioPeriodicReturnsCard } from "@/components/portfolio/PortfolioPeriodicReturnsCard";
import { PositionModal } from "@/components/portfolio/PositionModal";
import { PositionsTable } from "@/components/portfolio/PositionsTable";
import { ReinforcePositionModal } from "@/components/portfolio/ReinforcePositionModal";
import { SellPositionModal } from "@/components/portfolio/SellPositionModal";
import { WatchlistModal } from "@/components/portfolio/WatchlistModal";
import { WatchlistTab } from "@/components/portfolio/WatchlistTab";
import { WeightedStatsCard } from "@/components/portfolio/WeightedStatsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deletePortfolioPosition,
  deletePortfolioSale,
  deleteWatchlistItem,
  getPortfolio,
  getPortfolioPerformance,
  getWatchlist,
  savePortfolioCash,
} from "@/lib/api";
import type {
  PortfolioDashboardResponse,
  PortfolioPerformanceResponse,
  PortfolioPositionItem,
  PortfolioSaleItem,
  WatchlistItemEnriched,
  WatchlistResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function PortfolioClient() {
  const [portfolio, setPortfolio] = useState<PortfolioDashboardResponse | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"portfolio" | "watchlist">("portfolio");

  const [posModalOpen, setPosModalOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState<PortfolioPositionItem | null>(null);

  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellingPosition, setSellingPosition] = useState<PortfolioPositionItem | null>(null);
  const [reinforceModalOpen, setReinforceModalOpen] = useState(false);
  const [reinforcingPosition, setReinforcingPosition] = useState<PortfolioPositionItem | null>(null);
  const [perfRefreshKey, setPerfRefreshKey] = useState(0);
  const [exportNotice, setExportNotice] = useState<{ msg: string; isError: boolean } | null>(null);
  const { displayCurrency } = useDisplayCurrency();
  const [periodicMode, setPeriodicMode] = useState<"real" | "backtest">("real");
  const [targetAnnualPct, setTargetAnnualPct] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = Number(window.localStorage.getItem("finscope_target_annual_pct"));
      if (Number.isFinite(saved) && saved > 0) return saved;
    }
    return 8;
  });
  const [maxPerf, setMaxPerf] = useState<PortfolioPerformanceResponse | null>(null);
  const [maxPerfLoading, setMaxPerfLoading] = useState(false);

  const [wlModalOpen, setWlModalOpen] = useState(false);
  const [editingWatchlist, setEditingWatchlist] = useState<WatchlistItemEnriched | null>(null);

  const loadData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [pRes, wRes] = await Promise.all([
        getPortfolio(forceRefresh),
        getWatchlist(forceRefresh),
      ]);
      setPortfolio(pRes);
      setWatchlist(wRes);
      setPerfRefreshKey((k) => k + 1);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  const positionsCount = portfolio?.positions.length ?? 0;

  useEffect(() => {
    if (positionsCount <= 0) {
      setMaxPerf(null);
      return;
    }
    let cancelled = false;
    setMaxPerfLoading(true);
    getPortfolioPerformance("MAX", "^GSPC", displayCurrency, periodicMode, false)
      .then((res) => {
        if (!cancelled) setMaxPerf(res);
      })
      .catch(() => {
        if (!cancelled) setMaxPerf(null);
      })
      .finally(() => {
        if (!cancelled) setMaxPerfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [positionsCount, displayCurrency, periodicMode, perfRefreshKey]);

  const handleTargetChange = (nextVal: number) => {
    setTargetAnnualPct(nextVal);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("finscope_target_annual_pct", String(nextVal));
    }
  };

  const handleDeletePosition = async (pos: PortfolioPositionItem) => {
    await deletePortfolioPosition(pos.id);
    await loadData(false);
  };

  const handleDeleteSale = async (sale: PortfolioSaleItem) => {
    await deletePortfolioSale(sale.id);
    await loadData(false);
  };

  const handleDeleteWatchlist = async (item: WatchlistItemEnriched) => {
    await deleteWatchlistItem(item.id);
    await loadData(false);
  };

  if (loading && !portfolio) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-full" />
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const alertsCount = watchlist?.alerts_count || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Mon Espace Personnel
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Synchronisé multi-appareils · Taux EUR/USD :{" "}
            {portfolio ? portfolio.eurusd_rate.toFixed(4) : "—"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/projections"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
            <span>Projections PEA</span>
          </Link>
          <ExportBackupMenu
            onRestored={() => loadData(false)}
            onNotice={(msg, isError = false) => {
              setExportNotice({ msg, isError });
              setTimeout(() => setExportNotice(null), 5000);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => loadData(true)}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            <span>{refreshing ? "Actualisation..." : "Rafraîchir"}</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingPosition(null);
              setPosModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Ajouter une position</span>
          </Button>
        </div>
      </div>

      {exportNotice && (
        <div
          className={cn(
            "rounded-2xl border px-4 py-2.5 text-xs font-medium",
            exportNotice.isError
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
          )}
        >
          {exportNotice.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab("portfolio")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer",
            activeTab === "portfolio"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          )}
        >
          <Briefcase className="h-4 w-4" />
          <span>Mon Portefeuille ({portfolio?.positions.length ?? 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("watchlist")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer",
            activeTab === "watchlist"
              ? "bg-blue-600 text-white shadow-xs"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          )}
        >
          <Star className="h-4 w-4" />
          <span>Watchlist ({watchlist?.items.length ?? 0})</span>
          {alertsCount > 0 && (
            <Badge variant="emerald" className="ml-0.5">
              {alertsCount}
            </Badge>
          )}
        </button>
      </div>

      {activeTab === "portfolio" && portfolio && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.45fr]">
            <PortfolioDonutCard donuts={portfolio.donuts} />
            <WeightedStatsCard
              stats={portfolio.stats}
              annualizedReturnPct={maxPerf?.portfolio_cagr_pct}
              elapsedYears={maxPerf?.elapsed_years}
              targetAnnualReturnPct={targetAnnualPct}
              loadingReturn={maxPerfLoading}
              onSaveCash={async (cashEur) => {
                await savePortfolioCash(cashEur);
                await loadData(false);
              }}
            />
          </div>

          <PortfolioPerformanceCard
            positionsCount={portfolio.positions.length}
            refreshSignal={perfRefreshKey}
          />

          <PortfolioPeriodicReturnsCard
            data={maxPerf}
            loading={maxPerfLoading}
            calcMode={periodicMode}
            onCalcModeChange={setPeriodicMode}
            targetAnnualPct={targetAnnualPct}
            onTargetAnnualPctChange={handleTargetChange}
          />

          <PositionsTable
            positions={portfolio.positions}
            onReinforce={(pos) => {
              setReinforcingPosition(pos);
              setReinforceModalOpen(true);
            }}
            onEdit={(pos) => {
              setEditingPosition(pos);
              setPosModalOpen(true);
            }}
            onSell={(pos) => {
              setSellingPosition(pos);
              setSellModalOpen(true);
            }}
            onDelete={handleDeletePosition}
          />

          <ClosedSalesSection
            sales={portfolio.sales || []}
            totalRealizedPnlEur={portfolio.total_realized_pnl_eur || 0}
            onDeleteSale={handleDeleteSale}
          />

          <DcaAssistantCard refreshSignal={perfRefreshKey} />
        </div>
      )}

      {activeTab === "watchlist" && (
        <WatchlistTab
          watchlist={watchlist}
          onAdd={() => {
            setEditingWatchlist(null);
            setWlModalOpen(true);
          }}
          onEdit={(item) => {
            setEditingWatchlist(item);
            setWlModalOpen(true);
          }}
          onDelete={handleDeleteWatchlist}
        />
      )}

      <PositionModal
        open={posModalOpen}
        onOpenChange={setPosModalOpen}
        initialPosition={editingPosition}
        onSaved={() => loadData(false)}
      />

      <SellPositionModal
        open={sellModalOpen}
        onOpenChange={setSellModalOpen}
        position={sellingPosition}
        onSold={() => loadData(false)}
      />

      <ReinforcePositionModal
        open={reinforceModalOpen}
        onOpenChange={setReinforceModalOpen}
        position={reinforcingPosition}
        onReinforced={() => loadData(false)}
      />

      <WatchlistModal
        open={wlModalOpen}
        onOpenChange={setWlModalOpen}
        initialItem={editingWatchlist}
        onSaved={() => loadData(false)}
      />
    </div>
  );
}
