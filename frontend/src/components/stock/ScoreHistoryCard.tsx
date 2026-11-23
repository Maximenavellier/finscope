"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useTheme } from "next-themes";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPrice, isValidNumber } from "@/lib/formatters";
import type { ScoreHistoryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ScoreHistoryCardProps {
  scoreHistory: ScoreHistoryResponse | null;
  currency?: string | null;
}

export function ScoreHistoryCard({ scoreHistory, currency }: ScoreHistoryCardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [showPillars, setShowPillars] = useState(false);

  const points = useMemo(() => scoreHistory?.points || [], [scoreHistory]);
  const hasChart = points.length >= 2;
  const delta = scoreHistory?.trend_delta_pts;
  const trendLabel = scoreHistory?.trend_label || "Stable";
  const trendVariant =
    delta != null && delta >= 4 ? "emerald" : delta != null && delta <= -4 ? "coral" : "secondary";

  const makeOption = (isModal: boolean): EChartsOption => {
    if (!hasChart) return {};
    const labels = points.map((p) => (p.label === "Actuel" ? "Actuel" : p.label));
    const textColor = isDark ? "#94A3B8" : "#64748B";
    const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";

    const series: EChartsOption["series"] = [
      {
        name: "Score Global /100",
        type: "line",
        smooth: 0.2,
        symbol: "circle",
        symbolSize: 7,
        data: points.map((p) => p.score_global ?? null),
        lineStyle: { color: "#2563EB", width: 3 },
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
          lineStyle: { color: "#10B981", type: "dashed", width: 1 },
          label: { show: false },
          data: [{ yAxis: 70 }],
        },
      },
    ];

    if (showPillars) {
      series.push(
        {
          name: "Valorisation",
          type: "line",
          smooth: 0.2,
          showSymbol: false,
          data: points.map((p) => p.score_valuation ?? null),
          lineStyle: { color: "#10B981", width: 1.75, type: "dashed" },
          itemStyle: { color: "#10B981" },
        },
        {
          name: "Croissance",
          type: "line",
          smooth: 0.2,
          showSymbol: false,
          data: points.map((p) => p.score_growth ?? null),
          lineStyle: { color: "#F59E0B", width: 1.75, type: "dashed" },
          itemStyle: { color: "#F59E0B" },
        },
        {
          name: "Qualité",
          type: "line",
          smooth: 0.2,
          showSymbol: false,
          data: points.map((p) => p.score_quality ?? null),
          lineStyle: { color: "#8B5CF6", width: 1.75, type: "dashed" },
          itemStyle: { color: "#8B5CF6" },
        },
        {
          name: "Santé",
          type: "line",
          smooth: 0.2,
          showSymbol: false,
          data: points.map((p) => p.score_health ?? null),
          lineStyle: { color: "#06B6D4", width: 1.75, type: "dashed" },
          itemStyle: { color: "#06B6D4" },
        }
      );
    }

    return {
      animationDuration: 260,
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
        formatter: (params: unknown) => {
          const items = (Array.isArray(params) ? params : [params]) as Array<{
            dataIndex?: number;
          }>;
          const idx = items[0]?.dataIndex;
          if (typeof idx !== "number" || !points[idx]) return "";
          const pt = points[idx];
          const pxStr = isValidNumber(pt.price) ? formatPrice(pt.price, currency) : null;
          const rows = [
            `<div style="font-weight:600;margin-bottom:4px;">${pt.label} · ${formatDateFR(pt.date)}${
              pxStr ? ` · Cours ${pxStr}` : ""
            }</div>`,
            `<div style="display:flex;justify-content:space-between;gap:12px;">` +
              `<span style="color:#2563EB;font-weight:600;">Note Globale</span>` +
              `<strong>${pt.score_global != null ? `${Math.round(pt.score_global)}/100` : "—"}</strong>` +
              `</div>`,
          ];
          if (showPillars) {
            const pList = [
              { lbl: "Valorisation", v: pt.score_valuation, c: "#10B981" },
              { lbl: "Croissance", v: pt.score_growth, c: "#F59E0B" },
              { lbl: "Qualité", v: pt.score_quality, c: "#8B5CF6" },
              { lbl: "Santé", v: pt.score_health, c: "#06B6D4" },
            ];
            for (const pil of pList) {
              if (isValidNumber(pil.v)) {
                rows.push(
                  `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;">` +
                    `<span style="color:${pil.c};">${pil.lbl}</span>` +
                    `<span>${Math.round(pil.v)}/100</span></div>`
                );
              }
            }
          }
          return rows.join("");
        },
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      grid: {
        left: 10,
        right: 18,
        top: 32,
        bottom: isModal ? 42 : 20,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: textColor, fontSize: 10, formatter: "{value}" },
        splitLine: { lineStyle: { color: splitColor } },
      },
      series,
    };
  };

  const compactOption = useMemo(
    () => makeOption(false),
    [points, showPillars, isDark, currency]
  );
  const modalOption = useMemo(
    () => makeOption(true),
    [points, showPillars, isDark, currency]
  );

  if (!scoreHistory || points.length === 0) {
    return null;
  }

  if (!hasChart) {
    const pt = points[0];
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Évolution de la Note /100</CardTitle>
              <CardDescription>
                Le suivi s&apos;enrichit automatiquement à chaque visite (snapshots quotidiens + exercices annuels).
              </CardDescription>
            </div>
            <Badge variant="secondary" className="tabular-nums">
              Note actuelle : {pt.score_global != null ? `${Math.round(pt.score_global)}/100` : "—"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-1 text-xs text-slate-500 dark:text-slate-400">
          Premier relevé enregistré le {formatDateFR(pt.date)}. Revenez après les prochaines mises à jour pour visualiser la tendance dans le temps.
        </CardContent>
      </Card>
    );
  }

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={trendVariant} className="inline-flex items-center gap-1 tabular-nums">
          {delta != null && delta >= 0 ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span>
            {trendLabel}
            {delta != null ? ` (${delta > 0 ? "+" : ""}${delta.toFixed(1).replace(".", ",")} pts)` : ""}
          </span>
        </Badge>
        <span className="text-[11px] text-slate-400">
          Ligne verte pointillée = seuil qualité 70/100
        </span>
      </div>

      <button
        type="button"
        onClick={() => setShowPillars((v) => !v)}
        className={cn(
          "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
          showPillars
            ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        )}
      >
        {showPillars ? "Masquer les 4 piliers" : "Afficher les 4 piliers"}
      </button>
    </div>
  );

  return (
    <ExpandableChartCard
      title="Évolution de la Note /100"
      subtitle="Comparaison historique des fondamentaux (bilans annuels + cours de l'époque + snapshots sauvegardés)"
      tooltip="Reconstitue la note FinScope à chaque clôture annuelle à partir du cours et des comptes de l'époque, puis complète avec vos snapshots quotidiens pour voir si l'entreprise s'améliore ou se dégrade."
      option={compactOption}
      modalOption={modalOption}
      topControls={controls}
      chartClassName="h-56 sm:h-64"
      hasData={hasChart}
      downloadName={`score-history-${scoreHistory.ticker}`}
    />
  );
}
