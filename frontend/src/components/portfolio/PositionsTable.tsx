"use client";

import Link from "next/link";
import { Pencil, PlusCircle, TrendingDown, Trash2 } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { PortfolioPositionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  const convEur = (v: number) => convertAmount(v, "EUR", displayCurrency) ?? v;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lignes en Portefeuille ({positions.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {positions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            Aucune position enregistrée. Ajoutez une première action ou un ETF pour démarrer votre suivi.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] border-collapse text-xs">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                  <th className="px-4 py-3 text-left font-semibold">Titre</th>
                  <th className="px-3 py-3 text-left font-semibold">Enveloppe</th>
                  <th className="px-3 py-3 text-right font-semibold">Qté / PRU</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    Valeur ({displayCurrency === "USD" ? "$" : "€"})
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">+/- Value</th>
                  <th className="px-3 py-3 text-right font-semibold">Poids</th>
                  <th className="px-3 py-3 text-right font-semibold">Note /100</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {positions.map((pos) => {
                  const pnlPos = pos.pnl_eur >= 0;
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
                        <div
                          className={cn(
                            "font-semibold",
                            pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                          )}
                        >
                          {pos.pnl_eur > 0 ? "+" : ""}
                          {formatPrice(convEur(pos.pnl_eur), displayCurrency)}
                        </div>
                        <div
                          className={cn(
                            "text-[11px]",
                            pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                          )}
                        >
                          {formatPercent(pos.pnl_pct, { signed: true })}
                        </div>
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
        )}
      </CardContent>
    </Card>
  );
}
