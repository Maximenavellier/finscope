"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  currencySymbol,
  formatCompactNumber,
  formatDateFR,
  formatPercent,
  formatPrice,
  isValidNumber,
} from "@/lib/formatters";
import type {
  AnalystsResponse,
  CagrSummary,
  ForecastPoint,
  SurprisePoint,
  SurprisesResponse,
} from "@/lib/types";

interface AnalystsTabProps {
  ticker: string;
  analysts: AnalystsResponse | null;
  surprises: SurprisesResponse | null;
  currency?: string | null;
}

function CagrFooter({ cagr }: { cagr?: CagrSummary | null }) {
  if (
    !cagr ||
    (!isValidNumber(cagr.low) && !isValidNumber(cagr.avg) && !isValidNumber(cagr.high))
  ) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isValidNumber(cagr.low) && (
        <Badge variant="outline">
          CAGR Bas : {formatPercent(cagr.low, { signed: true })}
        </Badge>
      )}
      {isValidNumber(cagr.avg) && (
        <Badge variant={cagr.avg >= 0 ? "emerald" : "coral"}>
          CAGR Moyen : {formatPercent(cagr.avg, { signed: true })}
        </Badge>
      )}
      {isValidNumber(cagr.high) && (
        <Badge variant="outline">
          CAGR Haut : {formatPercent(cagr.high, { signed: true })}
        </Badge>
      )}
    </div>
  );
}

function SurpriseFooter({ items }: { items: SurprisePoint[] }) {
  const withEst = items.filter(
    (i) => isValidNumber(i.estimated) && isValidNumber(i.actual)
  );
  const latest = items.length > 0 ? items[items.length - 1] : null;
  const beats = withEst.filter((i) => (i.actual ?? 0) >= (i.estimated ?? 0)).length;

  if (withEst.length === 0 && !isValidNumber(latest?.surprise_pct)) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {withEst.length > 0 && (
        <Badge variant={beats >= Math.ceil(withEst.length * 0.6) ? "emerald" : "amber"}>
          Battus : {beats}/{withEst.length} trim.
        </Badge>
      )}
      {isValidNumber(latest?.surprise_pct) && (
        <Badge variant={latest.surprise_pct >= 0 ? "emerald" : "coral"}>
          Dernier : {formatPercent(latest.surprise_pct, { signed: true })}
        </Badge>
      )}
    </div>
  );
}

export function AnalystsTab({
  ticker,
  analysts,
  surprises,
  currency,
}: AnalystsTabProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { convertAmount, resolveCurrency } = useDisplayCurrency();
  const rawCur = analysts?.currency || currency || "USD";
  const cur = resolveCurrency(rawCur);
  const curSym = currencySymbol(cur);
  const conv = (v: number | null | undefined) => convertAmount(v, rawCur);

  const textColor = isDark ? "#94A3B8" : "#64748B";
  const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";
  const tooltipBase = {
    trigger: "axis" as const,
    backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    borderColor: isDark ? "#334155" : "#E2E8F0",
    textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
  };

  // 1. Objectifs de prix 12 mois
  const priceTargetChart = useMemo(() => {
    const pt = analysts?.price_targets;
    const currentConv = conv(pt?.current);
    const rows = [
      { label: "Bas", val: conv(pt?.low), color: "#F43F5E" },
      { label: "Actuel", val: currentConv, color: "#64748B" },
      { label: "Moyen", val: conv(pt?.mean), color: "#2563EB" },
      { label: "Haut", val: conv(pt?.high), color: "#10B981" },
    ];
    const hasData = [pt?.low, pt?.mean, pt?.high].some((v) => isValidNumber(v));

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? formatPrice(v, cur) : "—"),
      },
      grid: { left: 10, right: 16, top: 24, bottom: isModal ? 32 : 20, containLabel: true },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.label),
        axisLabel: { color: textColor, fontSize: 11 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => `${v} ${curSym}` },
        splitLine: { lineStyle: { color: splitColor } },
      },
      series: [
        {
          name: "Objectif 12M",
          type: "bar",
          barMaxWidth: isModal ? 54 : 38,
          data: rows.map((r) => ({
            value: r.val,
            itemStyle: { color: r.color, borderRadius: [6, 6, 0, 0] },
          })),
          label: {
            show: true,
            position: "top",
            color: textColor,
            fontSize: 10,
            formatter: (p: { value?: unknown }) =>
              isValidNumber(p.value) ? formatPrice(p.value, cur, 0) : "",
          },
          ...(isValidNumber(currentConv)
            ? {
                markLine: {
                  symbol: "none",
                  silent: true,
                  lineStyle: { type: "dashed", color: "#94A3B8", width: 1.2 },
                  label: { show: false },
                  data: [{ yAxis: currentConv }],
                },
              }
            : {}),
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData };
  }, [analysts, cur, curSym, rawCur, convertAmount, textColor, splitColor, tooltipBase]);

  // Helper pour Prévisions CA & BPA
  const makeForecastChart = (
    points: ForecastPoint[],
    isEps: boolean
  ): { compact: EChartsOption; modal: EChartsOption; hasData: boolean } => {
    const hasData = points.some(
      (p) => isValidNumber(p.avg) || isValidNumber(p.high) || isValidNumber(p.low)
    );
    const labels = points.map((p) => p.period);
    let lastActualIdx = -1;
    points.forEach((p, idx) => {
      if (p.is_actual) lastActualIdx = idx;
    });

    const actualSeries = points.map((p) =>
      p.is_actual ? conv(p.avg ?? p.high ?? p.low) : null
    );
    const lineValue = (p: ForecastPoint, idx: number, field: "high" | "avg" | "low") => {
      if (!p.is_actual) return conv(p[field] ?? p.avg);
      if (idx === lastActualIdx) return conv(p.avg);
      return null;
    };
    const highLine = points.map((p, i) => lineValue(p, i, "high"));
    const avgLine = points.map((p, i) => lineValue(p, i, "avg"));
    const lowLine = points.map((p, i) => lineValue(p, i, "low"));

    const fmtVal = (v: number) => (isEps ? formatPrice(v, cur) : formatCompactNumber(v, cur));
    const fmtAxis = (v: number) => (isEps ? `${v} ${curSym}` : formatCompactNumber(v, cur));

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? fmtVal(v) : "—"),
      },
      legend: {
        top: 0,
        textStyle: { color: textColor, fontSize: 10 },
        itemWidth: 10,
        itemHeight: 8,
      },
      grid: { left: 10, right: 16, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
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
          name: "Réel",
          type: "bar",
          barMaxWidth: 28,
          data: actualSeries,
          itemStyle: { color: "#2563EB", borderRadius: [5, 5, 0, 0] },
        },
        {
          name: "Haute",
          type: "line",
          smooth: false,
          symbolSize: 6,
          data: highLine,
          itemStyle: { color: "#10B981" },
          lineStyle: { color: "#10B981", width: 2, type: "dashed" },
        },
        {
          name: "Moyenne",
          type: "line",
          smooth: false,
          symbolSize: 7,
          data: avgLine,
          itemStyle: { color: "#0EA5E9" },
          lineStyle: { color: "#0EA5E9", width: 2.5 },
        },
        {
          name: "Basse",
          type: "line",
          smooth: false,
          symbolSize: 6,
          data: lowLine,
          itemStyle: { color: "#F43F5E" },
          lineStyle: { color: "#F43F5E", width: 2, type: "dashed" },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData };
  };

  const revenueForecastChart = useMemo(
    () => makeForecastChart(analysts?.revenue_forecasts || [], false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysts, cur, curSym, isDark]
  );

  const epsForecastChart = useMemo(
    () => makeForecastChart(analysts?.eps_forecasts || [], true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysts, cur, curSym, isDark]
  );

  // Helper pour Surprises BPA & CA
  const makeSurpriseChart = (
    items: SurprisePoint[],
    isEps: boolean
  ): {
    compact: EChartsOption;
    modal: EChartsOption;
    hasData: boolean;
    compactItems: SurprisePoint[];
  } => {
    const fullItems = items.slice(-20);
    const compactItems = items.slice(-8);
    const hasData = fullItems.some(
      (i) => isValidNumber(i.actual) || isValidNumber(i.estimated)
    );

    const fmtVal = (v: number) => (isEps ? formatPrice(v, cur) : formatCompactNumber(v, cur));
    const fmtAxis = (v: number) => (isEps ? `${v} ${curSym}` : formatCompactNumber(v, cur));

    const makeOpt = (subset: SurprisePoint[], isModal: boolean): EChartsOption => {
      const hasEst = subset.some((i) => isValidNumber(i.estimated));
      return {
        animationDuration: 280,
        tooltip: {
          ...tooltipBase,
          formatter: (params: unknown) => {
            const arr = Array.isArray(params) ? params : [];
            if (arr.length === 0) return "";
            const idx = arr[0]?.dataIndex ?? 0;
            const pt = subset[idx];
            if (!pt) return "";
            const lines = [`<div style="font-weight:600;margin-bottom:4px">${pt.period} (${formatDateFR(pt.date)})</div>`];
            const estConv = conv(pt.estimated);
            const actConv = conv(pt.actual);
            if (isValidNumber(estConv)) {
              lines.push(`Estimé : <b>${fmtVal(estConv)}</b>`);
            }
            if (isValidNumber(actConv)) {
              lines.push(`Réel : <b>${fmtVal(actConv)}</b>`);
            }
            if (isValidNumber(pt.surprise_pct)) {
              const color = pt.surprise_pct >= 0 ? "#10B981" : "#F43F5E";
              lines.push(
                `Surprise : <b style="color:${color}">${formatPercent(pt.surprise_pct, { signed: true })}</b>`
              );
            }
            return lines.join("<br/>");
          },
        },
        legend: {
          top: 0,
          textStyle: { color: textColor, fontSize: 10 },
          itemWidth: 10,
          itemHeight: 8,
        },
        grid: { left: 10, right: 16, top: 30, bottom: isModal ? 54 : 22, containLabel: true },
        xAxis: {
          type: "category",
          data: subset.map((i) => i.period),
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
          ...(hasEst
            ? [
                {
                  name: "Estimé",
                  type: "bar" as const,
                  barMaxWidth: 20,
                  data: subset.map((i) => conv(i.estimated)),
                  itemStyle: {
                    color: isDark ? "#475569" : "#CBD5E1",
                    borderRadius: [4, 4, 0, 0],
                  },
                },
              ]
            : []),
          {
            name: "Réel",
            type: "bar",
            barMaxWidth: 20,
            data: subset.map((i) => ({
              value: conv(i.actual),
              itemStyle: {
                borderRadius: [4, 4, 0, 0],
                color: isValidNumber(i.surprise_pct)
                  ? i.surprise_pct >= 0
                    ? "#10B981"
                    : "#F43F5E"
                  : "#2563EB",
              },
            })),
          },
        ],
      };
    };

    return {
      compact: makeOpt(compactItems, false),
      modal: makeOpt(fullItems, true),
      hasData,
      compactItems,
    };
  };

  const epsSurpriseChart = useMemo(
    () => makeSurpriseChart(surprises?.eps || [], true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surprises, cur, curSym, isDark]
  );

  const revenueSurpriseChart = useMemo(
    () => makeSurpriseChart(surprises?.revenue || [], false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surprises, cur, curSym, isDark]
  );

  // 6. Consensus analystes
  const consensusChart = useMemo(() => {
    const c = analysts?.consensus;
    const hasData = Boolean(c && c.total > 0);
    const categories = ["Vente forte", "Vente", "Conserver", "Achat", "Achat fort"];
    const values = c
      ? [c.strong_sell, c.sell, c.hold, c.buy, c.strong_buy]
      : [0, 0, 0, 0, 0];
    const colors = ["#E11D48", "#FB7185", "#F59E0B", "#10B981", "#059669"];

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        trigger: "item",
        formatter: (params: unknown) => {
          const item = (Array.isArray(params) ? params[0] : params) as
            | { name?: string; value?: unknown }
            | undefined;
          return `${item?.name ?? ""} : <b>${item?.value ?? 0}</b> analyste(s)`;
        },
      },
      grid: { left: 10, right: 28, top: 14, bottom: 16, containLabel: true },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: textColor, fontSize: 11 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      series: [
        {
          name: "Analystes",
          type: "bar",
          barMaxWidth: isModal ? 30 : 20,
          data: values.map((val, idx) => ({
            value: val,
            itemStyle: { color: colors[idx], borderRadius: [0, 5, 5, 0] },
          })),
          label: {
            show: true,
            position: "right",
            color: textColor,
            fontSize: 11,
            formatter: "{c}",
          },
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData, consensus: c };
  }, [analysts, textColor, splitColor, tooltipBase]);

  const anyData =
    priceTargetChart.hasData ||
    revenueForecastChart.hasData ||
    epsForecastChart.hasData ||
    epsSurpriseChart.hasData ||
    revenueSurpriseChart.hasData ||
    consensusChart.hasData;

  if (!anyData) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          Aucune prévision ou donnée d&apos;analystes disponible pour {ticker}.
        </CardContent>
      </Card>
    );
  }

  const pt = analysts?.price_targets;
  const consensus = consensusChart.consensus;
  const scoreTone =
    isValidNumber(consensus?.score_out_of_5) && consensus.score_out_of_5 >= 3.8
      ? "emerald"
      : isValidNumber(consensus?.score_out_of_5) && consensus.score_out_of_5 >= 2.8
      ? "amber"
      : "coral";

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ExpandableChartCard
        title="Objectifs de prix 12 mois"
        subtitle={pt?.mean ? `Cible moyenne : ${formatPrice(conv(pt.mean), cur)}` : undefined}
        tooltip="Fourchette des objectifs de cours à 12 mois publiés par les analystes par rapport au cours actuel."
        option={priceTargetChart.compact}
        modalOption={priceTargetChart.modal}
        hasData={priceTargetChart.hasData}
        emptyMessage="Objectifs de prix indisponibles pour ce titre."
        downloadName={`${ticker}-objectifs-prix`}
        footer={
          pt && priceTargetChart.hasData ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {isValidNumber(pt.upside_low_pct) && (
                <Badge variant={pt.upside_low_pct >= 0 ? "emerald" : "coral"}>
                  Bas : {formatPercent(pt.upside_low_pct, { signed: true })}
                </Badge>
              )}
              {isValidNumber(pt.upside_mean_pct) && (
                <Badge variant={pt.upside_mean_pct >= 0 ? "emerald" : "coral"}>
                  Moyen : {formatPercent(pt.upside_mean_pct, { signed: true })}
                </Badge>
              )}
              {isValidNumber(pt.upside_high_pct) && (
                <Badge variant={pt.upside_high_pct >= 0 ? "emerald" : "coral"}>
                  Haut : {formatPercent(pt.upside_high_pct, { signed: true })}
                </Badge>
              )}
            </div>
          ) : null
        }
      />

      <ExpandableChartCard
        title="Prévisions Chiffre d'affaires"
        subtitle={`Consensus annuel (${curSym})`}
        tooltip="Historique récent et estimations basse, moyenne et haute des analystes pour le chiffre d'affaires futur."
        option={revenueForecastChart.compact}
        modalOption={revenueForecastChart.modal}
        hasData={revenueForecastChart.hasData}
        emptyMessage="Prévisions de chiffre d'affaires indisponibles."
        downloadName={`${ticker}-previsions-ca`}
        footer={<CagrFooter cagr={analysts?.revenue_cagr} />}
      />

      <ExpandableChartCard
        title="Prévisions Bénéfice par action (BPA)"
        subtitle={`Consensus annuel (${curSym}/action)`}
        tooltip="Bénéfice par action réel puis trajectoires basse, moyenne et haute anticipées par les analystes."
        option={epsForecastChart.compact}
        modalOption={epsForecastChart.modal}
        hasData={epsForecastChart.hasData}
        emptyMessage="Prévisions de BPA indisponibles."
        downloadName={`${ticker}-previsions-bpa`}
        footer={<CagrFooter cagr={analysts?.eps_cagr} />}
      />

      <ExpandableChartCard
        title="Surprises Bénéfice par action (BPA)"
        subtitle="Estimé vs Réel (trimestriel)"
        tooltip="Les analystes attendaient 1 000 pizzas vendues, tu en vends 1 080 = surprise positive de +8 %. Bon signe : des barres vertes presque à chaque trimestre."
        option={epsSurpriseChart.compact}
        modalOption={epsSurpriseChart.modal}
        hasData={epsSurpriseChart.hasData}
        emptyMessage="Surprises BPA indisponibles pour ce titre."
        downloadName={`${ticker}-surprises-bpa`}
        footer={<SurpriseFooter items={epsSurpriseChart.compactItems} />}
      />

      <ExpandableChartCard
        title="Surprises Chiffre d'affaires"
        subtitle="Estimé vs Réel (trimestriel)"
        tooltip="Les analystes attendaient 1 000 pizzas vendues, tu en vends 1 080 = surprise positive de +8 %. Bon signe : des barres vertes presque à chaque trimestre."
        option={revenueSurpriseChart.compact}
        modalOption={revenueSurpriseChart.modal}
        hasData={revenueSurpriseChart.hasData}
        emptyMessage="Surprises de chiffre d'affaires indisponibles (ou non couvertes en tier gratuit)."
        downloadName={`${ticker}-surprises-ca`}
        footer={<SurpriseFooter items={revenueSurpriseChart.compactItems} />}
      />

      <ExpandableChartCard
        title="Consensus des analystes"
        subtitle={consensus?.total ? `Basé sur ${consensus.total} analystes` : undefined}
        tooltip="Répartition des recommandations (d'Achat fort à Vente forte) et note synthétique sur 5."
        option={consensusChart.compact}
        modalOption={consensusChart.modal}
        hasData={consensusChart.hasData}
        emptyMessage="Recommandations d'analystes indisponibles."
        downloadName={`${ticker}-consensus-analystes`}
        footer={
          consensus && consensus.total > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {isValidNumber(consensus.score_out_of_5) && (
                <Badge variant={scoreTone}>
                  Score : {consensus.score_out_of_5.toFixed(1).replace(".", ",")} / 5
                </Badge>
              )}
              {consensus.label && <Badge variant={scoreTone}>{consensus.label}</Badge>}
              <Badge variant="secondary">{consensus.total} avis</Badge>
            </div>
          ) : null
        }
      />
    </div>
  );
}
