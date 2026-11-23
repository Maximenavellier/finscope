"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateFR, formatMultiple, formatPercent, isValidNumber } from "@/lib/formatters";
import type {
  FundamentalRecord,
  FundamentalsResponse,
  PriceHistoryResponse,
  PricePoint,
  StockOverviewResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const COLOR_A = "#2563EB";
const COLOR_B = "#8B5CF6";
const PRICE_PERIODS = [
  { key: "1Y", label: "1A" },
  { key: "3Y", label: "3A" },
  { key: "5Y", label: "5A" },
  { key: "10Y", label: "10A" },
  { key: "MAX", label: "MAX" },
];

interface CompareChartsGridProps {
  overviewA: StockOverviewResponse;
  overviewB: StockOverviewResponse;
  pricesA: PriceHistoryResponse | null;
  pricesB: PriceHistoryResponse | null;
  fundamentalsA: FundamentalsResponse | null;
  fundamentalsB: FundamentalsResponse | null;
  pricePeriod: string;
  onPeriodChange: (period: string) => void;
}

function findCloseOnOrBefore(points: PricePoint[], targetDate: string): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= targetDate) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans >= 0) return points[ans].close;
  return points.length > 0 ? points[0].close : null;
}

function yearKey(r: { fiscal_year?: number | null; period_end: string }): string {
  return r.fiscal_year ? String(r.fiscal_year) : r.period_end.slice(0, 4);
}

function buildAnnualYearLookup(fund: FundamentalsResponse | null): Map<string, FundamentalRecord> {
  const map = new Map<string, FundamentalRecord>();
  for (const r of fund?.annual || []) {
    map.set(yearKey(r), r);
  }
  return map;
}

function alignYears(fundA: FundamentalsResponse | null, fundB: FundamentalsResponse | null): string[] {
  const set = new Set<string>();
  for (const r of fundA?.annual || []) set.add(yearKey(r));
  for (const r of fundB?.annual || []) set.add(yearKey(r));
  return Array.from(set).sort().slice(-8);
}

function computePerfStatsFromAligned(
  dates: string[],
  closes: number[]
): { perfPct: number | null; cagrPct: number | null } {
  if (dates.length < 2 || closes.length < 2 || closes[0] <= 0) {
    return { perfPct: null, cagrPct: null };
  }
  const first = closes[0];
  const last = closes[closes.length - 1];
  const perfPct = ((last - first) / first) * 100;
  const ms = new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime();
  const days = ms / 86_400_000;
  const cagrPct = days >= 360 && last > 0 ? ((last / first) ** (365.25 / days) - 1) * 100 : null;
  return { perfPct, cagrPct };
}

export function CompareChartsGrid({
  overviewA,
  overviewB,
  pricesA,
  pricesB,
  fundamentalsA,
  fundamentalsB,
  pricePeriod,
  onPeriodChange,
}: CompareChartsGridProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const tkA = overviewA.info.ticker;
  const tkB = overviewB.info.ticker;

  const [priceScale, setPriceScale] = useState<"base100" | "pct">("base100");
  const [growthMetric, setGrowthMetric] = useState<"revenue" | "net_income">("revenue");
  const [growthScale, setGrowthScale] = useState<"base100" | "yoy">("base100");
  const [marginMetric, setMarginMetric] = useState<"net_margin" | "op_margin" | "gross_margin">("net_margin");
  const [profitMetric, setProfitMetric] = useState<"fcf" | "roe" | "roic">("fcf");

  const textColor = isDark ? "#94A3B8" : "#64748B";
  const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";
  const tooltipBase = {
    trigger: "axis" as const,
    backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    borderColor: isDark ? "#334155" : "#E2E8F0",
    textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
  };

  // 1. Performance boursière comparée (Base 100 / Var %)
  const priceChart = useMemo(() => {
    const rawA = (pricesA?.points || []).filter((p) => isValidNumber(p.close) && p.close > 0);
    const rawB = (pricesB?.points || []).filter((p) => isValidNumber(p.close) && p.close > 0);
    if (rawA.length < 2 || rawB.length < 2) {
      return { compact: {}, modal: {}, hasData: false, statsA: null, statsB: null };
    }
    const startDt = rawA[0].date > rawB[0].date ? rawA[0].date : rawB[0].date;
    const ptsA = rawA.filter((p) => p.date >= startDt);
    const ptsB = rawB.filter((p) => p.date >= startDt);
    if (ptsA.length < 2 || ptsB.length < 2) {
      return { compact: {}, modal: {}, hasData: false, statsA: null, statsB: null };
    }

    const dates = ptsA.map((p) => p.date);
    const displayDates = dates.map((d) => formatDateFR(d));
    const closesA = ptsA.map((p) => p.close);
    const closesB = dates.map((d) => findCloseOnOrBefore(ptsB, d) ?? ptsB[0].close);

    const baseA = closesA[0];
    const baseB = closesB[0];
    const seriesA = closesA.map((c) =>
      priceScale === "base100" ? Number(((c / baseA) * 100).toFixed(2)) : Number((((c / baseA) - 1) * 100).toFixed(2))
    );
    const seriesB = closesB.map((c) =>
      priceScale === "base100" ? Number(((c / baseB) * 100).toFixed(2)) : Number((((c / baseB) - 1) * 100).toFixed(2))
    );

    const statsA = computePerfStatsFromAligned(dates, closesA);
    const statsB = computePerfStatsFromAligned(dates, closesB);

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) =>
          isValidNumber(v)
            ? priceScale === "base100"
              ? `${v.toFixed(1).replace(".", ",")} pts`
              : `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} %`
            : "—",
      },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 11 } },
      grid: { left: 10, right: 20, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
      xAxis: {
        type: "category",
        data: displayDates,
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
          formatter: (v: number) => (priceScale === "base100" ? `${v}` : `${v} %`),
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
          name: tkA,
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: seriesA,
          lineStyle: { color: COLOR_A, width: 2.3 },
          itemStyle: { color: COLOR_A },
        },
        {
          name: tkB,
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: seriesB,
          lineStyle: { color: COLOR_B, width: 2.3 },
          itemStyle: { color: COLOR_B },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData: true, statsA, statsB };
  }, [pricesA, pricesB, priceScale, tkA, tkB, textColor, splitColor, tooltipBase]);

  // 2. Radar des 4 piliers (/100)
  const radarChart = useMemo(() => {
    const valsA = [
      overviewA.scores.valuation.score,
      overviewA.scores.growth.score,
      overviewA.scores.quality.score,
      overviewA.scores.health.score,
    ];
    const valsB = [
      overviewB.scores.valuation.score,
      overviewB.scores.growth.score,
      overviewB.scores.quality.score,
      overviewB.scores.health.score,
    ];
    const hasData = valsA.some(isValidNumber) && valsB.some(isValidNumber);

    const opt: EChartsOption = {
      animationDuration: 280,
      tooltip: {
        trigger: "item",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
      },
      legend: { bottom: 0, textStyle: { color: textColor, fontSize: 11 } },
      radar: {
        center: ["50%", "47%"],
        radius: "66%",
        indicator: [
          { name: "Valorisation", max: 100 },
          { name: "Croissance", max: 100 },
          { name: "Qualité", max: 100 },
          { name: "Santé", max: 100 },
        ],
        axisName: { color: textColor, fontSize: 11 },
        splitArea: {
          areaStyle: {
            color: isDark
              ? ["rgba(30,41,59,0.5)", "rgba(15,23,42,0.3)"]
              : ["rgba(241,245,249,0.7)", "rgba(255,255,255,0.6)"],
          },
        },
        splitLine: { lineStyle: { color: splitColor } },
        axisLine: { lineStyle: { color: splitColor } },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              name: tkA,
              value: valsA.map((v) => (isValidNumber(v) ? Math.round(v) : 0)),
              lineStyle: { color: COLOR_A, width: 2 },
              itemStyle: { color: COLOR_A },
              areaStyle: { color: "rgba(37, 99, 235, 0.22)" },
            },
            {
              name: tkB,
              value: valsB.map((v) => (isValidNumber(v) ? Math.round(v) : 0)),
              lineStyle: { color: COLOR_B, width: 2 },
              itemStyle: { color: COLOR_B },
              areaStyle: { color: "rgba(139, 92, 246, 0.20)" },
            },
          ],
        },
      ],
    };

    return { option: opt, hasData };
  }, [overviewA, overviewB, tkA, tkB, isDark, textColor, splitColor]);

  const years = useMemo(() => alignYears(fundamentalsA, fundamentalsB), [fundamentalsA, fundamentalsB]);
  const mapA = useMemo(() => buildAnnualYearLookup(fundamentalsA), [fundamentalsA]);
  const mapB = useMemo(() => buildAnnualYearLookup(fundamentalsB), [fundamentalsB]);

  // 3. Croissance Chiffre d'affaires & Bénéfices (Base 100 ou YoY %)
  const growthChart = useMemo(() => {
    const extractSeries = (map: Map<string, FundamentalRecord>) => {
      const raw = years.map((y) => {
        const rec = map.get(y);
        return rec ? (rec[growthMetric] ?? null) : null;
      });
      if (growthScale === "base100") {
        const base = raw.find((v): v is number => isValidNumber(v) && v > 0);
        if (!base) return raw.map(() => null);
        return raw.map((v) => (isValidNumber(v) ? Number(((v / base) * 100).toFixed(1)) : null));
      }
      // YoY %
      return years.map((y, idx) => {
        if (idx === 0) return null;
        const curr = raw[idx];
        const prev = raw[idx - 1];
        if (!isValidNumber(curr) || !isValidNumber(prev) || prev === 0) return null;
        return Number((((curr - prev) / Math.abs(prev)) * 100).toFixed(1));
      });
    };

    const sA = extractSeries(mapA);
    const sB = extractSeries(mapB);
    const hasData = sA.some(isValidNumber) || sB.some(isValidNumber);

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) =>
          isValidNumber(v)
            ? growthScale === "base100"
              ? `${v.toFixed(1).replace(".", ",")} pts`
              : `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} %`
            : "—",
      },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 11 } },
      grid: { left: 10, right: 16, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
      xAxis: {
        type: "category",
        data: years,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => (growthScale === "base100" ? `${v}` : `${v} %`),
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
          name: tkA,
          type: "bar",
          barMaxWidth: 18,
          data: sA,
          itemStyle: { color: COLOR_A, borderRadius: [4, 4, 0, 0] },
        },
        {
          name: tkB,
          type: "bar",
          barMaxWidth: 18,
          data: sB,
          itemStyle: { color: COLOR_B, borderRadius: [4, 4, 0, 0] },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData };
  }, [years, mapA, mapB, growthMetric, growthScale, tkA, tkB, textColor, splitColor, tooltipBase]);

  // 4. Évolution des Marges (%)
  const marginsChart = useMemo(() => {
    const getPct = (map: Map<string, FundamentalRecord>, y: string) => {
      const val = map.get(y)?.[marginMetric];
      return isValidNumber(val) ? Number((val * 100).toFixed(1)) : null;
    };
    const sA = years.map((y) => getPct(mapA, y));
    const sB = years.map((y) => getPct(mapB, y));
    const hasData = sA.some(isValidNumber) || sB.some(isValidNumber);

    const lastValid = (arr: (number | null)[]) => {
      for (let i = arr.length - 1; i >= 0; i--) if (isValidNumber(arr[i])) return arr[i];
      return null;
    };

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? `${v.toFixed(1).replace(".", ",")} %` : "—"),
      },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 11 } },
      grid: { left: 10, right: 16, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
      xAxis: {
        type: "category",
        data: years,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontSize: 10, formatter: "{value} %" },
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
          name: tkA,
          type: "line",
          smooth: 0.2,
          connectNulls: true,
          data: sA,
          lineStyle: { color: COLOR_A, width: 2.5 },
          itemStyle: { color: COLOR_A },
        },
        {
          name: tkB,
          type: "line",
          smooth: 0.2,
          connectNulls: true,
          data: sB,
          lineStyle: { color: COLOR_B, width: 2.5 },
          itemStyle: { color: COLOR_B },
        },
      ],
    });

    return {
      compact: makeOpt(false),
      modal: makeOpt(true),
      hasData,
      lastA: lastValid(sA),
      lastB: lastValid(sB),
    };
  }, [years, mapA, mapB, marginMetric, tkA, tkB, textColor, splitColor, tooltipBase]);

  // 5. Cash libre (FCF Base 100) ou ROE / ROIC (%)
  const profitChart = useMemo(() => {
    const extractProfit = (map: Map<string, FundamentalRecord>) => {
      if (profitMetric === "fcf") {
        const raw = years.map((y) => map.get(y)?.free_cash_flow ?? null);
        const base = raw.find((v): v is number => isValidNumber(v) && v > 0);
        if (!base) return raw.map(() => null);
        return raw.map((v) => (isValidNumber(v) ? Number(((v / base) * 100).toFixed(1)) : null));
      }
      return years.map((y) => {
        const val = map.get(y)?.[profitMetric];
        return isValidNumber(val) ? Number((val * 100).toFixed(1)) : null;
      });
    };

    const sA = extractProfit(mapA);
    const sB = extractProfit(mapB);
    const hasData = sA.some(isValidNumber) || sB.some(isValidNumber);
    const isFcf = profitMetric === "fcf";

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) =>
          isValidNumber(v)
            ? isFcf
              ? `${v.toFixed(1).replace(".", ",")} pts`
              : `${v.toFixed(1).replace(".", ",")} %`
            : "—",
      },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 11 } },
      grid: { left: 10, right: 16, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
      xAxis: {
        type: "category",
        data: years,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => (isFcf ? `${v}` : `${v} %`),
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
          name: tkA,
          type: isFcf ? "bar" : "line",
          smooth: isFcf ? undefined : 0.2,
          connectNulls: true,
          barMaxWidth: 18,
          data: sA,
          lineStyle: isFcf ? undefined : { color: COLOR_A, width: 2.5 },
          itemStyle: { color: COLOR_A, borderRadius: isFcf ? [4, 4, 0, 0] : undefined },
        },
        {
          name: tkB,
          type: isFcf ? "bar" : "line",
          smooth: isFcf ? undefined : 0.2,
          connectNulls: true,
          barMaxWidth: 18,
          data: sB,
          lineStyle: isFcf ? undefined : { color: COLOR_B, width: 2.5 },
          itemStyle: { color: COLOR_B, borderRadius: isFcf ? [4, 4, 0, 0] : undefined },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData };
  }, [years, mapA, mapB, profitMetric, tkA, tkB, textColor, splitColor, tooltipBase]);

  // 6. Historique de Valorisation (PER)
  const peChart = useMemo(() => {
    const peMapA = new Map<string, number>();
    for (const h of fundamentalsA?.historical_multiples || []) {
      if (isValidNumber(h.pe) && h.pe > 0) peMapA.set(yearKey(h), Number(h.pe.toFixed(1)));
    }
    const peMapB = new Map<string, number>();
    for (const h of fundamentalsB?.historical_multiples || []) {
      if (isValidNumber(h.pe) && h.pe > 0) peMapB.set(yearKey(h), Number(h.pe.toFixed(1)));
    }

    const peYears = Array.from(new Set([...peMapA.keys(), ...peMapB.keys()])).sort().slice(-8);
    const currPeA = overviewA.scores.metrics?.pe ?? overviewA.info.pe;
    const currPeB = overviewB.scores.metrics?.pe ?? overviewB.info.pe;
    const hasCurr =
      (isValidNumber(currPeA) && currPeA > 0) || (isValidNumber(currPeB) && currPeB > 0);
    const labels = hasCurr ? [...peYears, "Actuel"] : peYears;

    const sA = labels.map((lb) =>
      lb === "Actuel"
        ? isValidNumber(currPeA) && currPeA > 0
          ? Number(currPeA.toFixed(1))
          : null
        : peMapA.get(lb) ?? null
    );
    const sB = labels.map((lb) =>
      lb === "Actuel"
        ? isValidNumber(currPeB) && currPeB > 0
          ? Number(currPeB.toFixed(1))
          : null
        : peMapB.get(lb) ?? null
    );

    const hasData = sA.some(isValidNumber) || sB.some(isValidNumber);

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? formatMultiple(v) : "—"),
      },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 11 } },
      grid: { left: 10, right: 16, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontSize: 10, formatter: "{value}x" },
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
          name: tkA,
          type: "line",
          smooth: 0.15,
          connectNulls: true,
          data: sA,
          lineStyle: { color: COLOR_A, width: 2.5 },
          itemStyle: { color: COLOR_A },
        },
        {
          name: tkB,
          type: "line",
          smooth: 0.15,
          connectNulls: true,
          data: sB,
          lineStyle: { color: COLOR_B, width: 2.5 },
          itemStyle: { color: COLOR_B },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData, currPeA, currPeB };
  }, [fundamentalsA, fundamentalsB, overviewA, overviewB, tkA, tkB, textColor, splitColor, tooltipBase]);

  const noFundBoth = !fundamentalsA?.available && !fundamentalsB?.available;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. Performance Boursière Comparée */}
        <ExpandableChartCard
          title="Performance Boursière Comparée"
          subtitle={`Base ${priceScale === "base100" ? "100" : "0 %"} sur période commune (${PRICE_PERIODS.find((p) => p.key === pricePeriod)?.label || pricePeriod})`}
          tooltip="Aligne les deux titres à la même date de départ pour comparer qui a le plus progressé sur la période choisie."
          option={priceChart.compact}
          modalOption={priceChart.modal}
          hasData={priceChart.hasData}
          downloadName={`compare-perf-${tkA}-vs-${tkB}`}
          topControls={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {PRICE_PERIODS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onPeriodChange(p.key)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                      pricePeriod === p.key
                        ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                        : "text-slate-600 dark:text-slate-300"
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
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPriceScale(s.id)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                      priceScale === s.id
                        ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                        : "text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          }
          footer={
            priceChart.hasData && priceChart.statsA && priceChart.statsB ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="default">
                  {tkA} : {formatPercent(priceChart.statsA.perfPct, { signed: true })}
                  {isValidNumber(priceChart.statsA.cagrPct)
                    ? ` (CAGR ${formatPercent(priceChart.statsA.cagrPct, { signed: true })})`
                    : ""}
                </Badge>
                <Badge variant="outline">
                  {tkB} : {formatPercent(priceChart.statsB.perfPct, { signed: true })}
                  {isValidNumber(priceChart.statsB.cagrPct)
                    ? ` (CAGR ${formatPercent(priceChart.statsB.cagrPct, { signed: true })})`
                    : ""}
                </Badge>
              </div>
            ) : null
          }
        />

        {/* 2. Radar des 4 Piliers */}
        <ExpandableChartCard
          title="Radar des 4 Piliers (/100)"
          subtitle="Valorisation, Croissance, Qualité et Santé"
          tooltip="Compare d'un coup d'œil les forces et faiblesses de chaque pizzeria : qui est la plus rentable, la plus saine ou la moins chère ?"
          option={radarChart.option}
          hasData={radarChart.hasData}
          emptyMessage="Le radar des 4 piliers s'applique uniquement lorsque les deux titres sont des actions."
          downloadName={`compare-radar-${tkA}-vs-${tkB}`}
          footer={
            radarChart.hasData ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="default">
                  {tkA} Global : {isValidNumber(overviewA.scores.global.score) ? `${Math.round(overviewA.scores.global.score)}/100` : "—"}
                </Badge>
                <Badge variant="outline">
                  {tkB} Global : {isValidNumber(overviewB.scores.global.score) ? `${Math.round(overviewB.scores.global.score)}/100` : "—"}
                </Badge>
              </div>
            ) : null
          }
        />

        {/* 3. Croissance CA & Bénéfices */}
        {!noFundBoth && (
          <ExpandableChartCard
            title="Croissance Chiffre d'affaires & Bénéfices"
            subtitle={growthScale === "base100" ? "Base 100 (même échelle)" : "Croissance annuelle (%)"}
            tooltip="Permet de comparer une grande pizzeria et une petite sur la même échelle : qui fait grandir ses ventes et profits le plus vite ?"
            option={growthChart.compact}
            modalOption={growthChart.modal}
            hasData={growthChart.hasData}
            downloadName={`compare-croissance-${tkA}-vs-${tkB}`}
            topControls={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                  {(
                    [
                      { id: "revenue", label: "Chiffre d'affaires" },
                      { id: "net_income", label: "Bénéfices nets" },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setGrowthMetric(m.id)}
                      className={cn(
                        "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                        growthMetric === m.id
                          ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
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
                      { id: "base100", label: "Base 100" },
                      { id: "yoy", label: "Croiss. %" },
                    ] as const
                  ).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setGrowthScale(s.id)}
                      className={cn(
                        "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                        growthScale === s.id
                          ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                          : "text-slate-600 dark:text-slate-300"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            }
          />
        )}

        {/* 4. Évolution des Marges (%) */}
        {!noFundBoth && (
          <ExpandableChartCard
            title="Évolution des Marges (%)"
            subtitle="Qui garde le plus de profit par euro vendu"
            tooltip="Compare ce qu'il reste réellement dans la caisse sur chaque pizza vendue (marge nette, opérationnelle ou brute)."
            option={marginsChart.compact}
            modalOption={marginsChart.modal}
            hasData={marginsChart.hasData}
            downloadName={`compare-marges-${tkA}-vs-${tkB}`}
            topControls={
              <div className="flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    { id: "net_margin", label: "Marge nette" },
                    { id: "op_margin", label: "Marge opé." },
                    { id: "gross_margin", label: "Marge brute" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMarginMetric(m.id)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                      marginMetric === m.id
                        ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                        : "text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
            footer={
              marginsChart.hasData ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {isValidNumber(marginsChart.lastA) && (
                    <Badge variant="default">
                      {tkA} (récent) : {formatPercent(marginsChart.lastA)}
                    </Badge>
                  )}
                  {isValidNumber(marginsChart.lastB) && (
                    <Badge variant="outline">
                      {tkB} (récent) : {formatPercent(marginsChart.lastB)}
                    </Badge>
                  )}
                </div>
              ) : null
            }
          />
        )}

        {/* 5. Cash libre (FCF) ou ROE / ROIC */}
        {!noFundBoth && (
          <ExpandableChartCard
            title="Cash libre (FCF) & Rentabilité du capital"
            subtitle={
              profitMetric === "fcf"
                ? "Progression du Free Cash Flow (Base 100)"
                : `Rendement historique ${profitMetric.toUpperCase()} (%)`
            }
            tooltip="Compare le vrai cash généré après investissements (Base 100) ou l'efficacité du capital investi (ROE / ROIC > 15 % = très bon signe)."
            option={profitChart.compact}
            modalOption={profitChart.modal}
            hasData={profitChart.hasData}
            downloadName={`compare-profit-${tkA}-vs-${tkB}`}
            topControls={
              <div className="flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    { id: "fcf", label: "Cash libre (Base 100)" },
                    { id: "roe", label: "ROE (%)" },
                    { id: "roic", label: "ROIC (%)" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setProfitMetric(m.id)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                      profitMetric === m.id
                        ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                        : "text-slate-600 dark:text-slate-300"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
          />
        )}

        {/* 6. Historique de Valorisation (PER) */}
        {!noFundBoth && (
          <ExpandableChartCard
            title="Historique de Valorisation (PER)"
            subtitle="Années de bénéfices payées dans le temps"
            tooltip="Combien d'années de bénéfices coûte chaque pizzeria au fil du temps : la courbe la plus basse est généralement la moins chère."
            option={peChart.compact}
            modalOption={peChart.modal}
            hasData={peChart.hasData}
            emptyMessage="Historique de PER indisponible sur au moins un des deux titres."
            downloadName={`compare-per-${tkA}-vs-${tkB}`}
            footer={
              peChart.hasData ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {isValidNumber(peChart.currPeA) && peChart.currPeA > 0 && (
                    <Badge variant="default">
                      {tkA} actuel : {formatMultiple(peChart.currPeA)}
                    </Badge>
                  )}
                  {isValidNumber(peChart.currPeB) && peChart.currPeB > 0 && (
                    <Badge variant="outline">
                      {tkB} actuel : {formatMultiple(peChart.currPeB)}
                    </Badge>
                  )}
                </div>
              ) : null
            }
          />
        )}
      </div>

      {noFundBoth && (
        <Card>
          <CardContent className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Les graphiques financiers détaillés (CA, marges, FCF, PER) s&apos;affichent uniquement pour les actions d&apos;entreprise.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
