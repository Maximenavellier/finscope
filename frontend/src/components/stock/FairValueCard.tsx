"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { FairValueResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FairValueCardProps {
  fairValue: FairValueResponse | null;
  currency?: string | null;
}

type ScenarioKey = "prudent" | "central" | "optimiste" | "custom";

function clampHalf(val: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, val));
  return Math.round(clamped * 2) / 2;
}

export function FairValueCard({ fairValue, currency }: FairValueCardProps) {
  const defaultG = clampHalf(fairValue?.default_growth_pct ?? 10, -5, 35);
  const defaultM = clampHalf(fairValue?.default_exit_multiple ?? 18, 5, 60);
  const defaultR = clampHalf(fairValue?.default_required_return_pct ?? 10, 5, 20);
  const { convertAmount, resolveCurrency } = useDisplayCurrency();
  const displayCur = resolveCurrency(currency);

  const [growthPct, setGrowthPct] = useState<number>(defaultG);
  const [exitMultiple, setExitMultiple] = useState<number>(defaultM);
  const [requiredReturnPct, setRequiredReturnPct] = useState<number>(defaultR);
  const [scenario, setScenario] = useState<ScenarioKey>("central");

  const applyScenario = (key: "prudent" | "central" | "optimiste") => {
    setScenario(key);
    if (key === "central") {
      setGrowthPct(defaultG);
      setExitMultiple(defaultM);
      setRequiredReturnPct(defaultR);
    } else if (key === "prudent") {
      setGrowthPct(clampHalf(defaultG > 0 ? defaultG * 0.65 : defaultG - 2, -5, 35));
      setExitMultiple(clampHalf(defaultM * 0.8, 5, 60));
      setRequiredReturnPct(clampHalf(defaultR + 1.5, 5, 20));
    } else {
      setGrowthPct(clampHalf(defaultG > 0 ? defaultG * 1.25 : defaultG + 3, -5, 35));
      setExitMultiple(clampHalf(defaultM * 1.15, 5, 60));
      setRequiredReturnPct(clampHalf(Math.max(7, defaultR - 1.0), 5, 20));
    }
  };

  const computed = useMemo(() => {
    if (
      !fairValue?.available ||
      !isValidNumber(fairValue.base_metric_per_share) ||
      !isValidNumber(fairValue.current_price) ||
      fairValue.base_metric_per_share <= 0 ||
      fairValue.current_price <= 0
    ) {
      return null;
    }

    const horizon = fairValue.horizon_years || 5;
    const g = growthPct / 100;
    const r = requiredReturnPct / 100;
    const projectedMetric = fairValue.base_metric_per_share * Math.max(0, 1 + g) ** horizon;
    const terminalPrice = projectedMetric * exitMultiple;
    const fv = terminalPrice / Math.max(0.01, 1 + r) ** horizon;
    const upsidePct = ((fv - fairValue.current_price) / fairValue.current_price) * 100;
    const marginOfSafetyPct = fv > 0 ? ((fv - fairValue.current_price) / fv) * 100 : null;

    let verdict = "Proche du prix juste";
    let tone: "emerald" | "amber" | "coral" = "amber";
    if (upsidePct >= 20) {
      verdict = "Sous-évaluée";
      tone = "emerald";
    } else if (upsidePct < -10) {
      verdict = "Surévaluée";
      tone = "coral";
    }

    return {
      fairValue: fv,
      upsidePct,
      marginOfSafetyPct,
      verdict,
      tone,
    };
  }, [fairValue, growthPct, exitMultiple, requiredReturnPct]);

  if (!fairValue || fairValue.reason === "ETF") return null;

  if (!fairValue.available || !computed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Calculateur de Prix Juste</CardTitle>
          <CardDescription>
            Indisponible pour ce titre ({fairValue.verdict || "bénéfices ou FCF négatifs"}).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const baseLabel =
    fairValue.metric_used === "FCF"
      ? "Cash libre par action (FCF par action)"
      : "Bénéfice par action (BPA)";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <CardTitle>Calculateur de Prix Juste ({fairValue.horizon_years} ans)</CardTitle>
            <InfoTooltip text="Projette le BPA ou le FCF par action sur 5 ans, applique un multiple de sortie puis actualise au taux de rendement exigé." />
          </div>
          <CardDescription>
            Base : {baseLabel} ({formatPrice(convertAmount(fairValue.base_metric_per_share, currency), displayCur)})
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-950">
            {(
              [
                { id: "prudent", label: "Prudent" },
                { id: "central", label: "Central" },
                { id: "optimiste", label: "Optimiste" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => applyScenario(opt.id)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap",
                  scenario === opt.id
                    ? "bg-white text-blue-600 shadow-xs dark:bg-slate-800 dark:text-blue-400"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => applyScenario("central")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Réinitialiser</span>
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          {/* 3 Interactive Sliders */}
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <span>Croissance attendue (% / an)</span>
                  <InfoTooltip text="Taux de croissance annuel moyen estimé du BPA ou du FCF par action sur l'horizon de 5 ans." />
                </span>
                <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {growthPct.toFixed(1).replace(".", ",")} %
                </span>
              </div>
              <input
                type="range"
                min={-5}
                max={35}
                step={0.5}
                value={growthPct}
                onChange={(e) => {
                  setScenario("custom");
                  setGrowthPct(Number(e.target.value));
                }}
                className="w-full cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <span>
                    Multiple de sortie ({fairValue.metric_used === "FCF" ? "Cours / FCF" : "Cours / Bénéfice (PER)"})
                  </span>
                  <InfoTooltip text="Multiple auquel vous estimez que le marché valorisera l'entreprise dans 5 ans." />
                </span>
                <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {exitMultiple.toFixed(1).replace(".", ",")}x
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={0.5}
                value={exitMultiple}
                onChange={(e) => {
                  setScenario("custom");
                  setExitMultiple(Number(e.target.value));
                }}
                className="w-full cursor-pointer"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300">
                  <span>Rendement exigé (% / an)</span>
                  <InfoTooltip text="Rentabilité annuelle minimale attendue de votre investissement (taux d'actualisation)." />
                </span>
                <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {requiredReturnPct.toFixed(1).replace(".", ",")} %
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={20}
                step={0.5}
                value={requiredReturnPct}
                onChange={(e) => {
                  setScenario("custom");
                  setRequiredReturnPct(Number(e.target.value));
                }}
                className="w-full cursor-pointer"
              />
            </div>
          </div>

          {/* Result Panel */}
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-950/50">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Prix Juste estimé</p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatPrice(convertAmount(computed.fairValue, currency), displayCur)}
                </p>
              </div>
              <Badge variant={computed.tone} className="text-xs font-semibold">
                {computed.verdict}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Prix actuel</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatPrice(convertAmount(fairValue.current_price, currency), displayCur)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Potentiel</p>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    computed.upsidePct >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {formatPercent(computed.upsidePct, { signed: true })}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Marge sécurité</p>
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    (computed.marginOfSafetyPct ?? 0) >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {formatPercent(computed.marginOfSafetyPct, { signed: true })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
