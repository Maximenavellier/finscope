"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { Download, Loader2, Maximize2, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EChart } from "@/components/ui/echart";
import { getStockPrices } from "@/lib/api";
import { currencySymbol, formatDateFR, formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { PriceHistoryResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1A" },
  { key: "3Y", label: "3A" },
  { key: "5Y", label: "5A" },
  { key: "10Y", label: "10A" },
  { key: "MAX", label: "MAX" },
];

interface PriceChartCardProps {
  ticker: string;
  initialPrices: PriceHistoryResponse | null;
  fairValue?: number | null;
}

export function PriceChartCard({ ticker, initialPrices, fairValue }: PriceChartCardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { displayCurrency } = useDisplayCurrency();
  const chartInstanceRef = useRef<ECharts | null>(null);
  const modalInstanceRef = useRef<ECharts | null>(null);

  const [prices, setPrices] = useState<PriceHistoryResponse | null>(initialPrices);
  const [period, setPeriod] = useState<string>(initialPrices?.period || "5Y");
  const [currency, setCurrency] = useState<string>(
    initialPrices?.currency || displayCurrency
  );
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [showMM50, setShowMM50] = useState(true);
  const [showMM200, setShowMM200] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const [showFairValue, setShowFairValue] = useState(true);
  const [showSplits, setShowSplits] = useState(true);

  useEffect(() => {
    if (initialPrices) {
      setPrices(initialPrices);
      setPeriod(initialPrices.period || "5Y");
      setCurrency(initialPrices.currency || displayCurrency);
    }
  }, [initialPrices, displayCurrency]);

  useEffect(() => {
    if (!prices) return;
    if (prices.currency !== displayCurrency) {
      fetchPeriodOrCurrency(period, displayCurrency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayCurrency]);

  const fetchPeriodOrCurrency = async (nextPeriod: string, nextCurrency: string) => {
    setPeriod(nextPeriod);
    setCurrency(nextCurrency);
    setLoading(true);
    try {
      const data = await getStockPrices(ticker, nextPeriod, nextCurrency);
      setPrices(data);
    } catch {
      // keep previous series on transient error
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPng = (targetRef: React.RefObject<ECharts | null>) => {
    const inst = targetRef.current;
    if (!inst || inst.isDisposed()) return;
    const url = inst.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ticker}_${period}_${currency}.png`;
    link.click();
  };

  const adjustedFairValue = useMemo(() => {
    if (!isValidNumber(fairValue) || !prices) return null;
    const fx = isValidNumber(prices.fx_rate_applied) ? prices.fx_rate_applied : 1;
    return Number((fairValue * fx).toFixed(2));
  }, [fairValue, prices]);

  const option = useMemo<EChartsOption>(() => {
    if (!prices || prices.points.length === 0) return {};
    const dates = prices.points.map((p) => formatDateFR(p.date));
    const closes = prices.points.map((p) => p.close);
    const mm50 = prices.points.map((p) => p.mm50 ?? null);
    const mm200 = prices.points.map((p) => p.mm200 ?? null);
    const volumes = prices.points.map((p) => p.volume ?? 0);
    const curSym = currencySymbol(prices.currency);

    const textColor = isDark ? "#94A3B8" : "#64748B";
    const splitLineColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";

    const markLineData: Record<string, unknown>[] = [];
    if (showFairValue && isValidNumber(adjustedFairValue)) {
      markLineData.push({
        yAxis: adjustedFairValue,
        name: "Prix Juste",
        lineStyle: { color: "#10B981", type: "dashed", width: 1.6 },
        label: {
          formatter: `Prix Juste : ${formatPrice(adjustedFairValue, prices.currency)}`,
          color: "#FFFFFF",
          backgroundColor: "#10B981",
          borderRadius: 6,
          padding: [3, 7],
          fontSize: 10,
          position: "insideStartTop",
          distance: [8, 6],
        },
      });
    }
    if (showSplits && prices.splits.length > 0) {
      for (const sp of prices.splits) {
        const spLabel = formatDateFR(sp.date);
        if (dates.includes(spLabel)) {
          markLineData.push({
            xAxis: spLabel,
            lineStyle: { color: "#8B5CF6", type: "dotted", width: 1.2 },
            label: {
              formatter: `Split ${sp.ratio}:1`,
              color: "#8B5CF6",
              fontSize: 10,
              position: "insideEndTop",
            },
          });
        }
      }
    }

    const series: EChartsOption["series"] = [
      {
        name: "Cours",
        type: "line",
        data: closes,
        showSymbol: false,
        smooth: 0.15,
        lineStyle: { color: "#2563EB", width: 2.2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(37, 99, 235, 0.24)" },
              { offset: 1, color: "rgba(37, 99, 235, 0.01)" },
            ],
          },
        },
        markLine:
          markLineData.length > 0
            ? {
                symbol: ["none", "none"],
                silent: true,
                data: markLineData as never,
              }
            : undefined,
      },
    ];

    if (showMM50) {
      series.push({
        name: "Moyenne 50j",
        type: "line",
        data: mm50,
        showSymbol: false,
        lineStyle: { color: "#F59E0B", width: 1.4 },
      });
    }
    if (showMM200) {
      series.push({
        name: "Moyenne 200j",
        type: "line",
        data: mm200,
        showSymbol: false,
        lineStyle: { color: "#8B5CF6", width: 1.4 },
      });
    }
    if (showVolume) {
      series.push({
        name: "Volume",
        type: "bar",
        yAxisIndex: 1,
        data: volumes,
        itemStyle: { color: isDark ? "rgba(148,163,184,0.22)" : "rgba(100,116,139,0.2)" },
      });
    }

    return {
      animationDuration: 300,
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
      },
      grid: { left: 14, right: 34, top: 28, bottom: 58, containLabel: true },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisLabel: { color: textColor, fontSize: 11, hideOverlap: true },
        axisLine: { lineStyle: { color: splitLineColor } },
      },
      yAxis: [
        {
          type: "value",
          scale: true,
          axisLabel: {
            color: textColor,
            fontSize: 11,
            formatter: (val: number) => `${val} ${curSym}`,
          },
          splitLine: { lineStyle: { color: splitLineColor } },
        },
        {
          type: "value",
          show: false,
          max: (val: { max: number }) => val.max * 4,
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 20,
          bottom: 8,
          borderColor: splitLineColor,
          textStyle: { color: textColor, fontSize: 10 },
        },
      ],
      series,
    };
  }, [prices, isDark, showMM50, showMM200, showVolume, showFairValue, showSplits, adjustedFairValue]);

  const settingsPanel = (targetRef: React.RefObject<ECharts | null>) => (
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Paramètres
        </p>

        <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Moyenne 50j
          </span>
          <input type="checkbox" checked={showMM50} onChange={(e) => setShowMM50(e.target.checked)} />
        </label>

        <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-violet-500" />
            Moyenne 200j
          </span>
          <input type="checkbox" checked={showMM200} onChange={(e) => setShowMM200(e.target.checked)} />
        </label>

        <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <span>Volume</span>
          <input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} />
        </label>

        {isValidNumber(adjustedFairValue) && (
          <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Prix Juste
            </span>
            <input
              type="checkbox"
              checked={showFairValue}
              onChange={(e) => setShowFairValue(e.target.checked)}
            />
          </label>
        )}

        <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <span>Splits d&apos;action</span>
          <input type="checkbox" checked={showSplits} onChange={(e) => setShowSplits(e.target.checked)} />
        </label>

        <div className="pt-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">Devise</p>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800">
            {["USD", "EUR"].map((cur) => (
              <button
                key={cur}
                type="button"
                onClick={() => fetchPeriodOrCurrency(period, cur)}
                className={cn(
                  "rounded-lg py-1 text-xs font-semibold transition-colors cursor-pointer",
                  currency === cur
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 dark:text-slate-400"
                )}
              >
                {cur}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={() => handleDownloadPng(targetRef)} className="w-full">
        <Download className="h-3.5 w-3.5" />
        <span>Télécharger PNG</span>
      </Button>
    </div>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2.5">
            <CardTitle>Évolution du Cours</CardTitle>
            {prices && (
              <>
                <Badge variant={(prices.perf_pct ?? 0) >= 0 ? "emerald" : "coral"}>
                  Perf : {formatPercent(prices.perf_pct, { signed: true })}
                </Badge>
                {isValidNumber(prices.cagr_pct) && (
                  <Badge variant="secondary">
                    CAGR : {formatPercent(prices.cagr_pct, { signed: true })}
                  </Badge>
                )}
                <Badge variant="outline">{prices.currency}</Badge>
              </>
            )}
            {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => fetchPeriodOrCurrency(p.key, currency)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    period === p.key
                      ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Agrandir le graphique"
              aria-label="Agrandir le graphique de prix"
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
            <div className="min-w-0">
              {prices && prices.points.length > 0 ? (
                <EChart
                  option={option}
                  className="h-80 sm:h-96"
                  onInstanceReady={(inst) => {
                    chartInstanceRef.current = inst;
                  }}
                />
              ) : (
                <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-800">
                  Historique de prix indisponible
                </div>
              )}
            </div>
            {settingsPanel(chartInstanceRef)}
          </div>
        </CardContent>
      </Card>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {ticker} — Évolution du Cours ({period})
                </h3>
                {prices && (
                  <Badge variant={(prices.perf_pct ?? 0) >= 0 ? "emerald" : "coral"}>
                    Perf : {formatPercent(prices.perf_pct, { signed: true })}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                  {PERIODS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => fetchPeriodOrCurrency(p.key, currency)}
                      className={cn(
                        "rounded-lg px-2 py-1 text-xs font-medium cursor-pointer",
                        period === p.key
                          ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                          : "text-slate-600 dark:text-slate-300"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_230px]">
              <EChart
                option={option}
                className="h-[420px] sm:h-[500px]"
                onInstanceReady={(inst) => {
                  modalInstanceRef.current = inst;
                }}
              />
              {settingsPanel(modalInstanceRef)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
