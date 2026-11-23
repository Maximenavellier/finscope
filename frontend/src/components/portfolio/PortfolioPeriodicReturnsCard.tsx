"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { Badge } from "@/components/ui/badge";
import { formatDateFR, formatPercent, isValidNumber } from "@/lib/formatters";
import type { PeriodicReturnItem, PortfolioPerformanceResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PortfolioPeriodicReturnsCardProps {
  data: PortfolioPerformanceResponse | null;
  loading: boolean;
  calcMode: "real" | "backtest";
  onCalcModeChange: (mode: "real" | "backtest") => void;
  targetAnnualPct: number;
  onTargetAnnualPctChange: (pct: number) => void;
}

export function PortfolioPeriodicReturnsCard({
  data,
  loading,
  calcMode,
  onCalcModeChange,
  targetAnnualPct,
  onTargetAnnualPctChange,
}: PortfolioPeriodicReturnsCardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [granularity, setGranularity] = useState<"quarterly" | "annual">("quarterly");

  const items: PeriodicReturnItem[] = useMemo(() => {
    if (!data) return [];
    return granularity === "annual"
      ? data.annual_returns || []
      : data.quarterly_returns || [];
  }, [data, granularity]);

  // Equivalent quarterly target from annual target: (1 + r)^(1/4) - 1
  const periodTargetPct = useMemo(() => {
    if (granularity === "annual") return targetAnnualPct;
    const eq = (Math.pow(Math.max(0.01, 1 + targetAnnualPct / 100), 0.25) - 1) * 100;
    return Math.round(eq * 100) / 100;
  }, [granularity, targetAnnualPct]);

  const summary = useMemo(() => {
    if (items.length === 0) return null;
    const best = items.reduce((a, b) =>
      b.portfolio_return_pct > a.portfolio_return_pct ? b : a
    );
    const worst = items.reduce((a, b) =>
      b.portfolio_return_pct < a.portfolio_return_pct ? b : a
    );
    const posCount = items.filter((i) => i.portfolio_return_pct >= 0).length;
    return { best, worst, posCount, total: items.length };
  }, [items]);

  const makeOption = (isModal: boolean): EChartsOption => {
    if (items.length === 0) return {};
    const labels = items.map((i) => i.label);
    const textColor = isDark ? "#94A3B8" : "#64748B";
    const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";

    const barData = items.map((item) => ({
      value: item.portfolio_return_pct,
      itemStyle: {
        color:
          item.portfolio_return_pct >= periodTargetPct
            ? "#10B981"
            : item.portfolio_return_pct >= 0
              ? "#3B82F6"
              : "#F43F5E",
        borderRadius: item.portfolio_return_pct >= 0 ? [6, 6, 0, 0] : [0, 0, 6, 6],
      },
    }));

    return {
      animationDuration: 280,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
        formatter: (params: unknown) => {
          const arr = Array.isArray(params) ? params : [params];
          const first = arr[0] as { dataIndex?: number } | undefined;
          const idx = first?.dataIndex ?? -1;
          const row = items[idx];
          if (!row) return "";
          const fmt = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2).replace(".", ",")} %`;
          const alphaStr = `${row.alpha_pts > 0 ? "+" : ""}${row.alpha_pts.toFixed(2).replace(".", ",")} pts`;
          return [
            `<strong>${row.label}</strong> <span style="opacity:0.7">(${formatDateFR(row.start_date)} → ${formatDateFR(row.end_date)})</span>`,
            `Mon Portefeuille : <strong>${fmt(row.portfolio_return_pct)}</strong>`,
            `${data?.benchmark_name || "Benchmark"} : <strong>${fmt(row.benchmark_return_pct)}</strong>`,
            `Écart / Alpha : <strong>${alphaStr}</strong>`,
          ].join("<br/>");
        },
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        left: 12,
        right: 22,
        top: 36,
        bottom: isModal ? 54 : 26,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => `${v} %`,
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
          name: "Mon Portefeuille (%)",
          type: "bar",
          barMaxWidth: 36,
          data: barData,
          label: {
            show: true,
            position: "top",
            color: textColor,
            fontSize: 10,
            formatter: (p: { value?: unknown }) => {
              const v = Number(p.value);
              return Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}%` : "";
            },
          },
          markLine: {
            symbol: ["none", "none"],
            silent: true,
            lineStyle: { color: "#F59E0B", type: "dashed", width: 1.5 },
            label: {
              formatter: `Objectif ${periodTargetPct.toFixed(1).replace(".", ",")} %`,
              position: "insideEndTop",
              color: "#F59E0B",
              fontSize: 10,
              fontWeight: 600,
            },
            data: [{ yAxis: periodTargetPct }],
          },
        },
        {
          name: `${data?.benchmark_name || "S&P 500"} (%)`,
          type: "bar",
          barMaxWidth: 22,
          data: items.map((i) => i.benchmark_return_pct),
          itemStyle: {
            color: isDark ? "rgba(148,163,184,0.45)" : "rgba(148,163,184,0.55)",
            borderRadius: [4, 4, 0, 0],
          },
        },
      ],
    };
  };

  const compactOption = useMemo(() => makeOption(false), [items, data, periodTargetPct, isDark]);
  const modalOption = useMemo(() => makeOption(true), [items, data, periodTargetPct, isDark]);

  const topControls = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { id: "quarterly", label: "Par trimestre" },
              { id: "annual", label: "Par année" },
            ] as const
          ).map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGranularity(g.id)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                granularity === g.id
                  ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
              )}
            >
              {g.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { id: "real", label: "Réel" },
              { id: "backtest", label: "Backtest" },
            ] as const
          ).map((cm) => (
            <button
              key={cm.id}
              type="button"
              onClick={() => onCalcModeChange(cm.id)}
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

      <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800">
        <span className="text-slate-500 dark:text-slate-400">Objectif %/an :</span>
        <input
          type="number"
          min={1}
          max={40}
          step={0.5}
          value={targetAnnualPct}
          onChange={(e) => onTargetAnnualPctChange(Math.max(0.5, Number(e.target.value) || 8))}
          className="w-14 bg-transparent text-right font-bold text-slate-900 focus:outline-none dark:text-white"
        />
      </label>
    </div>
  );

  const cagr = data?.portfolio_cagr_pct;

  return (
    <ExpandableChartCard
      title="Rendements Périodiques du Portefeuille (Trimestres / Années)"
      subtitle={`${
        data?.calculation_label ||
        (calcMode === "real" ? "Performance réelle (selon dates d'achat)" : "Backtest composition actuelle")
      } · Vert = objectif atteint · Bleu = positif · Rouge = négatif`}
      tooltip="Permet de suivre le rythme de vos gains période par période (par trimestre ou par année) pour repérer d'éventuels ralentissements ou accélérations par rapport à votre objectif annuel."
      option={compactOption}
      modalOption={modalOption}
      topControls={topControls}
      chartClassName="h-64 sm:h-72"
      hasData={items.length > 0}
      emptyMessage={loading ? "Calcul des rendements périodiques..." : "Pas encore assez d'historique pour découper par période."}
      downloadName={`rendements-portefeuille-${granularity}`}
      footer={
        summary ? (
          <div className="flex flex-wrap items-center gap-2">
            {isValidNumber(cagr) && (
              <Badge variant={cagr >= targetAnnualPct ? "emerald" : "amber"} className="font-semibold">
                Moyenne annualisée : {formatPercent(cagr, { signed: true })} / an
              </Badge>
            )}
            <Badge variant="emerald">
              Meilleur : {summary.best.label} ({formatPercent(summary.best.portfolio_return_pct, { signed: true })})
            </Badge>
            <Badge variant={summary.worst.portfolio_return_pct >= 0 ? "secondary" : "coral"}>
              Moins bon : {summary.worst.label} ({formatPercent(summary.worst.portfolio_return_pct, { signed: true })})
            </Badge>
            <Badge variant="outline">
              Périodes positives : {summary.posCount}/{summary.total}
            </Badge>
          </div>
        ) : null
      }
    />
  );
}
