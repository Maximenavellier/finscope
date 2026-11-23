"use client";

import { Target } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCompactNumber,
  formatMultiple,
  formatPercent,
  formatPrice,
  getToneClasses,
  isValidNumber,
} from "@/lib/formatters";
import type { PortfolioWeightedStats } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WeightedStatsCardProps {
  stats: PortfolioWeightedStats;
  annualizedReturnPct?: number | null;
  elapsedYears?: number | null;
  targetAnnualReturnPct?: number;
  loadingReturn?: boolean;
}

export function WeightedStatsCard({
  stats,
  annualizedReturnPct,
  elapsedYears,
  targetAnnualReturnPct = 8,
  loadingReturn = false,
}: WeightedStatsCardProps) {
  const { displayCurrency, convertAmount } = useDisplayCurrency();
  const conv = (v: number | null | undefined) => convertAmount(v, "EUR", displayCurrency);
  const pnlPositive = stats.total_pnl_eur >= 0;
  const avgScore = isValidNumber(stats.avg_score_global) ? stats.avg_score_global : null;
  const hasCagr = isValidNumber(annualizedReturnPct);
  const goalDiff = hasCagr ? annualizedReturnPct - targetAnnualReturnPct : null;
  const scoreTone = getToneClasses(
    avgScore === null ? "amber" : avgScore >= 70 ? "emerald" : avgScore >= 45 ? "amber" : "coral"
  );

  const fundamentalsItems = [
    { label: "Capi moyenne", value: formatCompactNumber(conv(stats.avg_market_cap_eur), displayCurrency) },
    { label: "PER", value: formatMultiple(stats.pe) },
    { label: "PER prévisionnel", value: formatMultiple(stats.forward_pe) },
    { label: "P / FCF", value: formatMultiple(stats.p_fcf) },
    { label: "PEG", value: formatMultiple(stats.peg, 2) },
    { label: "Marge brute", value: formatPercent(stats.gross_margin, { isDecimal: true }) },
    { label: "Marge opé.", value: formatPercent(stats.op_margin, { isDecimal: true }) },
    { label: "Marge nette", value: formatPercent(stats.net_margin, { isDecimal: true }) },
    { label: "ROE", value: formatPercent(stats.roe, { isDecimal: true }) },
    { label: "ROA", value: formatPercent(stats.roa, { isDecimal: true }) },
    { label: "Croissance CA", value: formatPercent(stats.rev_growth_1y, { isDecimal: true, signed: true }) },
    { label: "Croissance BPA", value: formatPercent(stats.eps_growth_1y, { isDecimal: true, signed: true }) },
    { label: "Dette nette / EBITDA", value: formatMultiple(stats.net_debt_ebitda) },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Statistiques Agrégées du Portefeuille</CardTitle>
            <CardDescription>
              Moyennes pondérées calculées sur les {stats.equities_count} action(s) en portefeuille (hors ETF)
            </CardDescription>
          </div>
          {avgScore !== null && (
            <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-1.5", scoreTone.border, scoreTone.bg)}>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Note Portefeuille
              </span>
              <span className={cn("text-base font-bold tabular-nums", scoreTone.text)}>
                {avgScore.toFixed(0)}/100
              </span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Top KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Valeur totale</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              {formatPrice(conv(stats.total_value_eur), displayCurrency)}
            </p>
            <p className="text-[11px] tabular-nums text-slate-400">
              Investi : {formatPrice(conv(stats.total_cost_eur), displayCurrency)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">+/- Value latente</p>
            <p
              className={cn(
                "mt-0.5 text-lg font-bold tabular-nums",
                pnlPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
              )}
            >
              {stats.total_pnl_eur > 0 ? "+" : ""}
              {formatPrice(conv(stats.total_pnl_eur), displayCurrency)}
            </p>
            <p
              className={cn(
                "text-[11px] font-semibold tabular-nums",
                pnlPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
              )}
            >
              {formatPercent(stats.total_pnl_pct, { signed: true })}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Perf. du jour</p>
            {isValidNumber(stats.day_pnl_eur) ? (
              <>
                <p
                  className={cn(
                    "mt-0.5 text-lg font-bold tabular-nums",
                    stats.day_pnl_eur >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {stats.day_pnl_eur > 0 ? "+" : ""}
                  {formatPrice(conv(stats.day_pnl_eur), displayCurrency)}
                </p>
                <p
                  className={cn(
                    "text-[11px] font-semibold tabular-nums",
                    stats.day_pnl_eur >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {formatPercent(stats.day_pnl_pct, { signed: true })}
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-400">—</p>
                <p className="text-[11px] text-slate-400">Indisponible</p>
              </>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Composition</p>
            <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              {stats.equities_count} act. · {stats.etfs_count} ETF
            </p>
            <p className="text-[11px] tabular-nums text-slate-400">
              Top 5 : {formatPercent(stats.top5_weight_pct)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Actions vs ETF</p>
            <div className="mt-1.5 flex items-center justify-between text-xs font-semibold tabular-nums">
              <span className="text-blue-600 dark:text-blue-400">
                {stats.equities_weight_pct.toFixed(0)} %
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                {stats.etfs_weight_pct.toFixed(0)} %
              </span>
            </div>
            <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="bg-blue-600 transition-all"
                style={{ width: `${stats.equities_weight_pct}%` }}
              />
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${stats.etfs_weight_pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Annualized Return (TWR / CAGR) vs Target */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Rendement annuel moyen (TWR)
            </span>
            <InfoTooltip text="Taux de croissance annuel composé (CAGR) calculé sur la courbe de performance réelle (TWR) de votre portefeuille, indépendant de la date de vos apports de cash." />
            {isValidNumber(elapsedYears) && elapsedYears > 0 && (
              <span className="text-[11px] text-slate-400">
                (sur {elapsedYears.toFixed(1).replace(".", ",")} ans)
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {loadingReturn && !hasCagr ? (
              <span className="text-xs text-slate-400">Calcul en cours...</span>
            ) : hasCagr ? (
              <>
                <span
                  className={cn(
                    "text-base font-bold tabular-nums",
                    annualizedReturnPct >= targetAnnualReturnPct
                      ? "text-emerald-600 dark:text-emerald-400"
                      : annualizedReturnPct >= 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {formatPercent(annualizedReturnPct, { signed: true })} / an
                </span>
                {goalDiff !== null && (
                  <Badge variant={goalDiff >= 0 ? "emerald" : "amber"}>
                    {goalDiff >= 0
                      ? `Objectif ${targetAnnualReturnPct} % atteint (+${goalDiff.toFixed(1).replace(".", ",")} pts)`
                      : `Sous l'objectif ${targetAnnualReturnPct} % (${goalDiff.toFixed(1).replace(".", ",")} pts)`}
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-xs text-slate-400">Historique ≥ 30 jours requis</span>
            )}
          </div>
        </div>

        {/* Equities-only weighted fundamentals */}
        {stats.equities_count > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {fundamentalsItems.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-100 bg-white px-3 py-2 dark:border-slate-800/80 dark:bg-slate-900/60"
              >
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
