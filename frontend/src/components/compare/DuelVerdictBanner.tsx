"use client";

import { useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatPercent, isValidNumber } from "@/lib/formatters";
import type { StockOverviewResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

const PILLARS = [
  { key: "valuation" as const, label: "Valorisation", prose: "la valorisation" },
  { key: "growth" as const, label: "Croissance", prose: "la croissance" },
  { key: "quality" as const, label: "Qualité", prose: "la qualité" },
  { key: "health" as const, label: "Santé", prose: "la santé financière" },
];

function formatJoinFr(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} et ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

function DuelSideCard({
  overview,
  accent,
  slotName,
}: {
  overview: StockOverviewResponse;
  accent: "blue" | "violet";
  slotName: string;
}) {
  const [imgErr, setImgErr] = useState(false);
  const { formatDisplayPrice } = useDisplayCurrency();
  const { info, scores, fair_value } = overview;

  const globalScore = isValidNumber(scores.global.score) ? scores.global.score : null;
  const globalTone =
    globalScore === null
      ? "secondary"
      : globalScore >= 70
      ? "emerald"
      : globalScore >= 45
      ? "amber"
      : "coral";
  const badgeTone =
    scores.summary_tone === "emerald"
      ? "emerald"
      : scores.summary_tone === "coral"
      ? "coral"
      : "amber";

  const borderTop =
    accent === "blue" ? "border-t-4 border-t-blue-600" : "border-t-4 border-t-violet-600";
  const slotBadge =
    accent === "blue"
      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800"
      : "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800";

  return (
    <Card className={cn("overflow-hidden", borderTop)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              {info.logo_url && !imgErr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={info.logo_url}
                  alt={info.name}
                  className="h-9 w-9 object-contain"
                  onError={() => setImgErr(true)}
                />
              ) : (
                <span className="text-xs font-bold text-slate-500">
                  {info.ticker.slice(0, 4)}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-bold", slotBadge)}>
                  {slotName}
                </span>
                <Link
                  href={`/stock/${encodeURIComponent(info.ticker)}`}
                  className="truncate text-base font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                >
                  {info.name}
                </Link>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{info.ticker}</span>
                {info.sector && <span>· {info.sector}</span>}
                {info.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                {info.pea_eligible && <Badge variant="emerald">PEA</Badge>}
              </div>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
              {formatDisplayPrice(info.price, info.currency)}
            </div>
            {isValidNumber(info.day_change_pct) && (
              <div
                className={cn(
                  "text-[11px] font-semibold tabular-nums",
                  info.day_change_pct >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              >
                {formatPercent(info.day_change_pct, { signed: true, decimals: 2 })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Badge variant={globalTone} className="font-bold tabular-nums">
            Note : {globalScore !== null ? `${Math.round(globalScore)}/100` : "—"}
          </Badge>
          {scores.summary_badge && <Badge variant={badgeTone}>{scores.summary_badge}</Badge>}
          {fair_value.available && isValidNumber(fair_value.upside_pct) && (
            <Badge variant={fair_value.upside_pct >= 0 ? "emerald" : "coral"} className="tabular-nums">
              Prix Juste : {formatPercent(fair_value.upside_pct, { signed: true })}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function DuelVerdictBanner({
  overviewA,
  overviewB,
}: {
  overviewA: StockOverviewResponse;
  overviewB: StockOverviewResponse;
}) {
  const tkA = overviewA.info.ticker;
  const tkB = overviewB.info.ticker;
  const isEtfDuel =
    overviewA.scores.mode === "ETF" || overviewB.scores.mode === "ETF";

  let winsA = 0;
  let winsB = 0;
  const proseWinsA: string[] = [];
  const proseWinsB: string[] = [];

  const pillarBreakdown = PILLARS.map((p) => {
    const sA = overviewA.scores[p.key]?.score;
    const sB = overviewB.scores[p.key]?.score;
    let winner: "A" | "B" | "tie" | null = null;
    if (isValidNumber(sA) && isValidNumber(sB)) {
      if (Math.abs(sA - sB) < 0.5) {
        winner = "tie";
      } else if (sA > sB) {
        winner = "A";
        winsA += 1;
        proseWinsA.push(p.prose);
      } else {
        winner = "B";
        winsB += 1;
        proseWinsB.push(p.prose);
      }
    }
    return { ...p, sA, sB, winner };
  });

  let summarySentence = "";
  if (isEtfDuel) {
    const gA = overviewA.scores.global.score;
    const gB = overviewB.scores.global.score;
    if (isValidNumber(gA) && isValidNumber(gB)) {
      if (Math.abs(gA - gB) < 1) {
        summarySentence = `Duel très serré entre ${tkA} (${Math.round(gA)}/100) et ${tkB} (${Math.round(gB)}/100) sur le profil ETF.`;
      } else if (gA > gB) {
        summarySentence = `${tkA} prend l'avantage sur la note globale ETF (${Math.round(gA)}/100 contre ${Math.round(gB)}/100 pour ${tkB}).`;
      } else {
        summarySentence = `${tkB} prend l'avantage sur la note globale ETF (${Math.round(gB)}/100 contre ${Math.round(gA)}/100 pour ${tkA}).`;
      }
    } else {
      summarySentence = `Comparaison directe entre ${tkA} et ${tkB}.`;
    }
  } else if (winsA === 0 && winsB === 0) {
    summarySentence = `Égalité parfaite entre ${tkA} et ${tkB} sur l'ensemble des piliers notés.`;
  } else if (winsA > winsB && winsB === 0) {
    summarySentence = `${tkA} l'emporte sur toute la ligne en dominant ${formatJoinFr(proseWinsA)}.`;
  } else if (winsB > winsA && winsA === 0) {
    summarySentence = `${tkB} l'emporte sur toute la ligne en dominant ${formatJoinFr(proseWinsB)}.`;
  } else if (winsA === winsB) {
    summarySentence = `Match nul (${winsA} à ${winsB}) : ${tkA} brille sur ${formatJoinFr(proseWinsA)}, tandis que ${tkB} prend l'avantage sur ${formatJoinFr(proseWinsB)}.`;
  } else if (winsA > winsB) {
    summarySentence = `${tkA} prend l'avantage sur ${formatJoinFr(proseWinsA)}, mais ${tkB} reste devant sur ${formatJoinFr(proseWinsB)}.`;
  } else {
    summarySentence = `${tkB} prend l'avantage sur ${formatJoinFr(proseWinsB)}, mais ${tkA} garde l'atout sur ${formatJoinFr(proseWinsA)}.`;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <DuelSideCard overview={overviewA} accent="blue" slotName="Action A" />
        <DuelSideCard overview={overviewB} accent="violet" slotName="Action B" />
      </div>

      {/* Verdict & Pillar Scoreboard */}
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                <Trophy className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Verdict du Duel
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {summarySentence}
                </p>
              </div>
            </div>

            {!isEtfDuel && (
              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-bold tabular-nums dark:border-slate-700 dark:bg-slate-800/80">
                <span className="text-blue-600 dark:text-blue-400">
                  {tkA} {winsA}
                </span>
                <span className="text-slate-400">—</span>
                <span className="text-violet-600 dark:text-violet-400">
                  {winsB} {tkB}
                </span>
              </div>
            )}
          </div>

          {!isEtfDuel && (
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
              {pillarBreakdown.map((p) => {
                const winnerBadge =
                  p.winner === "A"
                    ? "border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/30"
                    : p.winner === "B"
                    ? "border-violet-200 bg-violet-50/70 dark:border-violet-900/60 dark:bg-violet-950/30"
                    : "border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/50";
                const winText =
                  p.winner === "A"
                    ? `${tkA} gagne`
                    : p.winner === "B"
                    ? `${tkB} gagne`
                    : p.winner === "tie"
                    ? "Égalité"
                    : "—";
                return (
                  <div
                    key={p.key}
                    className={cn("rounded-xl border px-3 py-2 text-xs", winnerBadge)}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {p.label}
                      </span>
                      <span
                        className={cn(
                          "text-[11px] font-bold",
                          p.winner === "A"
                            ? "text-blue-600 dark:text-blue-400"
                            : p.winner === "B"
                            ? "text-violet-600 dark:text-violet-400"
                            : "text-slate-500"
                        )}
                      >
                        {winText}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      <span>
                        {tkA} : <strong className="text-slate-800 dark:text-slate-200">{isValidNumber(p.sA) ? Math.round(p.sA) : "—"}</strong>
                      </span>
                      <span>
                        {tkB} : <strong className="text-slate-800 dark:text-slate-200">{isValidNumber(p.sB) ? Math.round(p.sB) : "—"}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
