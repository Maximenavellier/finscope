"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  Briefcase,
  Calendar,
  Filter,
  Radar,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getOpportunityRadar } from "@/lib/api";
import { formatDateFR, formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { OpportunityRadarResponse, RadarItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const FEATURED_TICKERS = [
  { ticker: "NVDA", name: "NVIDIA Corp.", tag: "US · Semi-conducteurs", pea: false, etf: false },
  { ticker: "ASML.AS", name: "ASML Holding", tag: "Europe · Semi-conducteurs", pea: true, etf: false },
  { ticker: "MC.PA", name: "LVMH", tag: "Europe · Luxe", pea: true, etf: false },
  { ticker: "MSFT", name: "Microsoft Corp.", tag: "US · Logiciels & Cloud", pea: false, etf: false },
  { ticker: "BNP.PA", name: "BNP Paribas", tag: "Europe · Banque", pea: true, etf: false },
  { ticker: "CW8.PA", name: "Amundi MSCI World", tag: "ETF Monde", pea: true, etf: true },
];

type SortField = "attractiveness" | "score" | "fv_gap" | "high_52w" | "earnings" | "ticker";
type RadarFilter = "all" | "buy" | "portfolio" | "watchlist";

function signalBadgeVariant(tone: string): "emerald" | "amber" | "coral" | "secondary" {
  if (tone === "emerald") return "emerald";
  if (tone === "coral") return "coral";
  if (tone === "amber") return "amber";
  return "secondary";
}

export function OpportunityRadarClient() {
  const [radar, setRadar] = useState<OpportunityRadarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<RadarFilter>("all");
  const [sortBy, setSortBy] = useState<SortField>("attractiveness");
  const [sortAsc, setSortAsc] = useState(false);

  const loadRadar = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await getOpportunityRadar(forceRefresh);
      setRadar(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger le Radar.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRadar(false);
  }, [loadRadar]);

  const openSearch = () => {
    window.dispatchEvent(new CustomEvent("finscope:open-search"));
  };

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortBy(field);
      setSortAsc(field === "ticker" || field === "earnings" || field === "fv_gap" || field === "high_52w");
    }
  };

  const filteredItems = useMemo(() => {
    const raw = radar?.items || [];
    const subset = raw.filter((item) => {
      if (filter === "buy") return item.signal === "buy";
      if (filter === "portfolio") return item.in_portfolio;
      if (filter === "watchlist") return item.in_watchlist;
      return true;
    });

    const sorted = [...subset].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      const numCmp = (x: number | null | undefined, y: number | null | undefined) => {
        if (!isValidNumber(x) && !isValidNumber(y)) return 0;
        if (!isValidNumber(x)) return 1;
        if (!isValidNumber(y)) return -1;
        return (x - y) * dir;
      };

      switch (sortBy) {
        case "ticker":
          return a.ticker.localeCompare(b.ticker) * dir;
        case "score":
          return numCmp(a.score_global, b.score_global);
        case "fv_gap":
          return numCmp(a.price_vs_fair_value_pct, b.price_vs_fair_value_pct);
        case "high_52w":
          return numCmp(a.distance_52w_high_pct, b.distance_52w_high_pct);
        case "earnings":
          return numCmp(a.days_until_earnings, b.days_until_earnings);
        default:
          return numCmp(a.attractiveness_score, b.attractiveness_score);
      }
    });
    return sorted;
  }, [radar, filter, sortBy, sortAsc]);

  return (
    <div className="space-y-6">
      {/* Compact Hero + Search + Quick Shortcuts */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
              <Radar className="h-3.5 w-3.5" />
              <span>Radar d&apos;Opportunités · Portefeuille &amp; Watchlist</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
              Quoi acheter, quand, et à quel prix ?
            </h1>
            <p className="max-w-2xl text-xs text-slate-600 dark:text-slate-400 sm:text-sm">
              Classement en temps réel de vos titres suivis par marge de sécurité, qualité /100, recul vs plus haut 52 semaines et prochaines annonces de résultats.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:w-96">
            <button
              type="button"
              onClick={openSearch}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm text-slate-500 shadow-xs transition-all hover:border-blue-400 hover:bg-white dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300 dark:hover:border-blue-500 cursor-pointer"
            >
              <Search className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <span className="flex-1 truncate text-xs sm:text-sm">
                Chercher une action ou ETF...
              </span>
              <kbd className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Ctrl+K
              </kbd>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/portfolio"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Briefcase className="h-3.5 w-3.5 text-blue-600" />
                <span>Assistant DCA</span>
              </Link>
              <Link
                href="/projections"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <span>Simulateur PEA</span>
              </Link>
              <Link
                href="/compare"
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Scale className="h-3.5 w-3.5 text-violet-600" />
                <span>Duel</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {loading && !radar ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex items-center justify-between p-6">
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
            <Button size="sm" onClick={() => loadRadar(false)}>
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : radar && radar.items.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Left: Opportunity Radar Table */}
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span>Opportunités classées ({filteredItems.length})</span>
                  {radar.buy_zone_count > 0 && (
                    <Badge variant="emerald">{radar.buy_zone_count} en zone d&apos;achat</Badge>
                  )}
                </CardTitle>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cliquez sur les en-têtes pour trier par note, décote vs prix juste ou solde 52 semaines.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                  {(
                    [
                      { id: "all", label: "Tous" },
                      { id: "buy", label: "Zone d'achat" },
                      { id: "portfolio", label: "Portefeuille" },
                      { id: "watchlist", label: "Watchlist" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                        filter === f.id
                          ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={refreshing}
                  onClick={() => loadRadar(true)}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                  <span className="hidden sm:inline">Actualiser</span>
                </Button>
              </div>
            </CardHeader>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("ticker")}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      >
                        <span>Titre</span>
                        <ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-3">Statut</th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("score")}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      >
                        <span>Note /100</span>
                        <ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("fv_gap")}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      >
                        <span>Écart Prix Juste</span>
                        <ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("high_52w")}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      >
                        <span>vs Haut 52S</span>
                        <ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("earnings")}
                        className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      >
                        <span>Earnings</span>
                        <ArrowDownUp className="h-3 w-3" />
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1">
                        Signal
                        <InfoTooltip text="Zone d'achat : Note ≥ 70 et cours sous le Prix Juste. À surveiller : proche du prix juste. Patienter / Cher : nettement au-dessus du prix juste." />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredItems.map((item: RadarItem) => {
                    const urgentEarnings =
                      item.days_until_earnings !== null &&
                      item.days_until_earnings !== undefined &&
                      item.days_until_earnings <= 10;
                    const fvGap = item.price_vs_fair_value_pct;
                    return (
                      <tr
                        key={item.ticker}
                        className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/stock/${encodeURIComponent(item.ticker)}`}
                            className="flex items-center gap-2.5 group"
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                              {item.logo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.logo_url}
                                  alt={item.name}
                                  className="h-6 w-6 object-contain"
                                />
                              ) : (
                                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                  {item.ticker.slice(0, 4)}
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
                                  {item.ticker}
                                </span>
                                {item.red_flags_count > 0 && (
                                  <span
                                    title={`${item.red_flags_count} Red Flag(s) détecté(s)`}
                                    className="inline-flex items-center text-rose-500"
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </span>
                                )}
                              </div>
                              <p className="max-w-[150px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                                {item.name}
                              </p>
                            </div>
                          </Link>
                        </td>

                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {item.in_portfolio && <Badge variant="default">Portefeuille</Badge>}
                            {item.in_watchlist && <Badge variant="secondary">Watchlist</Badge>}
                          </div>
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {isValidNumber(item.score_global) ? (
                            <span
                              className={cn(
                                "font-bold",
                                item.score_global >= 70
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : item.score_global >= 50
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {item.score_global.toFixed(0)}/100
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {item.asset_type === "ETF" ? (
                            <span className="text-slate-400">N/A</span>
                          ) : isValidNumber(fvGap) ? (
                            <div>
                              <span
                                className={cn(
                                  "font-bold",
                                  fvGap <= -10
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : fvGap <= 10
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-rose-600 dark:text-rose-400"
                                )}
                              >
                                {formatPercent(fvGap, { signed: true, decimals: 1 })}
                              </span>
                              {isValidNumber(item.fair_value) && (
                                <p className="text-[10px] text-slate-400">
                                  FV {formatPrice(item.fair_value, item.currency)}
                                </p>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="px-3 py-3 text-right tabular-nums">
                          {isValidNumber(item.distance_52w_high_pct) ? (
                            <span
                              className={cn(
                                "font-semibold",
                                item.distance_52w_high_pct <= -15
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-slate-600 dark:text-slate-300"
                              )}
                            >
                              {formatPercent(item.distance_52w_high_pct, { signed: true, decimals: 1 })}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>

                        <td className="px-3 py-3">
                          {item.next_earnings_date ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                                urgentEarnings
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                  : "text-slate-600 dark:text-slate-300"
                              )}
                            >
                              <Calendar className="h-3 w-3 shrink-0" />
                              <span>{formatDateFR(item.next_earnings_date)}</span>
                              {isValidNumber(item.days_until_earnings) && (
                                <span className="text-[10px] opacity-80">
                                  ({item.days_until_earnings}j)
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <Badge variant={signalBadgeVariant(item.signal_tone)}>
                            {item.signal_label}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Aucun titre ne correspond à ce filtre.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Right: Chronological Upcoming Earnings Widget */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span>Prochains résultats à venir</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {radar.upcoming_earnings.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aucune date de résultats confirmée à venir pour vos actions suivies.
                  </p>
                ) : (
                  radar.upcoming_earnings.slice(0, 8).map((ev) => {
                    const urgent = ev.days_until_earnings <= 10;
                    return (
                      <Link
                        key={`${ev.ticker}-${ev.next_earnings_date}`}
                        href={`/stock/${encodeURIComponent(ev.ticker)}`}
                        className={cn(
                          "flex items-center justify-between rounded-xl border p-2.5 transition-colors hover:border-blue-300 dark:hover:border-blue-700",
                          urgent
                            ? "border-amber-200 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/30"
                            : "border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/40"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {ev.ticker}
                            </span>
                            {urgent && <Badge variant="amber">J-{ev.days_until_earnings}</Badge>}
                          </div>
                          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {ev.name}
                          </p>
                        </div>
                        <div className="text-right shrink-0 pl-2">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {formatDateFR(ev.next_earnings_date)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {ev.days_until_earnings === 0
                              ? "Aujourd'hui"
                              : `Dans ${ev.days_until_earnings} j`}
                          </p>
                        </div>
                      </Link>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2.5 p-4 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>Explorer de nouvelles idées</span>
                </div>
                <p>
                  Utilisez le Screener pour repérer des actions US et PEA notées ≥ 75/100 avant de les ajouter à votre Watchlist.
                </p>
                <Link
                  href="/screener"
                  className="inline-flex items-center gap-1.5 font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span>Ouvrir le Screener</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Votre portefeuille &amp; watchlist sont vides — démarrez avec une fiche
            </h2>
            <Link href="/portfolio" className="text-xs font-semibold text-blue-600 hover:underline">
              Ajouter des positions →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURED_TICKERS.map((item) => (
              <Link key={item.ticker} href={`/stock/${encodeURIComponent(item.ticker)}`}>
                <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:hover:border-blue-700">
                  <CardContent className="flex items-center justify-between p-5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{item.ticker}</span>
                        {item.pea && <Badge variant="emerald">PEA</Badge>}
                        {item.etf && <Badge variant="secondary">ETF</Badge>}
                      </div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{item.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.tag}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
