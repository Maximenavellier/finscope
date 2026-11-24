"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Calculator, Coins, Loader2, Sparkles, Wallet } from "lucide-react";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDcaSettings, postDcaPlan } from "@/lib/api";
import { formatPercent, formatPrice } from "@/lib/formatters";
import type { DcaPlanResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const LS_KEY = "finscope_dca_prefs_v1";

interface DcaAssistantCardProps {
  refreshSignal?: number;
}

export function DcaAssistantCard({ refreshSignal = 0 }: DcaAssistantCardProps) {
  const [cashKind, setCashKind] = useState<"monthly" | "lump">("monthly");
  const [amountEur, setAmountEur] = useState<number>(400);
  const [etfTargetPct, setEtfTargetPct] = useState<number>(70);
  const [mode, setMode] = useState<"standard" | "opportunistic">("standard");
  const [plan, setPlan] = useState<DcaPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const lastRefreshSignalRef = useRef(refreshSignal);

  const computePlan = useCallback(
    async (amt: number, etfPct: number, nextMode: "standard" | "opportunistic", persist: boolean) => {
      if (!Number.isFinite(amt) || amt <= 0) return;
      setLoading(true);
      setError(null);
      try {
        const res = await postDcaPlan({
          amount_eur: amt,
          etf_target_pct: etfPct,
          mode: nextMode,
          save_settings: persist,
        });
        setPlan(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de calcul DCA.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    (async () => {
      let initAmt = 400;
      let initEtf = 70;
      let initMode: "standard" | "opportunistic" = "standard";

      try {
        const remote = await getDcaSettings();
        if (!active) return;
        initAmt = remote.monthly_amount_eur || 400;
        initEtf = remote.etf_target_pct ?? 70;
        initMode = remote.default_mode || "standard";
      } catch {
        if (typeof window !== "undefined") {
          const raw = window.localStorage.getItem(LS_KEY);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Number(parsed.amountEur) > 0) initAmt = Number(parsed.amountEur);
              if (Number.isFinite(Number(parsed.etfTargetPct))) initEtf = Number(parsed.etfTargetPct);
              if (parsed.mode === "opportunistic" || parsed.mode === "standard") {
                initMode = parsed.mode;
              }
            } catch {
              // ignore invalid localStorage JSON
            }
          }
        }
      }

      if (!active) return;
      setAmountEur(initAmt);
      setEtfTargetPct(initEtf);
      setMode(initMode);
      setInitialized(true);
      await computePlan(initAmt, initEtf, initMode, false);
    })();
    return () => {
      active = false;
    };
  }, [computePlan]);

  // Refresh plan automatically if portfolio/watchlist data changes
  useEffect(() => {
    if (!initialized || refreshSignal === lastRefreshSignalRef.current) return;
    lastRefreshSignalRef.current = refreshSignal;
    computePlan(amountEur, etfTargetPct, mode, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal, initialized]);

  const handleCompute = async (
    nextAmt = amountEur,
    nextEtf = etfTargetPct,
    nextMode = mode,
    persist = true
  ) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ amountEur: nextAmt, etfTargetPct: nextEtf, mode: nextMode })
      );
    }
    await computePlan(nextAmt, nextEtf, nextMode, persist);
  };

  const equitiesTargetPct = Math.max(0, Math.round((100 - etfTargetPct) * 10) / 10);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span>Assistant Investissement (DCA / Ponctuel)</span>
            <InfoTooltip text="Calcule comment répartir votre cash disponible sans jamais vendre : soit en rééquilibrage pur vers votre cible ETF/Actions, soit en mode Opportuniste pour profiter des fortes décotes (/100 ≥ 75 et prix ≤ -15 % du Prix Juste)." />
          </CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sachez exactement quoi acheter et combien mettre sur chaque enveloppe dès que vous avez du cash.
          </p>
        </div>

        {/* Mode switch Standard vs Opportuniste */}
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => {
              setMode("standard");
              handleCompute(amountEur, etfTargetPct, "standard", cashKind === "monthly");
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              mode === "standard"
                ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                : "text-slate-600 dark:text-slate-300"
            )}
          >
            Standard (Rééquilibrage pur)
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("opportunistic");
              handleCompute(amountEur, etfTargetPct, "opportunistic", cashKind === "monthly");
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              mode === "opportunistic"
                ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                : "text-slate-600 dark:text-slate-300"
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Opportuniste</span>
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        {/* Input Controls */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Amount & Quick Type */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Montant à investir (€)
              </label>
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 text-[11px] dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setCashKind("monthly");
                    setAmountEur(400);
                    handleCompute(400, etfTargetPct, mode, true);
                  }}
                  className={cn(
                    "rounded-md px-2 py-0.5 font-semibold cursor-pointer",
                    cashKind === "monthly"
                      ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                      : "text-slate-500"
                  )}
                >
                  Mensuel (DCA)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCashKind("lump");
                    setAmountEur(2000);
                    handleCompute(2000, etfTargetPct, mode, false);
                  }}
                  className={cn(
                    "rounded-md px-2 py-0.5 font-semibold cursor-pointer",
                    cashKind === "lump"
                      ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                      : "text-slate-500"
                  )}
                >
                  Ponctuel
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={50}
                value={amountEur}
                onChange={(e) => setAmountEur(Math.max(1, Number(e.target.value) || 0))}
                className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <Button
                size="sm"
                disabled={loading}
                onClick={() => handleCompute(amountEur, etfTargetPct, mode, cashKind === "monthly")}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
                <span>Calculer</span>
              </Button>
            </div>
          </div>

          {/* Target Split ETF / Actions */}
          <div className="space-y-1.5 md:col-span-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                Cible de répartition :{" "}
                <strong className="text-blue-600 dark:text-blue-400">{etfTargetPct.toFixed(0)} % ETF (PEA)</strong>
                {" / "}
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {equitiesTargetPct.toFixed(0)} % Actions (CTO)
                </strong>
              </span>
              <span className="text-[11px] text-slate-400">Sauvegardée automatiquement</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={etfTargetPct}
              onChange={(e) => setEtfTargetPct(Number(e.target.value))}
              onMouseUp={() => handleCompute(amountEur, etfTargetPct, mode, true)}
              onTouchEnd={() => handleCompute(amountEur, etfTargetPct, mode, true)}
              className="h-2 w-full cursor-pointer accent-blue-600"
            />
            {plan && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  Actuel : {formatPercent(plan.current_etf_pct)} ETF / {formatPercent(plan.current_equities_pct)} Actions
                </span>
                <span>
                  Après versement :{" "}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {formatPercent(plan.projected_etf_pct)} ETF / {formatPercent(plan.projected_equities_pct)} Actions
                  </strong>
                </span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        )}

        {/* Explanations */}
        {plan && plan.explanations.length > 0 && (
          <div
            className={cn(
              "space-y-1 rounded-2xl border p-3.5 text-xs",
              plan.opportunistic_triggered
                ? "border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-slate-200 bg-slate-50/80 text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300"
            )}
          >
            {plan.explanations.map((msg, idx) => (
              <p key={idx} className="leading-relaxed">
                {msg}
              </p>
            ))}
          </div>
        )}

        {/* Line-by-line Buy Plan */}
        {plan && plan.lines.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Coins className="h-3.5 w-3.5 text-blue-600" />
                <span>Plan d&apos;achat prêt à exécuter ({formatPrice(plan.amount_eur, "EUR", 0)})</span>
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">ETF : {formatPrice(plan.etf_budget_eur, "EUR", 0)}</Badge>
                <Badge variant="outline">Actions : {formatPrice(plan.equities_budget_eur, "EUR", 0)}</Badge>
              </div>
            </div>

            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900/60">
              {plan.lines.map((line) => (
                <div
                  key={`${line.ticker}-${line.envelope}-${line.bucket}`}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {line.source !== "Cible" ? (
                        <Link
                          href={`/stock/${encodeURIComponent(line.ticker)}`}
                          className="text-sm font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                        >
                          {line.ticker}
                        </Link>
                      ) : (
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {line.ticker}
                        </span>
                      )}
                      <Badge variant={line.bucket === "ETF" ? "secondary" : "default"}>
                        {line.bucket === "ETF" ? "ETF" : "Action"}
                      </Badge>
                      <Badge variant={line.envelope === "PEA" ? "emerald" : "outline"}>
                        {line.envelope}
                      </Badge>
                      <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {line.name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{line.reason}</p>
                  </div>

                  <div className="flex items-baseline gap-2 sm:text-right shrink-0">
                    <span className="text-base font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatPrice(line.amount_eur, "EUR", 2)}
                    </span>
                    <span className="text-xs font-medium tabular-nums text-slate-400">
                      ({formatPercent(line.share_pct)})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
