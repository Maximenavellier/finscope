"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { Loader2, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { Badge } from "@/components/ui/badge";
import { getPortfolioPerformance, searchAssets } from "@/lib/api";
import { formatDateFR, formatPercent, isValidNumber } from "@/lib/formatters";
import type { PortfolioPerformanceResponse, SearchAssetItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "1D", label: "1J" },
  { key: "5D", label: "5J" },
  { key: "1M", label: "1M" },
  { key: "3M", label: "3M" },
  { key: "6M", label: "6M" },
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1A" },
  { key: "MAX", label: "MAX" },
];

const PRESET_BENCHMARKS = [
  { ticker: "^GSPC", label: "S&P 500" },
  { ticker: "CW8.PA", label: "MSCI World (CW8)" },
  { ticker: "^NDX", label: "NASDAQ-100" },
];

interface PortfolioPerformanceCardProps {
  positionsCount: number;
  refreshSignal?: number;
}

export function PortfolioPerformanceCard({
  positionsCount,
  refreshSignal = 0,
}: PortfolioPerformanceCardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { displayCurrency } = useDisplayCurrency();

  const [period, setPeriod] = useState("1Y");
  const [benchmark, setBenchmark] = useState("^GSPC");
  const [customQuery, setCustomQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchAssetItem[]>([]);
  const [scaleMode, setScaleMode] = useState<"base100" | "pct">("base100");
  const [calcMode, setCalcMode] = useState<"real" | "backtest">("real");
  const [data, setData] = useState<PortfolioPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPerf = useCallback(
    async (
      nextPeriod: string,
      nextBench: string,
      nextMode: "real" | "backtest",
      forceRefresh = false
    ) => {
      if (positionsCount <= 0) {
        setData(null);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await getPortfolioPerformance(
          nextPeriod,
          nextBench,
          displayCurrency,
          nextMode,
          forceRefresh
        );
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement du comparateur.");
      } finally {
        setLoading(false);
      }
    },
    [positionsCount, displayCurrency]
  );

  useEffect(() => {
    loadPerf(period, benchmark, calcMode, false);
  }, [loadPerf, period, benchmark, calcMode, refreshSignal]);

  useEffect(() => {
    const q = customQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchAssets(q, 5);
        if (!cancelled) setSuggestions(res.results);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customQuery]);

  const applyCustomBenchmark = (sym: string) => {
    const cleaned = sym.trim();
    if (!cleaned) return;
    setBenchmark(cleaned);
    setCustomQuery("");
    setSuggestions([]);
  };

  const makeOption = (isModal: boolean): EChartsOption => {
    if (!data || data.points.length === 0) return {};
    const dates = data.points.map((p) => formatDateFR(p.date));
    const portSeries = data.points.map((p) =>
      scaleMode === "base100" ? p.portfolio_base100 : p.portfolio_pct
    );
    const benchSeries = data.points.map((p) =>
      scaleMode === "base100" ? p.benchmark_base100 : p.benchmark_pct
    );

    const textColor = isDark ? "#94A3B8" : "#64748B";
    const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";

    return {
      animationDuration: 280,
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
        valueFormatter: (v) =>
          isValidNumber(v)
            ? scaleMode === "base100"
              ? `${v.toFixed(1).replace(".", ",")} pts`
              : `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")} %`
            : "—",
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        left: 12,
        right: 26,
        top: 32,
        bottom: isModal ? 54 : 24,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => (scaleMode === "base100" ? `${v}` : `${v} %`),
        },
        splitLine: { lineStyle: { color: splitColor } },
      },
      ...(isModal
        ? {
            dataZoom: [
              { type: "inside", xAxisIndex: 0 },
              { type: "slider", xAxisIndex: 0, height: 18, bottom: 8, borderColor: splitColor },
            ],
          }
        : {}),
      series: [
        {
          name: "Mon Portefeuille",
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: portSeries,
          lineStyle: { color: "#2563EB", width: 2.5 },
          itemStyle: { color: "#2563EB" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(37, 99, 235, 0.20)" },
                { offset: 1, color: "rgba(37, 99, 235, 0.01)" },
              ],
            },
          },
          markLine: {
            symbol: ["none", "none"],
            silent: true,
            lineStyle: { color: splitColor, type: "dashed", width: 1 },
            label: { show: false },
            data: [{ yAxis: scaleMode === "base100" ? 100 : 0 }],
          },
        },
        {
          name: data.benchmark_name || data.benchmark,
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: benchSeries,
          lineStyle: { color: "#94A3B8", width: 2, type: "dashed" },
          itemStyle: { color: "#94A3B8" },
        },
      ],
    };
  };

  const compactOption = useMemo(() => makeOption(false), [data, scaleMode, isDark]);
  const modalOption = useMemo(() => makeOption(true), [data, scaleMode, isDark]);

  const topControls = (
    <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
      {/* Horizon + Scale Mode */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                period === p.key
                  ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { id: "base100", label: "Base 100" },
              { id: "pct", label: "Var. %" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setScaleMode(m.id)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                scaleMode === m.id
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 dark:text-slate-300"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { id: "real", label: "Réel", tip: "Performance réelle (TWR selon dates d'achat)" },
              { id: "backtest", label: "Backtest", tip: "Backtest de la composition actuelle" },
            ] as const
          ).map((cm) => (
            <button
              key={cm.id}
              type="button"
              title={cm.tip}
              onClick={() => setCalcMode(cm.id)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                calcMode === cm.id
                  ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                  : "text-slate-600 dark:text-slate-300"
              )}
            >
              {cm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Benchmarks + Custom Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {PRESET_BENCHMARKS.map((b) => (
            <button
              key={b.ticker}
              type="button"
              onClick={() => applyCustomBenchmark(b.ticker)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap",
                benchmark === b.ticker
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              )}
            >
              {b.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (suggestions.length > 0 && customQuery.trim().toUpperCase() !== suggestions[0].ticker) {
              applyCustomBenchmark(suggestions[0].ticker);
            } else {
              applyCustomBenchmark(customQuery);
            }
          }}
          className="relative"
        >
          <div className="flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              placeholder="Comparer ticker (NVDA, LVMH...)"
              className="w-40 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
          </div>

          {suggestions.length > 0 && (
            <ul className="absolute right-0 z-30 mt-1 max-h-52 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              {suggestions.map((s) => (
                <li key={s.ticker}>
                  <button
                    type="button"
                    onClick={() => applyCustomBenchmark(s.ticker)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <span className="truncate">
                      <strong className="text-slate-900 dark:text-white">{s.ticker}</strong>{" "}
                      <span className="text-slate-500">— {s.name}</span>
                    </span>
                    <span className="ml-2 shrink-0 text-[10px] font-semibold text-slate-400">
                      {s.asset_type === "ETF" ? "ETF" : s.region}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>
    </div>
  );

  const hasPoints = Boolean(data && data.points.length >= 2);
  const alpha = data?.alpha_pts;
  const avgAlpha = data?.avg_alpha_pts;

  return (
    <ExpandableChartCard
      title="Performance Portefeuille vs Benchmark"
      subtitle={`${
        data?.calculation_label ||
        (calcMode === "real"
          ? "Performance réelle (selon dates d'achat)"
          : "Backtest composition actuelle")
      } · ${displayCurrency === "USD" ? "USD ($)" : "EUR (€)"} · Indice : ${data?.benchmark_name || benchmark}`}
      tooltip="Mesure la vraie performance de votre portefeuille en TWR (Time-Weighted Return) : chaque titre entre à sa date d'achat sans créer de faux saut lorsque vous ajoutez du capital. Le mode Backtest simule vos lignes actuelles sur toute la période."
      option={compactOption}
      modalOption={modalOption}
      topControls={topControls}
      chartClassName="h-64 sm:h-72"
      hasData={hasPoints}
      emptyMessage={
        positionsCount === 0
          ? "Ajoutez au moins une position pour comparer votre portefeuille au marché."
          : error || (loading ? "Calcul de l'historique en cours..." : "Données insuffisantes pour cette période.")
      }
      downloadName={`portefeuille-vs-${benchmark}-${period}`}
      footer={
        data && hasPoints ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={(data.portfolio_perf_pct ?? 0) >= 0 ? "emerald" : "coral"}>
              Perf Portefeuille : {formatPercent(data.portfolio_perf_pct, { signed: true })}
            </Badge>
            <Badge variant="secondary">
              Perf {data.benchmark_name || data.benchmark} :{" "}
              {formatPercent(data.benchmark_perf_pct, { signed: true })}
            </Badge>
            {isValidNumber(alpha) && (
              <Badge variant={alpha >= 0 ? "emerald" : "coral"} className="font-semibold">
                Surperformance / Alpha : {alpha > 0 ? "+" : ""}
                {alpha.toFixed(2).replace(".", ",")} pts
              </Badge>
            )}
            {isValidNumber(avgAlpha) && (
              <Badge
                variant={avgAlpha >= 0 ? "emerald" : "coral"}
                className="font-semibold"
                title="Moyenne quotidienne de l'écart (Portefeuille − Benchmark) sur toute la période affichée"
              >
                Écart moyen : {avgAlpha > 0 ? "+" : ""}
                {avgAlpha.toFixed(2).replace(".", ",")} pts
              </Badge>
            )}
          </div>
        ) : null
      }
    />
  );
}
