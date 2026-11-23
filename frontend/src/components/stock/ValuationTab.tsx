"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { FairValueCard } from "@/components/stock/FairValueCard";
import { Badge } from "@/components/ui/badge";
import { formatMonthYearFR, formatMultiple, formatPercent, isValidNumber } from "@/lib/formatters";
import type {
  FairValueResponse,
  FundamentalsResponse,
  HistoricalMultiple,
} from "@/lib/types";

interface ValuationTabProps {
  ticker: string;
  fairValue: FairValueResponse | null;
  fundamentals: FundamentalsResponse | null;
  currency?: string | null;
  currentPe?: number | null;
  currentPFcf?: number | null;
}

export function ValuationTab({
  ticker,
  fairValue,
  fundamentals,
  currency,
  currentPe,
  currentPFcf,
}: ValuationTabProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const textColor = isDark ? "#94A3B8" : "#64748B";
  const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";
  const tooltipBase = {
    trigger: "axis" as const,
    backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    borderColor: isDark ? "#334155" : "#E2E8F0",
    textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
  };

  const makeMultipleChart = (
    seriesName: string,
    getter: (h: HistoricalMultiple) => number | null | undefined,
    currentVal: number | null | undefined
  ) => {
    const histRows = (fundamentals?.historical_multiples || []).filter((h) =>
      isValidNumber(getter(h))
    );
    const histValues = histRows
      .map((h) => getter(h))
      .filter((v): v is number => isValidNumber(v) && v > 0);
    const avg =
      histValues.length > 0
        ? histValues.reduce((acc, v) => acc + v, 0) / histValues.length
        : null;

    const labels = histRows.map((h) =>
      h.fiscal_year ? String(h.fiscal_year) : formatMonthYearFR(h.period_end)
    );
    const vals = histRows.map((h) => getter(h) ?? null);
    const isCurrentValid = isValidNumber(currentVal) && currentVal > 0;

    if (isCurrentValid) {
      labels.push("Actuel");
      vals.push(currentVal);
    }

    const latestRef = isCurrentValid
      ? currentVal
      : vals.length > 0 && isValidNumber(vals[vals.length - 1])
      ? (vals[vals.length - 1] as number)
      : null;

    const diffVsAvgPct =
      isValidNumber(latestRef) && isValidNumber(avg) && avg > 0
        ? ((latestRef - avg) / avg) * 100
        : null;

    const hasData = vals.some((v) => isValidNumber(v));

    const makeOpt = (isModal: boolean): EChartsOption => ({
      animationDuration: 280,
      tooltip: {
        ...tooltipBase,
        valueFormatter: (v) => (isValidNumber(v) ? formatMultiple(v) : "—"),
      },
      grid: { left: 10, right: 20, top: 26, bottom: isModal ? 54 : 22, containLabel: true },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: textColor, fontSize: 10, formatter: (v: number) => `${v}x` },
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
          name: seriesName,
          type: "bar",
          barMaxWidth: isModal ? 38 : 26,
          data: vals.map((v, idx) => ({
            value: v,
            itemStyle: {
              borderRadius: [5, 5, 0, 0],
              color:
                labels[idx] === "Actuel"
                  ? "#0EA5E9"
                  : isValidNumber(avg) && isValidNumber(v) && v <= avg
                  ? "#10B981"
                  : "#2563EB",
            },
          })),
          ...(isValidNumber(avg)
            ? {
                markLine: {
                  symbol: "none",
                  silent: true,
                  lineStyle: { type: "dashed", color: "#F59E0B", width: 1.6 },
                  label: {
                    position: "insideStartTop",
                    formatter: `Moyenne hist. : ${formatMultiple(avg)}`,
                    backgroundColor: "rgba(245, 158, 11, 0.14)",
                    borderColor: "#F59E0B",
                    borderWidth: 1,
                    borderRadius: 6,
                    padding: [2, 6],
                    color: isDark ? "#FCD34D" : "#B45309",
                    fontSize: 10,
                    fontWeight: 600,
                  },
                  data: [{ yAxis: avg }],
                },
              }
            : {}),
        },
      ],
    });

    return { compact: makeOpt(false), modal: makeOpt(true), hasData, avg, latestRef, diffVsAvgPct };
  };

  const peChart = useMemo(
    () => makeMultipleChart("PER", (h) => h.pe, currentPe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fundamentals, currentPe, isDark]
  );

  const pfcfChart = useMemo(
    () => makeMultipleChart("Cours / Cash libre", (h) => h.p_fcf, currentPFcf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fundamentals, currentPFcf, isDark]
  );

  const renderFooter = (chart: {
    latestRef: number | null;
    avg: number | null;
    diffVsAvgPct: number | null;
  }) => {
    if (!isValidNumber(chart.avg) && !isValidNumber(chart.latestRef)) return null;
    const diffTone = !isValidNumber(chart.diffVsAvgPct)
      ? "secondary"
      : chart.diffVsAvgPct <= 0
      ? "emerald"
      : chart.diffVsAvgPct <= 15
      ? "amber"
      : "coral";
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {isValidNumber(chart.latestRef) && (
          <Badge variant="default">Actuel : {formatMultiple(chart.latestRef)}</Badge>
        )}
        {isValidNumber(chart.avg) && (
          <Badge variant="secondary">Moyenne hist. : {formatMultiple(chart.avg)}</Badge>
        )}
        {isValidNumber(chart.diffVsAvgPct) && (
          <Badge variant={diffTone}>
            Écart : {formatPercent(chart.diffVsAvgPct, { signed: true })}
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <FairValueCard fairValue={fairValue} currency={currency} />

      <div className="grid gap-4 md:grid-cols-2">
        <ExpandableChartCard
          title="Historique Cours / Bénéfice (PER)"
          subtitle="Multiples de clôture annuelle vs moyenne historique"
          tooltip="Combien d'années de bénéfices ou de cash tu paies aujourd'hui. Si ta pizzeria se vend d'habitude 15x ses bénéfices et qu'on te la propose à 10x (sous la ligne orange), tu fais une bonne affaire."
          option={peChart.compact}
          modalOption={peChart.modal}
          hasData={peChart.hasData}
          emptyMessage="Historique PER indisponible pour ce titre."
          downloadName={`${ticker}-historique-per`}
          footer={renderFooter(peChart)}
        />

        <ExpandableChartCard
          title="Historique Cours / Cash libre (P/FCF)"
          subtitle="Multiples de clôture annuelle vs moyenne historique"
          tooltip="Combien d'années de bénéfices ou de cash tu paies aujourd'hui. Si ta pizzeria se vend d'habitude 15x ses bénéfices et qu'on te la propose à 10x (sous la ligne orange), tu fais une bonne affaire."
          option={pfcfChart.compact}
          modalOption={pfcfChart.modal}
          hasData={pfcfChart.hasData}
          emptyMessage="Historique Cours / Cash libre indisponible pour ce titre."
          downloadName={`${ticker}-historique-pfcf`}
          footer={renderFooter(pfcfChart)}
        />
      </div>
    </div>
  );
}
