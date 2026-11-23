"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, PlusCircle, TrendingDown, Trash2 } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { PortfolioPositionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

type HorizonKey = "total" | "1D" | "1M" | "1Y";

const HORIZON_OPTIONS: { key: HorizonKey; label: string; columnLabel: string }[] = [
  { key: "total", label: "Total", columnLabel: "+/- Value (Total)" },
  { key: "1D", label: "1J", columnLabel: "Perf. 1J" },
  { key: "1M", label: "1M", columnLabel: "Perf. 1M" },
  { key: "1Y", label: "1A", columnLabel: "Perf. 1A" },
];

function getPositionHorizonValues(
  pos: PortfolioPositionItem,
  horizon: HorizonKey
): { eur: number | null; pct: number | null } {
  if (horizon === "1D") {
    return {
      eur: isValidNumber(pos.day_change_eur) ? pos.day_change_eur : null,
      pct: isValidNumber(pos.day_change_pct) ? pos.day_change_pct : null,
    };
  }
  if (horizon === "1M") {
    return {
      eur: isValidNumber(pos.perf_1m_eur) ? pos.perf_1m_eur : null,
      pct: isValidNumber(pos.perf_1m_pct) ? pos.perf_1m_pct : null,
    };
  }
  if (horizon === "1Y") {
    return {
      eur: isValidNumber(pos.perf_1y_eur) ? pos.perf_1y_eur : null,
      pct: isValidNumber(pos.perf_1y_pct) ? pos.perf_1y_pct : null,
    };
  }
  return {
    eur: pos.pnl_eur,
    pct: isValidNumber(pos.pnl_pct) ? pos.pnl_pct : null,
  };
}

function getAggregateHorizonSummary(
  positions: PortfolioPositionItem[],
  horizon: HorizonKey
): { eur: number; pct: number | null } | null {
  if (positions.length === 0) return null;
  if (horizon === "total") {
    const eurSum = positions.reduce((acc, p) => acc + p.pnl_eur, 0);
    const costSum = positions.reduce((acc, p) => acc + p.cost_basis_eur, 0);
    return {
      eur: eurSum,
      pct: costSum > 0 ? (eurSum / costSum) * 100 : null,
    };
  }
  let eurSum = 0;
  let prevSum = 0;
  let hasAny = false;
  for (const pos of positions) {
    const { eur, pct } = getPositionHorizonValues(pos, horizon);
    if (eur === null || pct === null || pos.current_value_eur <= 0) continue;
    const prevVal = pos.current_value_eur - eur;
    if (prevVal <= 0) continue;
    eurSum += eur;
    prevSum += prevVal;
    hasAny = true;
  }
  if (!hasAny || prevSum <= 0) return null;
  return {
    eur: eurSum,
    pct: (eurSum / prevSum) * 100,
  };
}

interface PositionsTableProps {
  positions: PortfolioPositionItem[];
  onReinforce: (pos: PortfolioPositionItem) => void;
  onEdit: (pos: PortfolioPositionItem) => void;
  onSell: (pos: PortfolioPositionItem) => void;
  onDelete: (pos: PortfolioPositionItem) => void;
}

export function PositionsTable({
  positions,
  onReinforce,
  onEdit,
  onSell,
  onDelete,
}: PositionsTableProps) {
  const { displayCurrency, convertAmount, formatDisplayPrice } = useDisplayCurrency();
  const [perfHorizon, setPerfHorizon] = useState<HorizonKey>("total");
  const convEur = (v: number) => convertAmount(v, "EUR", displayCurrency) ?? v;

  const activeHorizonMeta =
    HORIZON_OPTIONS.find((item) => item.key === perfHorizon) || HORIZON_OPTIONS[0];
  const horizonSummary = getAggregateHorizonSummary(positions, perfHorizon);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <CardTitle>Lignes en Portefeuille ({positions.length})</CardTitle>
          {horizonSummary && (
            <Badge
              variant={horizonSummary.eur >= 0 ? "emerald" : "coral"}
              className="tabular-nums"
            >
              {activeHorizonMeta.label} : {horizonSummary.eur > 0 ? "+" : ""}
              {formatPrice(convEur(horizonSummary.eur), displayCurrency)}
              {horizonSummary.pct !== null
                ? ` (${formatPercent(horizonSummary.pct, { signed: true })})`
                : ""}
            </Badge>
          )}
        </div>

        {positions.length > 0 && (
          <div
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-950/60"
            role="group"
            aria-label="Période de performance des positions"
          >
            {HORIZON_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPerfHorizon(opt.key)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                  perfHorizon === opt.key
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {positions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Aucune position enregistrée. Ajoutez une première action ou un ETF pour démarrer votre suivi.
          </div>
        ) : (
          <>
            {/* Mobile card layout */}
            <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/80">
              {positions.map((pos) => {
                const { eur: hEur, pct: hPct } = getPositionHorizonValues(pos, perfHorizon);
                const hasPerf = hEur !== null;
                const pnlPos = (hEur ?? 0) >= 0;
                const score = isValidNumber(pos.score_global) ? pos.score_global : null;
                const scoreVariant =
                  score === null ? "secondary" : score >= 70 ? "emerald" : score >= 45 ? "amber" : "coral";

                return (
                  <div key={`m-${pos.id}`} className="space-y-2.5 px-4 py-3.5 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/stock/${encodeURIComponent(pos.ticker)}`} className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {pos.ticker}
                          </span>
                          <Badge variant={pos.envelope === "PEA" ? "emerald" : "outline"}>
                            {pos.envelope}
                          </Badge>
                          {pos.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                          <Badge variant={scoreVariant}>
                            {score !== null ? `${Math.round(score)}/100` : "—"}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {pos.name}
                        </p>
                      </Link>

                      <div className="text-right tabular-nums shrink-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          {formatPrice(convEur(pos.current_value_eur), displayCurrency)}
                        </p>
                        {hasPerf ? (
                          <p
                            className={cn(
                              "text-[11px] font-semibold",
                              pnlPos
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {hEur > 0 ? "+" : ""}
                            {formatPrice(convEur(hEur), displayCurrency)} ({formatPercent(hPct, { signed: true })})
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-400">—</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>
                        {pos.quantity != null && pos.pru != null
                          ? `${Number(pos.quantity.toFixed(4))} × ${formatDisplayPrice(pos.pru, pos.currency)}`
                          : formatDisplayPrice(pos.invested_amount, pos.currency)}
                        {` · Poids ${pos.weight_pct.toFixed(1).replace(".", ",")} %`}
                      </span>
                      {pos.purchase_date && <span>{formatDateFR(pos.purchase_date)}</span>}
                    </div>

                    <div className="grid grid-cols-4 gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onReinforce(pos)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/70 py-1.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <PlusCircle className="h-3 w-3" />
                        <span>Renf.</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(pos)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Pencil className="h-3 w-3" />
                        <span>Modif.</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSell(pos)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50/70 py-1.5 text-[11px] font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                      >
                        <TrendingDown className="h-3 w-3" />
                        <span>Vendre</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(pos)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50/70 py-1.5 text-[11px] font-semibold text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Suppr.</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table layout */}
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[840px] border-collapse text-xs">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                  <th className="px-4 py-3 text-left font-semibold">Titre</th>
                  <th className="px-3 py-3 text-left font-semibold">Enveloppe</th>
                  <th className="px-3 py-3 text-right font-semibold">Qté / PRU</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Valeur ({displayCurrency === "USD" ? "$" : "€"})
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">{activeHorizonMeta.columnLabel}</th>
                  <th className="px-3 py-3 text-right font-semibold">Poids</th>
                  <th className="px-3 py-3 text-right font-semibold">Note /100</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {positions.map((pos) => {
                  const { eur: hEur, pct: hPct } = getPositionHorizonValues(pos, perfHorizon);
                  const hasPerf = hEur !== null;
                  const pnlPos = (hEur ?? 0) >= 0;
                  const score = isValidNumber(pos.score_global) ? pos.score_global : null;
                  const scoreVariant =
                    score === null ? "secondary" : score >= 70 ? "emerald" : score >= 45 ? "amber" : "coral";

                  return (
                    <tr key={pos.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/stock/${encodeURIComponent(pos.ticker)}`}
                          className="group flex flex-col"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                              {pos.ticker}
                            </span>
                            {pos.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                          </div>
                          <span className="max-w-[200px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {pos.name}
                          </span>
                        </Link>
                      </td>

                      <td className="px-3 py-3">
                        <Badge variant={pos.envelope === "PEA" ? "emerald" : "outline"}>
                          {pos.envelope}
                        </Badge>
                      </td>

                      <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                        {pos.quantity != null && pos.pru != null ? (
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {Number(pos.quantity.toFixed(4))} × {formatDisplayPrice(pos.pru, pos.currency)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Cours : {formatDisplayPrice(pos.current_price, pos.asset_currency)}
                              {pos.purchase_date ? ` · Achat ${formatDateFR(pos.purchase_date)}` : ""}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {formatDisplayPrice(pos.invested_amount, pos.currency)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Montant fixe{pos.purchase_date ? ` · ${formatDateFR(pos.purchase_date)}` : ""}
                            </div>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900 dark:text-white">
                        {formatPrice(convEur(pos.current_value_eur), displayCurrency)}
                      </td>

                      <td className="px-3 py-3 text-right tabular-nums">
                        {hasPerf ? (
                          <>
                            <div
                              className={cn(
                                "font-semibold",
                                pnlPos
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {hEur > 0 ? "+" : ""}
                              {formatPrice(convEur(hEur), displayCurrency)}
                            </div>
                            <div
                              className={cn(
                                "text-[11px]",
                                pnlPos
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {formatPercent(hPct, { signed: true })}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                        {pos.weight_pct.toFixed(1).replace(".", ",")} %
                      </td>

                      <td className="px-3 py-3 text-right tabular-nums">
                        <Badge variant={scoreVariant}>
                          {score !== null ? `${Math.round(score)}/100` : "—"}
                        </Badge>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onReinforce(pos)}
                            title="Renforcer (ajouter un achat à une date précise)"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/50 cursor-pointer"
                          >
                            <PlusCircle className="h-3 w-3" />
                            <span>Renforcer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onEdit(pos)}
                            title="Modifier la position"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                            <span>Modifier</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSell(pos)}
                            title="Vendre tout ou partie de la position"
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/50 cursor-pointer"
                          >
                            <TrendingDown className="h-3 w-3" />
                            <span>Vendre</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(pos)}
                            title="Supprimer (erreur de saisie)"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
