"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ChevronDown, ChevronUp, Loader2, ShieldCheck, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useTheme } from "next-themes";
import { ExpandableChartCard } from "@/components/stock/ExpandableChartCard";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getProjectionDefaults, postProjections } from "@/lib/api";
import { formatPrice, isValidNumber } from "@/lib/formatters";
import type { ProjectionDefaultsResponse, ProjectionResponse } from "@/lib/types";

export function ProjectionsClient() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [defaults, setDefaults] = useState<ProjectionDefaultsResponse | null>(null);
  const [monthly, setMonthly] = useState(400);
  const [peaSharePct, setPeaSharePct] = useState(70);
  const [annualReturnPct, setAnnualReturnPct] = useState(8);
  const [horizonYears, setHorizonYears] = useState(20);
  const [inflationPct, setInflationPct] = useState(2);
  const [indexToInflation, setIndexToInflation] = useState(true);
  const [careerGrowthPct, setCareerGrowthPct] = useState(2.0);

  const [taxOpen, setTaxOpen] = useState(false);
  const [peaTaxRatePct, setPeaTaxRatePct] = useState(18.6);
  const [ctoTaxRatePct, setCtoTaxRatePct] = useState(31.4);

  const [result, setResult] = useState<ProjectionResponse | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingInit(true);
      try {
        const defs = await getProjectionDefaults(false);
        if (!active) return;
        setDefaults(defs);
        setMonthly(Math.round(defs.monthly_contribution || 400));
        setPeaSharePct(Math.round(defs.pea_share_pct ?? 70));
        setPeaTaxRatePct(defs.pea_tax_rate_pct ?? 18.6);
        setCtoTaxRatePct(defs.cto_tax_rate_pct ?? 31.4);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Impossible de charger votre portefeuille.");
        }
      } finally {
        if (active) setLoadingInit(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const runSimulation = useCallback(async () => {
    if (!defaults) return;
    setCalculating(true);
    setError(null);
    try {
      const res = await postProjections({
        initial_pea_value: defaults.initial_pea_value,
        initial_pea_contributions: defaults.initial_pea_contributions,
        initial_cto_value: defaults.initial_cto_value,
        initial_cto_contributions: defaults.initial_cto_contributions,
        monthly_contribution: monthly,
        pea_share_pct: peaSharePct,
        annual_return_pct: annualReturnPct,
        horizon_years: horizonYears,
        inflation_pct: inflationPct,
        pea_tax_rate_pct: peaTaxRatePct,
        cto_tax_rate_pct: ctoTaxRatePct,
        pea_cap_eur: 150000,
        index_contributions_to_inflation: indexToInflation,
        career_growth_pct: careerGrowthPct,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de simulation.");
    } finally {
      setCalculating(false);
    }
  }, [
    defaults,
    monthly,
    peaSharePct,
    annualReturnPct,
    horizonYears,
    inflationPct,
    indexToInflation,
    careerGrowthPct,
    peaTaxRatePct,
    ctoTaxRatePct,
  ]);

  useEffect(() => {
    if (!defaults) return;
    const timer = setTimeout(() => {
      runSimulation();
    }, 140);
    return () => clearTimeout(timer);
  }, [defaults, runSimulation]);

  const makeOption = (isModal: boolean): EChartsOption => {
    if (!result || result.points.length === 0) return {};

    const labels = result.points.map((p) => `${p.calendar_year}`);
    const contributed = result.points.map((p) => p.contributed_eur);
    const gross = result.points.map((p) => p.gross_value_eur);
    const net = result.points.map((p) => p.net_value_eur);
    const netReal = result.points.map((p) => p.net_real_value_eur);

    const capCalYear = result.pea_cap_reached_calendar_year;
    const textColor = isDark ? "#94A3B8" : "#64748B";
    const splitColor = isDark ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.22)";

    return {
      animationDuration: 260,
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
        valueFormatter: (v) =>
          isValidNumber(v) ? `${Math.round(v).toLocaleString("fr-FR")} €` : "—",
      },
      legend: { top: 0, textStyle: { color: textColor, fontSize: 11 } },
      grid: {
        left: 14,
        right: 26,
        top: 38,
        bottom: isModal ? 54 : 26,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { color: textColor, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: (v: number) => (v >= 1000 ? `${Math.round(v / 1000)} k€` : `${v} €`),
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
          name: "Valeur Brute",
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: gross,
          lineStyle: { color: "#2563EB", width: 2.5 },
          itemStyle: { color: "#2563EB" },
          ...(capCalYear
            ? {
                markLine: {
                  symbol: ["none", "none"],
                  label: {
                    formatter: `Plafond PEA 150 k€ (${capCalYear})`,
                    position: "insideEndTop",
                    color: "#F59E0B",
                    fontSize: 11,
                    fontWeight: 600,
                  },
                  lineStyle: { color: "#F59E0B", type: "dashed", width: 1.5 },
                  data: [{ xAxis: `${capCalYear}` }],
                },
              }
            : {}),
        },
        {
          name: "Valeur Nette d'impôts",
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: net,
          lineStyle: { color: "#10B981", width: 2.5 },
          itemStyle: { color: "#10B981" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(16, 185, 129, 0.22)" },
                { offset: 1, color: "rgba(16, 185, 129, 0.02)" },
              ],
            },
          },
        },
        {
          name: "Nette + Inflation (euros actuels)",
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: netReal,
          lineStyle: { color: "#8B5CF6", width: 2, type: "dashed" },
          itemStyle: { color: "#8B5CF6" },
        },
        {
          name: "Capital versé",
          type: "line",
          smooth: 0.15,
          showSymbol: false,
          data: contributed,
          lineStyle: { color: "#94A3B8", width: 2 },
          itemStyle: { color: "#94A3B8" },
        },
      ],
    };
  };

  const compactOption = useMemo(() => makeOption(false), [result, isDark]);
  const modalOption = useMemo(() => makeOption(true), [result, isDark]);

  if (loadingInit) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <span>Simulateur de Capital &amp; Plafond PEA 150 000 €</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Branché sur votre portefeuille réel actuel : PEA{" "}
            <strong className="text-slate-700 dark:text-slate-200">
              {formatPrice(defaults?.initial_pea_value ?? 0, "EUR", 0)}
            </strong>{" "}
            (versé : {formatPrice(defaults?.initial_pea_contributions ?? 0, "EUR", 0)}) · CTO{" "}
            <strong className="text-slate-700 dark:text-slate-200">
              {formatPrice(defaults?.initial_cto_value ?? 0, "EUR", 0)}
            </strong>
          </p>
        </div>

        {calculating && (
          <div className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
            <span>Mise à jour...</span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Left: Sliders & French Tax Accordion */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <SlidersHorizontal className="h-4 w-4 text-blue-600" />
              <span>Paramètres de simulation</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">Versement mensuel</span>
                <strong className="text-blue-600 dark:text-blue-400">{monthly} € / mois</strong>
              </div>
              <input
                type="range"
                min={0}
                max={3000}
                step={50}
                value={monthly}
                onChange={(e) => setMonthly(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-blue-600"
              />
              <label className="flex items-start gap-2 pt-0.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={indexToInflation}
                  onChange={(e) => setIndexToInflation(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded accent-blue-600 cursor-pointer"
                />
                <span>
                  Indexer les versements sur l&apos;inflation
                  {indexToInflation &&
                    inflationPct > 0 &&
                    monthly > 0 &&
                    result?.final_monthly_contribution_eur && (
                      <span className="ml-1 font-semibold text-blue-600 dark:text-blue-400">
                        ({monthly} € → {Math.round(result.final_monthly_contribution_eur)} €/mois à l&apos;an {horizonYears})
                      </span>
                    )}
                </span>
              </label>

              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Progression de carrière (% / an en plus)
                  </span>
                  <strong className="text-emerald-600 dark:text-emerald-400">
                    +{careerGrowthPct.toFixed(1).replace(".", ",")} % / an
                  </strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={careerGrowthPct}
                  onChange={(e) => setCareerGrowthPct(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-emerald-600"
                />
                {monthly > 0 && result?.final_monthly_contribution_real_eur !== undefined && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {monthly.toLocaleString("fr-FR")} € →{" "}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {Math.round(result.final_monthly_contribution_real_eur).toLocaleString("fr-FR")} €/mois en € d&apos;aujourd&apos;hui
                    </strong>{" "}
                    à l&apos;an {horizonYears}
                    {indexToInflation && inflationPct > 0 && result.final_monthly_contribution_eur
                      ? ` (${Math.round(result.final_monthly_contribution_eur).toLocaleString("fr-FR")} € nominal)`
                      : ""}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  Part dirigée vers PEA (avant plafond)
                </span>
                <strong>{peaSharePct} % PEA / {100 - peaSharePct} % CTO</strong>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={peaSharePct}
                onChange={(e) => setPeaSharePct(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-blue-600"
              />
              <p className="text-[11px] text-slate-400">
                Dès 150 000 € versés sur le PEA, 100 % des versements basculent vers le CTO.
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">Rendement annuel estimé</span>
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {annualReturnPct.toFixed(1).replace(".", ",")} % / an
                </strong>
              </div>
              <input
                type="range"
                min={2}
                max={15}
                step={0.5}
                value={annualReturnPct}
                onChange={(e) => setAnnualReturnPct(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-emerald-600"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">Horizon</span>
                <strong>{horizonYears} ans</strong>
              </div>
              <input
                type="range"
                min={1}
                max={40}
                step={1}
                value={horizonYears}
                onChange={(e) => setHorizonYears(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-blue-600"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-200">Inflation annuelle</span>
                <strong>{inflationPct.toFixed(1).replace(".", ",")} % / an</strong>
              </div>
              <input
                type="range"
                min={0}
                max={6}
                step={0.5}
                value={inflationPct}
                onChange={(e) => setInflationPct(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-violet-600"
              />
            </div>

            {/* French Tax Accordion */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setTaxOpen((prev) => !prev)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Options fiscales françaises
                </span>
                {taxOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {taxOpen && (
                <div className="space-y-3 border-t border-slate-100 p-3 text-xs dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-slate-600 dark:text-slate-300">
                      Prélèvements sociaux PEA (&gt; 5 ans) %
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={0.1}
                      value={peaTaxRatePct}
                      onChange={(e) => setPeaTaxRatePct(Math.max(0, Number(e.target.value) || 0))}
                      className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 text-right font-semibold dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-slate-600 dark:text-slate-300">
                      Flat Tax / PFU CTO %
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={0.1}
                      value={ctoTaxRatePct}
                      onChange={(e) => setCtoTaxRatePct(Math.max(0, Number(e.target.value) || 0))}
                      className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 text-right font-semibold dark:border-slate-700 dark:bg-slate-900"
                    />
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: KPI Summary Cards + Compounding Chart */}
        <div className="space-y-5">
          {result && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-slate-500">Capital versé total</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatPrice(result.final_contributed_eur, "EUR", 0)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Horizon {result.horizon_years} ans
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-slate-500">Valeur Brute estimée</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">
                    {formatPrice(result.final_gross_eur, "EUR", 0)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Dont {formatPrice(result.final_pea_value_eur, "EUR", 0)} en PEA
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    <span>Valeur Nette d&apos;impôts</span>
                    <InfoTooltip
                      text={`Impôts estimés appliqués uniquement sur les plus-values : ${peaTaxRatePct} % sur le PEA et ${ctoTaxRatePct} % sur le CTO.`}
                    />
                  </div>
                  <p className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatPrice(result.final_net_eur, "EUR", 0)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Pouvoir d&apos;achat constant :{" "}
                    <strong className="text-violet-600 dark:text-violet-400">
                      {formatPrice(result.final_net_real_eur, "EUR", 0)}
                    </strong>
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    <span>Rente mensuelle (règle 4 %)</span>
                    <InfoTooltip text="Retrait sécurisé estimé de 4 %/an du capital net divisé par 12 mois." />
                  </div>
                  <p className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatPrice(result.monthly_rent_4pct_net_eur, "EUR", 0)} / mois
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Soit {formatPrice(result.monthly_rent_4pct_real_eur, "EUR", 0)}/mois en € d&apos;aujourd&apos;hui
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          <ExpandableChartCard
            title="Trajectoire du Patrimoine (PEA + CTO)"
            subtitle={
              result?.pea_cap_reached_calendar_year
                ? `Plafond PEA de 150 000 € atteint en ${result.pea_cap_reached_calendar_year} (année ${result.pea_cap_reached_year}) → bascule automatique 100 % CTO`
                : `Plafond PEA 150 000 € non atteint sur ${horizonYears} ans`
            }
            tooltip="Simule la capitalisation mensuelle de votre PEA et CTO existants en basculant automatiquement tous les versements sur le CTO dès que les versements cumulés sur le PEA atteignent 150 000 €."
            option={compactOption}
            modalOption={modalOption}
            chartClassName="h-72 sm:h-80"
            hasData={Boolean(result && result.points.length >= 2)}
            downloadName={`projection-patrimoine-${horizonYears}ans`}
            footer={
              result ? (
                <div className="flex flex-wrap items-center gap-2">
                  {result.pea_cap_reached_calendar_year ? (
                    <Badge variant="amber">
                      Plafond PEA 150 k€ atteint en {result.pea_cap_reached_calendar_year} (an {result.pea_cap_reached_year})
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Plafond PEA 150 k€ non atteint sur l&apos;horizon</Badge>
                  )}
                  <Badge variant="outline">
                    Fiscalité totale estimée : {formatPrice(result.total_taxes_eur, "EUR", 0)}
                  </Badge>
                  <Badge variant="emerald">
                    CTO final : {formatPrice(result.final_cto_value_eur, "EUR", 0)}
                  </Badge>
                </div>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
