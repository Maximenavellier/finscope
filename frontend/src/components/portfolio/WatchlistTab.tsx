"use client";

import Link from "next/link";
import { BellRing, Pencil, Plus, Trash2 } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { WatchlistItemEnriched, WatchlistResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WatchlistTabProps {
  watchlist: WatchlistResponse | null;
  onAdd: () => void;
  onEdit: (item: WatchlistItemEnriched) => void;
  onDelete: (item: WatchlistItemEnriched) => void;
}

export function WatchlistTab({ watchlist, onAdd, onEdit, onDelete }: WatchlistTabProps) {
  const items = watchlist?.items || [];
  const alertsCount = watchlist?.alerts_count || 0;
  const { formatDisplayPrice } = useDisplayCurrency();

  return (
    <div className="space-y-4">
      {alertsCount > 0 && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <BellRing className="h-4 w-4 shrink-0" />
          <span>
            {alertsCount} titre(s) de votre watchlist sont passés sous votre prix cible !
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Titres surveillés ({items.length})</CardTitle>
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            <span>Ajouter un titre</span>
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Votre watchlist est vide. Ajoutez une action ou un ETF avec un prix cible pour recevoir une alerte visuelle.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                    <th className="px-4 py-3 text-left font-semibold">Titre</th>
                    <th className="px-3 py-3 text-right font-semibold">Prix actuel</th>
                    <th className="px-3 py-3 text-right font-semibold">Note Globale</th>
                    <th className="px-3 py-3 text-right font-semibold">Valorisation</th>
                    <th className="px-3 py-3 text-right font-semibold">Prix cible</th>
                    <th className="px-3 py-3 text-right font-semibold">Écart / Alerte</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {items.map((item) => {
                    const gScore = isValidNumber(item.score_global) ? item.score_global : null;
                    const vScore = isValidNumber(item.score_valuation) ? item.score_valuation : null;
                    const gVariant =
                      gScore === null ? "secondary" : gScore >= 70 ? "emerald" : gScore >= 45 ? "amber" : "coral";
                    const vVariant =
                      vScore === null ? "secondary" : vScore >= 70 ? "emerald" : vScore >= 45 ? "amber" : "coral";

                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          "hover:bg-slate-50/70 dark:hover:bg-slate-800/40",
                          item.alert_triggered && "bg-emerald-50/40 dark:bg-emerald-950/20"
                        )}
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/stock/${encodeURIComponent(item.ticker)}`}
                            className="group flex flex-col"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                                {item.ticker}
                              </span>
                              {item.pea_eligible && <Badge variant="emerald">PEA</Badge>}
                              {item.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                            </div>
                            <span className="max-w-[200px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {item.name}
                            </span>
                          </Link>
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {formatDisplayPrice(item.current_price, item.currency)}
                          </div>
                          {isValidNumber(item.day_change_pct) && (
                            <div
                              className={cn(
                                "text-[11px]",
                                item.day_change_pct >= 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {formatPercent(item.day_change_pct, { signed: true, decimals: 2 })}
                            </div>
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          <Badge variant={gVariant}>
                            {gScore !== null ? `${Math.round(gScore)}/100` : "—"}
                          </Badge>
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          <Badge variant={vVariant}>
                            {vScore !== null ? `${Math.round(vScore)}/100` : "—"}
                          </Badge>
                        </td>

                        <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                          {item.target_price != null
                            ? formatDisplayPrice(item.target_price, item.target_currency || item.currency)
                            : "—"}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {item.alert_triggered ? (
                            <Badge variant="emerald" className="font-semibold">
                              Sous cible ({formatPercent(item.distance_to_target_pct, { signed: true })})
                            </Badge>
                          ) : item.distance_to_target_pct != null ? (
                            <span className="text-slate-500 dark:text-slate-400">
                              {formatPercent(item.distance_to_target_pct, { signed: true })}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEdit(item)}
                              title="Modifier cible"
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(item)}
                              title="Retirer"
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 cursor-pointer"
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
    </div>
  );
}
