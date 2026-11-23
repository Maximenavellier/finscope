"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  currencySymbol,
  formatCompactNumber,
  formatMonthYearFR,
  formatPercent,
  formatPrice,
  isValidNumber,
} from "@/lib/formatters";
import type { FundamentalRecord, FundamentalsResponse, SegmentsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEGMENT_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#F43F5E", "#06B6D4"];

function computePerfAndCagr(
  records: FundamentalRecord[],
  getter: (r: FundamentalRecord) => number | null | undefined,
  frequency: "annual" | "quarterly"
): { perfPct: number | null; cagrPct: number | null } {
  const histOnly = records.filter((r) => r.period_end !== "TTM");
  const vals = histOnly.map(getter).filter((v): v is number => isValidNumber(v));
  if (vals.length < 2 || vals[0] <= 0) return { perfPct: null, cagrPct: null };
  const first = vals[0];
  const last = vals[vals.length - 1];
  const perfPct = ((last - first) / Math.abs(first)) * 100;
  const years =
    frequency === "annual" ? Math.max(1, vals.length - 1) : Math.max(0.5, (vals.length - 1) / 4);
  const cagrPct = last > 0 && years >= 1 ? ((last / first) ** (1 / years) - 1) * 100 : null;
  return { perfPct, cagrPct };
}

function PerfFooter({ perfPct, cagrPct }: { perfPct: number | null; cagrPct: number | null }) {
  if (!isValidNumber(perfPct) && !isValidNumber(cagrPct)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isValidNumber(perfPct) && (
        <Badge variant={perfPct >= 0 ? "emerald" : "coral"}>
          Perf : {formatPercent(perfPct, { signed: true })}
        </Badge>
      )}
      {isValidNumber(cagrPct) && (
        <Badge variant="secondary">
          CAGR : {formatPercent(cagrPct, { signed: true })}
        </Badge>
      )}
    </div>
  );
}

export function FinanceGrowthTab({
  ticker,
  fundamentals,
  segments,
}: {
  ticker: string;
  fundamentals: FundamentalsResponse | null;
  segments: SegmentsResponse | null;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [frequency, setFrequency] = useState<"annual" | "quarterly">("annual");
  const [horizon, setHorizon] = useState<"5Y" | "10Y">("10Y");
  const [showTtm, setShowTtm] = useState(true);
  const [perShare, setPerShare] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(
    segments?.segments?.[0]?.name || null
  );

  const { convertAmount, resolveCurrency } = useDisplayCurrency();
  const rawCur = fundamentals?.currency || "USD";
  const cur = resolveCurrency(rawCur);
  const curSym = currencySymbol(cur);
  const conv = (v: number | null | undefined) => convertAmount(v, rawCur);

  const records = useMemo(() => {
    if (!fundamentals?.available) return [];
    if (frequency === "quarterly") {
      const limit = horizon === "5Y" ? 12 : 20;
      return (fundamentals.quarterly || []).slice(-limit);
    }
    const limit = horizon === "5Y" ? 5 : 10;
    const base = (fundamentals.annual || []).slice(-limit);
    if (showTtm && fundamentals.ttm) {
      return [...base, fundamentals.ttm];
    }
    return base;
  }, [fundamentals, frequency, horizon, showTtm]);

  const labels = useMemo(
    () =>
      records.map((r) => {
        if (r.period_end === "TTM") return "TTM";
        return frequency === "annual" && r.fiscal_year ? String(r.fiscal_year) : formatMonthYearFR(r.period_end);
      }),
    [records, frequency]
  );

  const textColor = isDark ? "#94A3B8" : "#64748B";
  const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";
  const tooltipBase = {
    trigger: "axis" as const,
    backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    borderColor: isDark ? "#334155" : "#E2E8F0",
    textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
  };

  const makeBarOptions = (
    name: string,
    getter: (r: FundamentalRecord) => number | null | undefined,
    isMoney = true,
    isPerShareVal = false
  ): { compact: EChartsOption; modal: EChartsOption; hasData: boolean } => {
    const vals = records.map((r) => {
      const raw = getter(r) ?? null;
      return isMoney ? conv(raw) : raw;
    });
    const hasData = vals.some((v) => isValidNumber(v));
    const fmtVal = (v: number) =>
      isMoney ? (isPerShareVal ? formatPrice(v, cur) : formatCompactNumber(v, cur)) : formatCompactNumber(v);
    const fmtAxis = (v: number) =>
      isMoney ? (isPerShareVal ? `${v} ${curSym}` : formatCompactNumber(v, cur)) : formatCompactNumber(v);

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? fmtVal(v) : "—"),
      },
      grid: { left: 10, right: 16, top: 18, bottom: isModal ? 54 : 24, containLabel: true },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontSize: 10, formatter: fmtAxis },
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
          name,
          type: "bar",
          data: vals,
          itemStyle: {
            borderRadius: [5, 5, 0, 0],
            color: (params: { dataIndex: number }) => {
              const v = vals[params.dataIndex];
              if (labels[params.dataIndex] === "TTM") return "#0EA5E9";
              if (isValidNumber(v) && v < 0) return "#F43F5E";
              return "#2563EB";
            },
          },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData };
  };

  // 1. Chiffre d'affaires
  const revGetter = (r: FundamentalRecord) => (perShare ? r.revenue_per_share : r.revenue);
  const revCharts = makeBarOptions("Chiffre d'affaires", revGetter, true, perShare);
  const revStats = computePerfAndCagr(records, revGetter, frequency);

  // 2. Bénéfices nets
  const niGetter = (r: FundamentalRecord) => (perShare ? r.net_income_per_share : r.net_income);
  const niCharts = makeBarOptions("Bénéfices nets", niGetter, true, perShare);
  const niStats = computePerfAndCagr(records, niGetter, frequency);

  // 3. Cash libre (FCF)
  const fcfGetter = (r: FundamentalRecord) => (perShare ? r.fcf_per_share : r.free_cash_flow);
  const fcfCharts = makeBarOptions("Cash libre (FCF)", fcfGetter, true, perShare);
  const fcfStats = computePerfAndCagr(records, fcfGetter, frequency);

  // 4. Évolution des marges (%)
  const toPct = (v: number | null | undefined) =>
    isValidNumber(v) ? Number((v * 100).toFixed(1)) : null;
  const hasMargins = records.some(
    (r) => isValidNumber(r.gross_margin) || isValidNumber(r.op_margin) || isValidNumber(r.net_margin)
  );
  const makeMarginsOpt = (isModal: boolean): EChartsOption => ({
    animationDuration: 280,
    tooltip: {
      ...tooltipBase,
      valueFormatter: (v) => (isValidNumber(v) ? `${v.toFixed(1).replace(".", ",")} %` : "—"),
    },
    legend: { top: 0, textStyle: { color: textColor, fontSize: 10 } },
    grid: { left: 10, right: 16, top: 32, bottom: isModal ? 54 : 24, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
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
        name: "Marge brute",
        type: "line",
        smooth: 0.2,
        data: records.map((r) => toPct(r.gross_margin)),
        lineStyle: { color: "#10B981", width: 2 },
        itemStyle: { color: "#10B981" },
      },
      {
        name: "Marge opé.",
        type: "line",
        smooth: 0.2,
        data: records.map((r) => toPct(r.op_margin)),
        lineStyle: { color: "#2563EB", width: 2 },
        itemStyle: { color: "#2563EB" },
      },
      {
        name: "Marge nette",
        type: "line",
        smooth: 0.2,
        data: records.map((r) => toPct(r.net_margin)),
        lineStyle: { color: "#F59E0B", width: 2 },
        itemStyle: { color: "#F59E0B" },
      },
    ],
  });

  // 5. Trésorerie vs Dette totale
  const hasCashDebt = records.some((r) => isValidNumber(r.cash) || isValidNumber(r.total_debt));
  const makeCashDebtOpt = (isModal: boolean): EChartsOption => ({
    animationDuration: 280,
    tooltip: {
      ...tooltipBase,
      valueFormatter: (v) =>
        isValidNumber(v)
          ? perShare
            ? formatPrice(v, cur)
            : formatCompactNumber(v, cur)
          : "—",
    },
    legend: { top: 0, textStyle: { color: textColor, fontSize: 10 } },
    grid: { left: 10, right: 16, top: 32, bottom: isModal ? 54 : 24, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, fontSize: 10 },
      axisLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: textColor,
        fontSize: 10,
        formatter: (v: number) => (perShare ? `${v} ${curSym}` : formatCompactNumber(v, cur)),
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
        name: "Trésorerie",
        type: "bar",
        data: records.map((r) => conv(perShare ? r.cash_per_share : r.cash)),
        itemStyle: { color: "#10B981", borderRadius: [4, 4, 0, 0] },
      },
      {
        name: "Dette totale",
        type: "bar",
        data: records.map((r) => conv(perShare ? r.total_debt_per_share : r.total_debt)),
        itemStyle: { color: "#F43F5E", borderRadius: [4, 4, 0, 0] },
      },
    ],
  });

  // 6. Nombre d'actions en circulation (Dilution vs Rachat)
  const sharesVals = records.map((r) => r.shares_outstanding ?? null);
  const validShares = sharesVals.filter((v): v is number => isValidNumber(v) && v > 0);
  const hasShares = validShares.length >= 2;
  const sharesDeltaPct =
    hasShares && validShares[0] > 0
      ? ((validShares[validShares.length - 1] - validShares[0]) / validShares[0]) * 100
      : null;

  const makeSharesOpt = (isModal: boolean): EChartsOption => ({
    animationDuration: 280,
    tooltip: {
      ...tooltipBase,
      valueFormatter: (v) => (isValidNumber(v) ? `${formatCompactNumber(v)} actions` : "—"),
    },
    grid: { left: 10, right: 16, top: 18, bottom: isModal ? 54 : 24, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: textColor, fontSize: 10 },
      axisLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => formatCompactNumber(v) },
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
        name: "Actions en circulation",
        type: "bar",
        data: sharesVals,
        itemStyle: {
          color: sharesDeltaPct !== null && sharesDeltaPct <= 0 ? "#10B981" : "#F59E0B",
          borderRadius: [4, 4, 0, 0],
        },
      },
    ],
  });

  // 7. Rentabilité du capital (ROE & ROIC)
  const hasReturns = records.some((r) => isValidNumber(r.roe) || isValidNumber(r.roic));
  const makeReturnsOpt = (isModal: boolean): EChartsOption => ({
    animationDuration: 280,
    tooltip: {
      ...tooltipBase,
      valueFormatter: (v) => (isValidNumber(v) ? `${v.toFixed(1).replace(".", ",")} %` : "—"),
    },
    legend: { top: 0, textStyle: { color: textColor, fontSize: 10 } },
    grid: { left: 10, right: 16, top: 32, bottom: isModal ? 54 : 24, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
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
        name: "ROE",
        type: "line",
        smooth: 0.2,
        data: records.map((r) => toPct(r.roe)),
        lineStyle: { color: "#2563EB", width: 2 },
        itemStyle: { color: "#2563EB" },
      },
      {
        name: "ROIC",
        type: "line",
        smooth: 0.2,
        data: records.map((r) => toPct(r.roic)),
        lineStyle: { color: "#10B981", width: 2 },
        itemStyle: { color: "#10B981" },
      },
    ],
  });

  // 8. Segments de CA (si disponibles)
  const activeSeg = selectedSegment || segments?.segments?.[0]?.name || null;
  const segDonutOpt: EChartsOption = useMemo(() => {
    if (!segments?.segments_available) return {};
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
        valueFormatter: (val) => (isValidNumber(val) ? formatCompactNumber(val, cur) : "—"),
      },
      color: SEGMENT_COLORS,
      series: [
        {
          name: "Activités",
          type: "pie",
          radius: ["44%", "72%"],
          itemStyle: { borderRadius: 6, borderColor: isDark ? "#0F172A" : "#FFFFFF", borderWidth: 2 },
          label: { color: isDark ? "#CBD5E1" : "#334155", fontSize: 10, formatter: "{b}\n{d}%" },
          data: segments.segments.map((s) => ({ name: s.name, value: conv(s.revenue) ?? s.revenue })),
        },
      ],
    };
  }, [segments, isDark, cur, rawCur, convertAmount]);

  const segModalOpt: EChartsOption = useMemo(() => {
    if (!segments?.segments_available || !activeSeg) return segDonutOpt;
    return {
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? formatCompactNumber(v, cur) : "—"),
      },
      grid: { left: 16, right: 20, top: 28, bottom: 32, containLabel: true },
      xAxis: {
        type: "category",
        data: segments.segment_history.map((h) => h.period.slice(0, 4)),
        axisLabel: { color: textColor, fontSize: 11 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontSize: 11, formatter: (v: number) => formatCompactNumber(v, cur) },
        splitLine: { lineStyle: { color: splitColor } },
      },
      series: [
        {
          name: activeSeg,
          type: "bar",
          data: segments.segment_history.map((h) => conv(h.segments[activeSeg])),
          itemStyle: { color: "#2563EB", borderRadius: [5, 5, 0, 0] },
        },
      ],
    };
  }, [segments, activeSeg, segDonutOpt, cur, rawCur, convertAmount, textColor, splitColor]);

  // 9. Dividendes annuels (uniquement si versés)
  const divs = fundamentals?.dividends_annual || [];
  const divOpt = (isModal: boolean): EChartsOption => ({
    animationDuration: 280,
    tooltip: {
      ...tooltipBase,
      valueFormatter: (v) => (isValidNumber(v) ? formatPrice(v, cur) : "—"),
    },
    grid: { left: 10, right: 16, top: 18, bottom: isModal ? 54 : 24, containLabel: true },
    xAxis: {
      type: "category",
      data: divs.map((d) => String(d.year)),
      axisLabel: { color: textColor, fontSize: 10 },
      axisLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => `${v} ${curSym}` },
      splitLine: { lineStyle: { color: splitColor } },
    },
    series: [
      {
        name: "Dividende / action",
        type: "bar",
        data: divs.map((d) => conv(d.dividend_per_share)),
        itemStyle: { color: "#10B981", borderRadius: [5, 5, 0, 0] },
      },
    ],
  });

  let divCagr: number | null = null;
  if (divs.length >= 2 && divs[0].dividend_per_share > 0) {
    const yrs = Math.max(1, divs[divs.length - 1].year - divs[0].year);
    divCagr = ((divs[divs.length - 1].dividend_per_share / divs[0].dividend_per_share) ** (1 / yrs) - 1) * 100;
  }

  if (!fundamentals?.available) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Les états financiers détaillés ne sont pas disponibles pour {ticker}.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Global Control Bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {(["annual", "quarterly"] as const).map((freq) => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => setFrequency(freq)}
                  className={cn(
                    "rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer",
                    frequency === freq
                      ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                      : "text-slate-600 dark:text-slate-300"
                  )}
                >
                  {freq === "annual" ? "Annuel" : "Trimestriel"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {(["5Y", "10Y"] as const).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizon(h)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                    horizon === h
                      ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                      : "text-slate-600 dark:text-slate-300"
                  )}
                >
                  {frequency === "annual" ? (h === "5Y" ? "5A" : "10A") : h === "5Y" ? "12T" : "20T"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700 dark:text-slate-300">
            {frequency === "annual" && fundamentals.ttm && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTtm}
                  onChange={(e) => setShowTtm(e.target.checked)}
                />
                <span>12 derniers mois (TTM)</span>
              </label>
            )}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={perShare}
                onChange={(e) => setPerShare(e.target.checked)}
              />
              <span>Par action</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 3-Column Baggr Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ExpandableChartCard
          title="Chiffre d'affaires"
          subtitle={perShare ? `Par action (${cur})` : `Total (${cur})`}
          tooltip="Total des ventes de l'entreprise. Ex. : ta pizzeria vend pour 100 000 € de pizzas dans l'année. Bon signe : des barres qui montent régulièrement."
          option={revCharts.compact}
          modalOption={revCharts.modal}
          hasData={revCharts.hasData}
          downloadName={`${ticker}_chiffre_affaires`}
          footer={<PerfFooter {...revStats} />}
        />

        <ExpandableChartCard
          title="Bénéfices nets"
          subtitle={perShare ? `Par action (${cur})` : `Total (${cur})`}
          tooltip="Ce qu'il reste sur le papier après avoir payé ingrédients, loyer, salaires et impôts (ex. 20 000 €). Bon signe : en hausse régulière avec le chiffre d'affaires."
          option={niCharts.compact}
          modalOption={niCharts.modal}
          hasData={niCharts.hasData}
          downloadName={`${ticker}_benefices_nets`}
          footer={<PerfFooter {...niStats} />}
        />

        <ExpandableChartCard
          title="Cash libre (FCF)"
          subtitle={perShare ? `Par action (${cur})` : `Total (${cur})`}
          tooltip="Le vrai cash qui reste en poche après avoir payé les nouveaux équipements (ex. 20 000 € de bénéfice - 5 000 € pour un nouveau four = 15 000 € de FCF). C'est le nerf de la guerre."
          option={fcfCharts.compact}
          modalOption={fcfCharts.modal}
          hasData={fcfCharts.hasData}
          downloadName={`${ticker}_cash_libre`}
          footer={<PerfFooter {...fcfStats} />}
        />

        <ExpandableChartCard
          title="Évolution des marges (%)"
          subtitle="Brute, opérationnelle et nette"
          tooltip="Sur une pizza vendue 10 € : moins 3 € d'ingrédients = 70 % de marge brute ; moins 4 € de loyer/salaires = 30 % de marge opé ; moins 1 € d'impôts = 20 % de marge nette. Bon signe : des marges élevées et stables ou en hausse."
          option={makeMarginsOpt(false)}
          modalOption={makeMarginsOpt(true)}
          hasData={hasMargins}
          downloadName={`${ticker}_marges`}
        />

        <ExpandableChartCard
          title="Trésorerie vs Dette totale"
          subtitle={perShare ? `Par action (${cur})` : `Bilan (${cur})`}
          tooltip="Ton cash en banque (vert) face à ton crédit bancaire (rouge). Ex. : 50 000 € en banque contre 20 000 € de crédit = ta boîte est increvable."
          option={makeCashDebtOpt(false)}
          modalOption={makeCashDebtOpt(true)}
          hasData={hasCashDebt}
          downloadName={`${ticker}_cash_dette`}
        />

        <ExpandableChartCard
          title="Nombre d'actions en circulation"
          subtitle="Détection rachat d'actions vs dilution"
          tooltip="Ta pizzeria est coupée en 10 parts et tu en as 1 (10 %). Si la boîte rachète et détruit 2 parts, ta part passe automatiquement à 12,5 % sans rien débourser. Bon signe : des barres qui descendent."
          option={makeSharesOpt(false)}
          modalOption={makeSharesOpt(true)}
          hasData={hasShares}
          downloadName={`${ticker}_actions`}
          footer={
            sharesDeltaPct !== null ? (
              <Badge variant={sharesDeltaPct <= 0 ? "emerald" : "coral"}>
                {sharesDeltaPct <= 0 ? "Rachat d'actions" : "Dilution"} :{" "}
                {formatPercent(sharesDeltaPct, { signed: true })}
              </Badge>
            ) : null
          }
        />

        <ExpandableChartCard
          title="Rentabilité du capital (ROE & ROIC)"
          subtitle="Efficacité du capital (%)"
          tooltip="Tu investis 100 000 € pour ouvrir une 2e pizzeria. Si elle rapporte 25 000 €/an, ton ROIC est de 25 % (remboursée en 4 ans). Bon signe : au-dessus de 15 % régulièrement."
          option={makeReturnsOpt(false)}
          modalOption={makeReturnsOpt(true)}
          hasData={hasReturns}
          downloadName={`${ticker}_roe_roic`}
        />

        {segments?.segments_available && (
          <ExpandableChartCard
            title="Chiffre d'affaires par activité"
            subtitle="Cliquez un segment puis agrandissez (⤢) pour l'historique"
            tooltip="D'où vient l'argent (ex. 90 % pizzas, 10 % boissons). Permet de voir le moteur principal et le risque de dépendance à un seul produit."
            option={segDonutOpt}
            modalOption={segModalOpt}
            hasData={segments.segments.length > 0}
            downloadName={`${ticker}_segments`}
            onEvents={{
              click: (params: unknown) => {
                const p = params as { name?: string };
                if (p?.name) setSelectedSegment(p.name);
              },
            }}
            modalControls={
              <div className="flex flex-wrap gap-1">
                {segments.segments.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setSelectedSegment(s.name)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-medium cursor-pointer",
                      activeSeg === s.name
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            }
          />
        )}

        {divs.length > 0 && (
          <ExpandableChartCard
            title="Dividendes par action"
            subtitle={`Historique annuel (${cur})`}
            tooltip="Part des bénéfices reversée en cash aux actionnaires. Ex. : ta pizzeria gagne 20 000 € et verse 5 000 € par an aux propriétaires. Bon signe : un dividende régulier et bien couvert par le cash libre."
            option={divOpt(false)}
            modalOption={divOpt(true)}
            hasData={divs.length > 0}
            downloadName={`${ticker}_dividendes`}
            footer={
              divCagr !== null ? (
                <Badge variant="emerald">CAGR : {formatPercent(divCagr, { signed: true })}</Badge>
              ) : null
            }
          />
        )}
      </div>
    </div>
  );
}
