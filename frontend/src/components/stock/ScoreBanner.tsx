"use client";

import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatPercent, getToneClasses, isValidNumber } from "@/lib/formatters";
import type { ScorePillar, ScoresBundle } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CircularGaugeProps {
  pillar: ScorePillar;
  featured?: boolean;
}

function CircularGauge({ pillar, featured = false }: CircularGaugeProps) {
  const score = isValidNumber(pillar.score) ? pillar.score : null;
  const tone = getToneClasses(pillar.tone);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const progress = score !== null ? (Math.max(0, Math.min(100, score)) / 100) * circumference : 0;

  return (
    <div
      title={pillar.explanation}
      className={cn(
        "flex items-center gap-3.5 rounded-2xl border p-3.5 transition-colors",
        featured
          ? cn("border-2", tone.border, tone.bg)
          : "border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60"
      )}
    >
      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="5.5"
            className="stroke-slate-200 dark:stroke-slate-800"
          />
          {score !== null && (
            <circle
              cx="32"
              cy="32"
              r={radius}
              fill="none"
              strokeWidth="5.5"
              strokeLinecap="round"
              stroke={tone.stroke}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - progress}
              className="transition-all duration-500"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-sm font-bold tabular-nums", score !== null ? tone.text : "text-slate-400")}>
            {score !== null ? Math.round(score) : "—"}
          </span>
          <span className="text-[9px] text-slate-400">/100</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{pillar.label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400 break-words">
          {pillar.explanation}
        </p>
      </div>
    </div>
  );
}

export function ScoreBanner({ scores, currency }: { scores: ScoresBundle; currency?: string | null }) {
  const { formatDisplayCompact } = useDisplayCurrency();
  const badgeVariant =
    scores.summary_tone === "emerald"
      ? "emerald"
      : scores.summary_tone === "coral"
        ? "coral"
        : "amber";

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Notation Automatique /100
            </h2>
            <Badge variant={badgeVariant} className="font-semibold">
              {scores.summary_badge}
            </Badge>
            {scores.mode === "EQUITY" && scores.growth_trend && (
              <Badge variant="outline">Croissance : {scores.growth_trend}</Badge>
            )}
          </div>
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {scores.valuation_verdict}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <CircularGauge pillar={scores.global} featured />
          <CircularGauge pillar={scores.valuation} />
          <CircularGauge pillar={scores.growth} />
          <CircularGauge pillar={scores.quality} />
          <CircularGauge pillar={scores.health} />
        </div>

        {scores.mode === "ETF" && scores.etf_metrics && (
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/40 sm:grid-cols-4 lg:grid-cols-7">
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Frais (TER)</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatPercent(scores.etf_metrics.ter_pct, { decimals: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Encours (AUM)</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatDisplayCompact(scores.etf_metrics.aum, currency)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Perf 1A</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatPercent(scores.etf_metrics.perf_1y_pct, { signed: true })}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Perf 3A</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatPercent(scores.etf_metrics.perf_3y_pct, { signed: true })}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Perf 5A</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatPercent(scores.etf_metrics.perf_5y_pct, { signed: true })}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Volatilité</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatPercent(scores.etf_metrics.volatility_pct)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Drawdown max</p>
              <p className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                {formatPercent(scores.etf_metrics.max_drawdown_pct)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
