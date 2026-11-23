"use client";

import { useCallback, useEffect, useState } from "react";
import { Filter } from "lucide-react";
import {
  ScreenerFiltersPanel,
  type ScreenerFiltersState,
} from "@/components/screener/ScreenerFiltersPanel";
import { ScreenerPresets } from "@/components/screener/ScreenerPresets";
import { ScreenerTable } from "@/components/screener/ScreenerTable";
import { SeedStatusBanner } from "@/components/screener/SeedStatusBanner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getScreener, getScreenerSeedStatus, startScreenerSeed } from "@/lib/api";
import type { ScreenerQueryParams, ScreenerResponse, SeedStatusResponse } from "@/lib/types";

const INITIAL_FILTERS: ScreenerFiltersState = {
  q: "",
  asset_type: "ALL",
  region: "ALL",
  pea_only: false,
  only_scored: false,
  sector: "ALL",
  min_global: "",
  min_valuation: "",
  min_growth: "",
  min_quality: "",
  min_health: "",
  max_pe: "",
  min_rev_growth_pct: "",
  max_net_debt_ebitda: "",
};

const PRESET_FILTER_PATCHES: Record<string, Partial<ScreenerFiltersState>> = {
  quality_on_sale: {
    asset_type: "EQUITY",
    min_quality: "70",
    min_valuation: "60",
    only_scored: true,
  },
  profitable_hypergrowth: {
    asset_type: "EQUITY",
    min_growth: "70",
    min_quality: "60",
    min_rev_growth_pct: "15",
    only_scored: true,
  },
  financial_fortresses: {
    asset_type: "EQUITY",
    min_health: "75",
    min_quality: "65",
    max_net_debt_ebitda: "1",
    only_scored: true,
  },
  pea_eligible: {
    pea_only: true,
  },
};

function toNum(val: string): number | undefined {
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function ScreenerClient() {
  const [filters, setFilters] = useState<ScreenerFiltersState>(INITIAL_FILTERS);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("score_global");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState<number>(1);

  const [data, setData] = useState<ScreenerResponse | null>(null);
  const [seedStatus, setSeedStatus] = useState<SeedStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchScreenerData = useCallback(async () => {
    const params: ScreenerQueryParams = {
      q: filters.q || undefined,
      asset_type: filters.asset_type !== "ALL" ? filters.asset_type : undefined,
      region: filters.region !== "ALL" ? filters.region : undefined,
      pea_only: filters.pea_only ? true : undefined,
      only_scored: filters.only_scored ? true : undefined,
      sector: filters.sector !== "ALL" ? filters.sector : undefined,
      min_global: toNum(filters.min_global),
      min_valuation: toNum(filters.min_valuation),
      min_growth: toNum(filters.min_growth),
      min_quality: toNum(filters.min_quality),
      min_health: toNum(filters.min_health),
      max_pe: toNum(filters.max_pe),
      min_rev_growth_pct: toNum(filters.min_rev_growth_pct),
      max_net_debt_ebitda: toNum(filters.max_net_debt_ebitda),
      sort_by: sortBy,
      sort_dir: sortDir,
      page,
      page_size: 50,
    };

    try {
      const res = await getScreener(params);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [filters, sortBy, sortDir, page]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchScreenerData();
    }, 180);
    return () => clearTimeout(timer);
  }, [fetchScreenerData]);

  useEffect(() => {
    getScreenerSeedStatus()
      .then(setSeedStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (seedStatus?.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const next = await getScreenerSeedStatus();
        setSeedStatus(next);
        await fetchScreenerData();
        if (next.status !== "running") {
          clearInterval(interval);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [seedStatus?.status, fetchScreenerData]);

  const handleStartSeed = async (onlyMissing: boolean) => {
    const started = await startScreenerSeed({
      only_missing: onlyMissing,
      batch_size: 4,
      delay_seconds: 1.2,
    });
    setSeedStatus(started);
  };

  const handleSelectPreset = (presetId: string) => {
    if (activePreset === presetId) {
      setActivePreset(null);
      setFilters(INITIAL_FILTERS);
      setPage(1);
      return;
    }
    setActivePreset(presetId);
    setFilters({ ...INITIAL_FILTERS, ...(PRESET_FILTER_PATCHES[presetId] || {}) });
    setPage(1);
  };

  const handleFilterChange = (patch: Partial<ScreenerFiltersState>) => {
    setActivePreset(null);
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setSortDir(col === "pe" || col === "forward_pe" || col === "net_debt_ebitda" || col === "ticker" ? "asc" : "desc");
    }
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          <Filter className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <span>Screener Intelligent</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Filtrez l&apos;univers US &amp; Europe (éligible PEA) selon les 5 notes /100 et les ratios fondamentaux.
        </p>
      </div>

      <SeedStatusBanner
        scoredCount={data?.scored_count ?? 0}
        universeCount={data?.universe_count ?? 70}
        seedStatus={seedStatus}
        onStartSeed={handleStartSeed}
      />

      <ScreenerPresets
        activePreset={activePreset}
        onSelectPreset={handleSelectPreset}
        onReset={() => {
          setActivePreset(null);
          setFilters(INITIAL_FILTERS);
          setPage(1);
        }}
      />

      <ScreenerFiltersPanel
        filters={filters}
        sectors={data?.sectors || []}
        onChange={handleFilterChange}
      />

      {loading && !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              <strong className="text-slate-900 dark:text-white">{data?.total ?? 0}</strong> résultat(s)
            </span>
            {totalPages > 1 && (
              <span>
                Page {page} / {totalPages}
              </span>
            )}
          </div>

          <ScreenerTable
            items={data?.items || []}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
          />

          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Suivant
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
