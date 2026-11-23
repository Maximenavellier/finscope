"use client";

import { ExternalLink, Newspaper, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { StockNewsResponse, SurprisesResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NewsAndEarningsCardProps {
  ticker: string;
  surprises: SurprisesResponse | null;
  news: StockNewsResponse | null;
  currency?: string | null;
  isEtf?: boolean;
}

export function NewsAndEarningsCard({
  ticker,
  surprises,
  news,
  currency,
  isEtf = false,
}: NewsAndEarningsCardProps) {
  const recentQuarters = (surprises?.eps || []).slice(-4).reverse();
  const newsItems = (news?.items || []).slice(0, 5);

  return (
    <div className={cn("grid grid-cols-1 gap-6", !isEtf && "lg:grid-cols-2")}>
      {!isEtf && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <CardTitle className="text-base">4 derniers résultats (Earnings BPA)</CardTitle>
              </div>
              {recentQuarters.length > 0 && (
                <Badge variant="secondary">{recentQuarters.length} trimestres</Badge>
              )}
            </div>
            <CardDescription>
              Comparaison entre le bénéfice par action publié et le consensus attendu
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {recentQuarters.length === 0 ? (
              <p className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                Aucun historique trimestriel BPA disponible pour {ticker}.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
                {recentQuarters.map((q) => {
                  const surp = isValidNumber(q.surprise_pct) ? q.surprise_pct : null;
                  const beat = surp !== null ? surp >= 0 : null;
                  return (
                    <div
                      key={`${q.period}-${q.date}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{q.period}</p>
                        <p className="text-[11px] text-slate-400">{formatDateFR(q.date)}</p>
                      </div>

                      <div className="flex items-center gap-3 tabular-nums">
                        <div className="text-right">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            Réel : {formatPrice(q.actual, currency)}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            Attendu : {formatPrice(q.estimated, currency)}
                          </p>
                        </div>

                        {surp !== null ? (
                          <Badge
                            variant={beat ? "emerald" : "coral"}
                            className="inline-flex items-center gap-1 tabular-nums"
                          >
                            {beat ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            <span>
                              {beat ? "Battu" : "Manqué"} ({formatPercent(surp, { signed: true })})
                            </span>
                          </Badge>
                        ) : (
                          <Badge variant="secondary">—</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <CardTitle className="text-base">Actualités financières récentes</CardTitle>
            </div>
            {newsItems.length > 0 && <Badge variant="secondary">{newsItems.length} articles</Badge>}
          </div>
          <CardDescription>
            Dernières dépêches et articles de marché concernant {ticker}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {newsItems.length === 0 ? (
            <p className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
              Aucune actualité récente disponible pour le moment.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
              {newsItems.map((item, idx) => {
                const pubDate = item.published_at ? formatDateFR(item.published_at.slice(0, 10)) : null;
                return (
                  <a
                    key={`${item.title}-${idx}`}
                    href={item.url || "#"}
                    target={item.url ? "_blank" : undefined}
                    rel={item.url ? "noopener noreferrer" : undefined}
                    className="group block space-y-1 px-3.5 py-2.5 text-xs transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-slate-900 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                        {item.title}
                      </p>
                      {item.url && (
                        <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-blue-600" />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      {item.publisher && (
                        <span className="font-medium text-slate-500 dark:text-slate-300">
                          {item.publisher}
                        </span>
                      )}
                      {pubDate && <span>· {pubDate}</span>}
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
