"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { NewsAndEarningsCard } from "@/components/stock/NewsAndEarningsCard";
import { PriceChartCard } from "@/components/stock/PriceChartCard";
import { ScoreHistoryCard } from "@/components/stock/ScoreHistoryCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMultiple, formatPercent } from "@/lib/formatters";
import type {
  PriceHistoryResponse,
  ScoreHistoryResponse,
  ScoresBundle,
  StockInfoResponse,
  StockNewsResponse,
  SurprisesResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface OverviewTabProps {
  info: StockInfoResponse;
  scores: ScoresBundle;
  prices: PriceHistoryResponse | null;
  fairValue?: number | null;
  scoreHistory?: ScoreHistoryResponse | null;
  surprises?: SurprisesResponse | null;
  news?: StockNewsResponse | null;
}

interface KpiItem {
  label: string;
  value: string;
  tooltip: string;
}

export function OverviewTab({
  info,
  scores,
  prices,
  fairValue,
  scoreHistory,
  surprises,
  news,
}: OverviewTabProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const m = scores.metrics || {};
  const isEtf = info.asset_type === "ETF";

  const columns: { title: string; items: KpiItem[] }[] = [
    {
      title: "Valorisation",
      items: [
        {
          label: "Cours / Bénéfice (PER)",
          value: formatMultiple(m.pe ?? info.pe),
          tooltip: "Prix de l'action divisé par le bénéfice par action des 12 derniers mois.",
        },
        {
          label: "PER prévisionnel",
          value: formatMultiple(m.forward_pe ?? info.forward_pe),
          tooltip: "Prix actuel divisé par les bénéfices attendus par les analystes sur les 12 prochains mois.",
        },
        {
          label: "Cours / Cash libre (P/FCF)",
          value: formatMultiple(m.p_fcf),
          tooltip: "Capitalisation divisée par le cash libre généré après investissements.",
        },
        {
          label: "Valeur d'entreprise / EBITDA",
          value: formatMultiple(m.ev_ebitda ?? info.ev_to_ebitda),
          tooltip: "Valeur totale de l'entreprise (dette incluse, cash déduit) rapportée à l'excédent brut d'exploitation.",
        },
        {
          label: "Ratio PEG",
          value: formatMultiple(m.peg ?? info.peg, 2),
          tooltip: "PER rapporté à la croissance attendue des bénéfices (proche ou sous 1,0 = attractif).",
        },
      ],
    },
    {
      title: "Croissance",
      items: [
        {
          label: "Croissance Chiffre d'affaires (1A)",
          value: formatPercent(m.rev_growth_1y, { isDecimal: true, signed: true }),
          tooltip: "Progression du chiffre d'affaires sur le dernier exercice annuel.",
        },
        {
          label: "Croissance Chiffre d'affaires (3A)",
          value: formatPercent(m.rev_growth_3y, { isDecimal: true, signed: true }),
          tooltip: "Taux de croissance annuel composé (CAGR) du chiffre d'affaires sur 3 ans.",
        },
        {
          label: "Croissance Bénéfices (1A)",
          value: formatPercent(m.eps_growth_1y, { isDecimal: true, signed: true }),
          tooltip: "Progression du bénéfice par action sur le dernier exercice.",
        },
      ],
    },
    {
      title: "Rentabilité",
      items: [
        {
          label: "Marge brute",
          value: formatPercent(m.gross_margin ?? info.gross_margin, { isDecimal: true }),
          tooltip: "Part du chiffre d'affaires conservée après coûts directs de production.",
        },
        {
          label: "Marge opérationnelle",
          value: formatPercent(m.op_margin ?? info.op_margin, { isDecimal: true }),
          tooltip: "Part du chiffre d'affaires transformée en résultat d'exploitation.",
        },
        {
          label: "Marge nette",
          value: formatPercent(m.net_margin ?? info.net_margin, { isDecimal: true }),
          tooltip: "Part du chiffre d'affaires restante en bénéfice net final.",
        },
        {
          label: "Rentabilité fonds propres (ROE)",
          value: formatPercent(m.roe ?? info.roe, { isDecimal: true }),
          tooltip: "Bénéfice net rapporté aux capitaux propres des actionnaires.",
        },
        {
          label: "Rentabilité du capital (ROIC)",
          value: formatPercent(m.roic, { isDecimal: true }),
          tooltip: "Efficacité du capital total investi (fonds propres + dette nette) à générer du profit.",
        },
      ],
    },
    {
      title: "Santé & Dividende",
      items: [
        {
          label: "Dette nette / EBITDA",
          value: formatMultiple(m.net_debt_ebitda),
          tooltip: "Nombre d'années d'EBITDA nécessaires pour rembourser la dette nette (négatif = trésorerie nette positive).",
        },
        {
          label: "Dette / Fonds propres",
          value: formatMultiple(m.debt_to_equity, 2),
          tooltip: "Ratio d'endettement rapporté aux capitaux propres.",
        },
        {
          label: "Liquidité court terme",
          value: formatMultiple(m.current_ratio, 2),
          tooltip: "Actifs courants divisés par dettes à court terme (> 1,5x = confortable).",
        },
        {
          label: "Rendement du dividende",
          value: formatPercent(info.dividend_yield, {
            isDecimal: (info.dividend_yield ?? 0) < 0.25,
            decimals: 2,
          }),
          tooltip: "Dividende annuel versé rapporté au cours actuel de l'action.",
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {info.description && (
        <Card>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  À propos de {info.name}
                </p>
                <p
                  className={cn(
                    "text-xs leading-relaxed text-slate-600 dark:text-slate-300",
                    !descExpanded && "line-clamp-3"
                  )}
                >
                  {info.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50 cursor-pointer"
              >
                <span>{descExpanded ? "Réduire" : "Voir plus"}</span>
                {descExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isEtf && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Indicateurs clés en un coup d&apos;œil</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {columns.map((col) => (
                <div key={col.title} className="space-y-2.5">
                  <p className="border-b border-slate-100 pb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    {col.title}
                  </p>
                  <dl className="space-y-2">
                    {col.items.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-2 text-xs">
                        <dt className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                          <span>{item.label}</span>
                          <InfoTooltip text={item.tooltip} />
                        </dt>
                        <dd className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900 dark:text-white">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <PriceChartCard ticker={info.ticker} initialPrices={prices} fairValue={fairValue} />

      <ScoreHistoryCard scoreHistory={scoreHistory ?? null} currency={info.currency} />

      <NewsAndEarningsCard
        ticker={info.ticker}
        surprises={surprises ?? null}
        news={news ?? null}
        currency={info.currency}
        isEtf={isEtf}
      />
    </div>
  );
}
