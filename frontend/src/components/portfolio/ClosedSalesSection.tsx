"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History, Trash2 } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPercent, formatPrice } from "@/lib/formatters";
import type { PortfolioSaleItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ClosedSalesSectionProps {
  sales: PortfolioSaleItem[];
  totalRealizedPnlEur: number;
  onDeleteSale: (sale: PortfolioSaleItem) => void;
}

export function ClosedSalesSection({
  sales,
  totalRealizedPnlEur,
  onDeleteSale,
}: ClosedSalesSectionProps) {
  const [expanded, setExpanded] = useState(sales.length > 0 && sales.length <= 5);
  const { displayCurrency, convertAmount } = useDisplayCurrency();
  const convEur = (v: number) => convertAmount(v, "EUR", displayCurrency) ?? v;

  const totalPositive = totalRealizedPnlEur >= 0;

  return (
    <Card>
      <CardHeader
        className="flex flex-row items-center justify-between gap-3 py-4 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
          <History className="h-4 w-4 text-slate-500" />
          <CardTitle className="text-base">
            Historique des ventes / Positions clôturées ({sales.length})
          </CardTitle>
        </div>

        {sales.length > 0 && (
          <Badge variant={totalPositive ? "emerald" : "coral"} className="tabular-nums font-semibold">
            Plus-value réalisée totale : {totalRealizedPnlEur > 0 ? "+" : ""}
            {formatPrice(convEur(totalRealizedPnlEur), displayCurrency)}
          </Badge>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="p-0">
          {sales.length === 0 ? (
            <div className="border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Aucune vente enregistrée pour le moment. Utilisez le bouton &laquo; Vendre &raquo; sur une ligne du portefeuille.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-xs">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-3 py-3 text-left font-semibold">Titre</th>
                    <th className="px-3 py-3 text-left font-semibold">Type</th>
                    <th className="px-3 py-3 text-right font-semibold">Qté vendue</th>
                    <th className="px-3 py-3 text-right font-semibold">PRU</th>
                    <th className="px-3 py-3 text-right font-semibold">Prix vente</th>
                    <th className="px-3 py-3 text-right font-semibold">Plus-value réalisée</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {sales.map((sale) => {
                    const pnlPos = sale.realized_pnl_eur >= 0;
                    return (
                      <tr key={sale.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                          {formatDateFR(sale.sale_date)}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/stock/${encodeURIComponent(sale.ticker)}`}
                            className="inline-flex items-center gap-1.5 font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                          >
                            <span>{sale.ticker}</span>
                            <Badge variant={sale.envelope === "PEA" ? "emerald" : "outline"}>
                              {sale.envelope}
                            </Badge>
                          </Link>
                          <div className="max-w-[180px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {sale.name}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={sale.is_full_sale ? "secondary" : "amber"}>
                            {sale.is_full_sale ? "Totale" : "Partielle"}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                          {Number(sale.quantity_sold.toFixed(4))}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                          {formatPrice(convEur(sale.pru_eur), displayCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">
                          {formatPrice(convEur(sale.sell_price_eur), displayCurrency)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <div
                            className={cn(
                              "font-semibold",
                              pnlPos
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {sale.realized_pnl_eur > 0 ? "+" : ""}
                            {formatPrice(convEur(sale.realized_pnl_eur), displayCurrency)}
                          </div>
                          {sale.realized_pnl_pct != null && (
                            <div
                              className={cn(
                                "text-[11px]",
                                pnlPos
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {formatPercent(sale.realized_pnl_pct, { signed: true })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => onDeleteSale(sale)}
                            title="Supprimer cette vente"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
