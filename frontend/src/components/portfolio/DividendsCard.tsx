"use client";

import Link from "next/link";
import { Calendar, Coins } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPercent, formatPrice } from "@/lib/formatters";
import type { PortfolioDividendsSummary } from "@/lib/types";

interface DividendsCardProps {
  dividends?: PortfolioDividendsSummary | null;
}

export function DividendsCard({ dividends }: DividendsCardProps) {
  const { displayCurrency, convertAmount } = useDisplayCurrency();
  const convEur = (v: number) => convertAmount(v, "EUR", displayCurrency) ?? v;

  const hasData = Boolean(dividends && dividends.payers_count > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-base">Suivi des Dividendes & Revenu Passif</CardTitle>
            <InfoTooltip text="Estimation annuelle basée sur le dividende versé par chaque titre. Les dividendes sur CTO intègrent par défaut la Flat Tax française (31,4 %), tandis que le PEA capitalise en franchise d'impôt avant retrait." />
          </div>
          {hasData && dividends && (
            <Badge variant="emerald" className="tabular-nums">
              {dividends.payers_count} titre(s) distributeur(s)
            </Badge>
          )}
        </div>
        <CardDescription>
          Rendement sur cours, rendement sur coût d&apos;achat (Yield on Cost) et calendrier des prochains détachements
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!hasData || !dividends ? (
          <p className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
            Aucun dividende détecté sur vos positions actuelles (les ETF capitalisants et valeurs de croissance réinvestissent directement leurs profits).
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Revenu net annuel</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatPrice(convEur(dividends.annual_net_eur), displayCurrency)} / an
                </p>
                <p className="text-[11px] tabular-nums text-slate-400">
                  Brut : {formatPrice(convEur(dividends.annual_gross_eur), displayCurrency)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Moyenne mensuelle nette</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatPrice(convEur(dividends.monthly_net_eur), displayCurrency)} / mois
                </p>
                <p className="text-[11px] text-slate-400">
                  PFU CTO : {dividends.cto_tax_rate_pct.toFixed(1).replace(".", ",")} %
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Rendement portefeuille</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatPercent(dividends.portfolio_yield_pct, { decimals: 2 })}
                </p>
                <p className="text-[11px] text-slate-400">Sur valeur actuelle</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Rendement / PRU (YoC)</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {formatPercent(dividends.yield_on_cost_pct, { decimals: 2 })}
                </p>
                <p className="text-[11px] text-slate-400">Sur capital investi</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
              {dividends.items.map((item) => (
                <div
                  key={item.position_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/stock/${encodeURIComponent(item.ticker)}`}
                      className="font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                    >
                      {item.ticker}
                    </Link>
                    <Badge variant={item.envelope === "PEA" ? "emerald" : "outline"}>
                      {item.envelope}
                    </Badge>
                    <span className="hidden max-w-[200px] truncate text-slate-500 sm:inline dark:text-slate-400">
                      {item.name}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 tabular-nums">
                    <span className="text-slate-500 dark:text-slate-400">
                      Rdt :{" "}
                      <strong className="text-slate-800 dark:text-slate-200">
                        {formatPercent(item.dividend_yield_pct, { decimals: 2 })}
                      </strong>
                      {item.yield_on_cost_pct != null && (
                        <span className="ml-1.5 text-[11px] text-blue-600 dark:text-blue-400">
                          (YoC {formatPercent(item.yield_on_cost_pct, { decimals: 2 })})
                        </span>
                      )}
                    </span>

                    {item.ex_dividend_date && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <Calendar className="h-3 w-3" />
                        Ex-div : {formatDateFR(item.ex_dividend_date)}
                      </span>
                    )}

                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      +{formatPrice(convEur(item.annual_net_eur), displayCurrency)} net/an
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
