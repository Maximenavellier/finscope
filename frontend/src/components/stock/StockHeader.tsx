"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Briefcase, Calendar, Clock, RefreshCw, Scale, Star } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { PositionModal } from "@/components/portfolio/PositionModal";
import { WatchlistModal } from "@/components/portfolio/WatchlistModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getWatchlist } from "@/lib/api";
import { formatCompactNumber, formatDateFR, formatPercent, formatPrice, formatRelativeTime, isValidNumber } from "@/lib/formatters";
import type { StockInfoResponse, WatchlistItemEnriched } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StockHeaderProps {
  info: StockInfoResponse;
  updatedAt: string;
  isStale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export function StockHeader({
  info,
  updatedAt,
  isStale,
  refreshing,
  onRefresh,
}: StockHeaderProps) {
  const [imgError, setImgError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [posModalOpen, setPosModalOpen] = useState(false);
  const [wlModalOpen, setWlModalOpen] = useState(false);
  const [watchlistItem, setWatchlistItem] = useState<WatchlistItemEnriched | null>(null);
  const { convertAmount, ensureFxRate, registerFxRate, resolveCurrency } = useDisplayCurrency();

  useEffect(() => {
    if (info.currency && isValidNumber(info.fx_to_eur_rate) && info.fx_to_eur_rate > 0) {
      registerFxRate(info.currency, info.fx_to_eur_rate);
    } else if (info.currency) {
      ensureFxRate(info.currency);
    }
  }, [info.currency, info.fx_to_eur_rate, ensureFxRate, registerFxRate]);

  useEffect(() => {
    let cancelled = false;
    getWatchlist(false)
      .then((res) => {
        if (cancelled) return;
        const match = res.items.find((i) => i.ticker === info.ticker) || null;
        setWatchlistItem(match);
      })
      .catch(() => {
        // ignore silent watchlist status failure
      });
    return () => {
      cancelled = true;
    };
  }, [info.ticker]);

  const dayPositive = (info.day_change_pct ?? 0) >= 0;
  const yearPositive = (info.change_1y_pct ?? 0) >= 0;
  const showSizeLabel = info.asset_type === "ETF" ? "Encours (AUM)" : "Capitalisation";
  const showSizeValue = info.asset_type === "ETF" ? info.total_assets : info.market_cap;
  const displayCur = resolveCurrency(info.currency);
  const displayPrice = convertAmount(info.price, info.currency);
  const displaySize = convertAmount(showSizeValue, info.currency);
  const nativeCurRaw = (info.currency || "USD").trim();
  const nativeCurUpper = nativeCurRaw.toUpperCase();
  const isOtherCurrency = nativeCurUpper !== "EUR" && nativeCurUpper !== "USD";
  const isConverted = displayCur !== nativeCurRaw && info.price != null;
  const eurEstimate =
    (isValidNumber(info.price_eur) ? info.price_eur : null) ??
    convertAmount(info.price, info.currency, "EUR");
  const defaultEurPru = eurEstimate ?? info.price;

  const formatEarningsLabel = (): { text: string; urgent: boolean } | null => {
    if (info.asset_type === "ETF" || !info.next_earnings_date) return null;
    const d = info.days_until_earnings;
    if (d === null || d === undefined || d < 0) return null;
    const shortDate = formatDateFR(info.next_earnings_date);
    const dayTxt =
      d === 0 ? "aujourd'hui" : d === 1 ? "demain" : `dans ${d} jours`;
    return {
      text: `Prochains résultats : ${dayTxt} (${shortDate})`,
      urgent: d <= 10,
    };
  };
  const earningsBadge = formatEarningsLabel();

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  return (
    <>
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            {/* Left: Logo + Title + Badges */}
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                {info.logo_url && !imgError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={info.logo_url}
                    alt={info.name}
                    className="h-10 w-10 object-contain"
                    onError={() => setImgError(true)}
                  />
                ) : (
                  <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
                    {info.ticker.slice(0, 4)}
                  </span>
                )}
              </div>

              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                    {info.name}
                  </h1>
                  <Badge variant="default" className="font-semibold">
                    {info.ticker}
                  </Badge>
                  {info.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                  {info.pea_eligible && <Badge variant="emerald">Éligible PEA</Badge>}
                  <Badge variant="outline">{info.region}</Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {info.sector && <span>{info.sector}</span>}
                  {info.sector && info.industry && <span>·</span>}
                  {info.industry && <span>{info.industry}</span>}
                  {info.asset_type === "ETF" && info.category && <span>{info.category}</span>}
                  {info.exchange && (
                    <>
                      <span>·</span>
                      <span>{info.exchange}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {formatRelativeTime(updatedAt)}
                  </span>
                  {isStale && <Badge variant="amber">Cache hors-ligne</Badge>}
                  {earningsBadge && (
                    <Badge
                      variant={earningsBadge.urgent ? "amber" : "outline"}
                      className="inline-flex items-center gap-1 font-medium"
                      title={
                        earningsBadge.urgent
                          ? "Publication imminente (< 10 jours) : attention à la volatilité avant d'acheter"
                          : "Date estimée des prochains résultats trimestriels"
                      }
                    >
                      <Calendar className="h-3 w-3" />
                      <span>{earningsBadge.text}</span>
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Price + Stats + Actions */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-end">
              <div className="flex flex-wrap items-baseline gap-4">
                <div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white sm:text-3xl">
                      {isOtherCurrency
                        ? formatPrice(info.price, info.currency)
                        : formatPrice(displayPrice, displayCur)}
                    </span>
                    {isOtherCurrency && isValidNumber(eurEstimate) && (
                      <Badge
                        variant="outline"
                        className="tabular-nums font-semibold text-blue-700 border-blue-200 bg-blue-50/70 dark:text-blue-300 dark:border-blue-800 dark:bg-blue-950/50"
                        title={
                          isValidNumber(info.fx_to_eur_rate)
                            ? `Taux de change estimé : 1 ${nativeCurRaw} = ${info.fx_to_eur_rate.toFixed(4).replace(".", ",")} €`
                            : "Estimation convertie en EUR"
                        }
                      >
                        ≈ {formatPrice(eurEstimate, "EUR")}
                      </Badge>
                    )}
                    {!isOtherCurrency && isConverted && (
                      <span className="text-xs font-medium tabular-nums text-slate-400 dark:text-slate-500">
                        ({formatPrice(info.price, info.currency)})
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-medium tabular-nums">
                    {info.day_change_pct !== null && info.day_change_pct !== undefined && (
                      <span className={dayPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                        Jour : {formatPercent(info.day_change_pct, { signed: true, decimals: 2 })}
                      </span>
                    )}
                    {info.change_1y_pct !== null && info.change_1y_pct !== undefined && (
                      <span className={yearPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                        1A : {formatPercent(info.change_1y_pct, { signed: true, decimals: 1 })}
                      </span>
                    )}
                    {displaySize ? (
                      <span className="text-slate-500 dark:text-slate-400">
                        {showSizeLabel} :{" "}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {formatCompactNumber(displaySize, displayCur)}
                        </strong>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={refreshing}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                  <span>{refreshing ? "Actualisation..." : "Rafraîchir"}</span>
                </Button>
                <Link
                  href={`/compare?a=${encodeURIComponent(info.ticker)}`}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Comparer avec une autre action ou ETF"
                >
                  <Scale className="h-3.5 w-3.5" />
                  <span>Comparer</span>
                </Link>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setPosModalOpen(true)}
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  <span>+ Portefeuille</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setWlModalOpen(true)}
                  className={cn(
                    watchlistItem &&
                      "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", watchlistItem && "fill-amber-500 text-amber-500")} />
                  <span>{watchlistItem ? "Dans la Watchlist" : "Watchlist"}</span>
                </Button>
              </div>
            </div>
          </div>

          {notice && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
              <span>{notice}</span>
              <Link href="/portfolio" className="underline hover:opacity-80">
                Voir mon portefeuille →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      <PositionModal
        open={posModalOpen}
        onOpenChange={setPosModalOpen}
        defaultTicker={info.ticker}
        defaultAssetType={info.asset_type === "ETF" ? "ETF" : "EQUITY"}
        defaultEnvelope={info.pea_eligible ? "PEA" : "CTO"}
        defaultCurrency="EUR"
        defaultPru={defaultEurPru ?? info.price}
        onSaved={() => showNotice(`${info.ticker} ajouté au portefeuille avec succès !`)}
      />

      <WatchlistModal
        open={wlModalOpen}
        onOpenChange={setWlModalOpen}
        initialItem={watchlistItem}
        defaultTicker={info.ticker}
        defaultCurrency={info.currency === "EUR" ? "EUR" : "USD"}
        defaultPrice={info.price}
        onSaved={(saved) => {
          setWatchlistItem(saved);
          showNotice(`${info.ticker} enregistré dans votre watchlist !`);
        }}
        onRemoved={() => {
          setWatchlistItem(null);
          showNotice(`${info.ticker} retiré de la watchlist.`);
        }}
      />
    </>
  );
}
