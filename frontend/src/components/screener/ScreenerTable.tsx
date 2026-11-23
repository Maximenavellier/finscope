"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatMultiple, formatPercent, isValidNumber } from "@/lib/formatters";
import type { ScreenerItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ScreenerTableProps {
  items: ScreenerItem[];
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
}

function ScoreBadge({ val }: { val?: number | null }) {
  if (!isValidNumber(val)) return <span className="text-slate-400">—</span>;
  const variant = val >= 70 ? "emerald" : val >= 45 ? "amber" : "coral";
  return <Badge variant={variant}>{Math.round(val)}</Badge>;
}

export function ScreenerTable({ items, sortBy, sortDir, onSort }: ScreenerTableProps) {
  const { formatDisplayPrice } = useDisplayCurrency();
  const SortHeader = ({
    col,
    label,
    align = "right",
  }: {
    col: string;
    label: string;
    align?: "left" | "right";
  }) => {
    const active = sortBy === col;
    return (
      <th className={cn("px-3 py-3 font-semibold", align === "left" ? "text-left" : "text-right")}>
        <button
          type="button"
          onClick={() => onSort(col)}
          className={cn(
            "inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer",
            active && "text-blue-600 dark:text-blue-400"
          )}
        >
          <span>{label}</span>
          {active ? (
            sortDir === "asc" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
      </th>
    );
  };

  return (
    <Card>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Aucun titre ne correspond à vos filtres actuels. Essayez d&apos;élargir les seuils ou d&apos;enrichir l&apos;univers ci-dessus.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                  <SortHeader col="ticker" label="Titre" align="left" />
                  <th className="px-3 py-3 text-right font-semibold">Prix</th>
                  <SortHeader col="score_global" label="Globale" />
                  <SortHeader col="score_valuation" label="Valo" />
                  <SortHeader col="score_growth" label="Croiss." />
                  <SortHeader col="score_quality" label="Qualité" />
                  <SortHeader col="score_health" label="Santé" />
                  <SortHeader col="pe" label="PER" />
                  <SortHeader col="forward_pe" label="PER prév." />
                  <SortHeader col="rev_growth_1y" label="CA 1A" />
                  <SortHeader col="net_margin" label="Marge nette" />
                  <SortHeader col="net_debt_ebitda" label="Dette/EBITDA" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {items.map((item) => (
                  <tr key={item.ticker} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/stock/${encodeURIComponent(item.ticker)}`}
                        className="group flex flex-col"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                            {item.ticker}
                          </span>
                          {item.pea_eligible && <Badge variant="emerald">PEA</Badge>}
                          {item.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                          <Badge variant="outline">{item.region}</Badge>
                        </div>
                        <span className="max-w-[210px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {item.name}
                          {item.sector ? ` · ${item.sector}` : ""}
                        </span>
                      </Link>
                    </td>

                    <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                      {item.price != null ? (
                        formatDisplayPrice(item.price, item.currency)
                      ) : (
                        <Link
                          href={`/stock/${encodeURIComponent(item.ticker)}`}
                          className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Analyser →
                        </Link>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right tabular-nums">
                      <ScoreBadge val={item.score_global} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <ScoreBadge val={item.score_valuation} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <ScoreBadge val={item.score_growth} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <ScoreBadge val={item.score_quality} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <ScoreBadge val={item.score_health} />
                    </td>

                    <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {formatMultiple(item.pe)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {formatMultiple(item.forward_pe)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span
                        className={cn(
                          isValidNumber(item.rev_growth_1y) &&
                            (item.rev_growth_1y >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400")
                        )}
                      >
                        {formatPercent(item.rev_growth_1y, { isDecimal: true, signed: true })}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {formatPercent(item.net_margin, { isDecimal: true })}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {formatMultiple(item.net_debt_ebitda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
