"use client";

import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMultiple, formatPercent, isValidNumber } from "@/lib/formatters";
import type { FundamentalsResponse, StockOverviewResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CompareWinnerTableProps {
  overviewA: StockOverviewResponse;
  overviewB: StockOverviewResponse;
  fundamentalsA: FundamentalsResponse | null;
  fundamentalsB: FundamentalsResponse | null;
}

interface TableRowSpec {
  group: "Valorisation" | "Croissance" | "Rentabilité" | "Santé";
  label: string;
  tooltip: string;
  valA: number | null;
  valB: number | null;
  fmtA: string;
  fmtB: string;
  higherIsBetter: boolean;
  positiveOnly?: boolean;
}

function getRawNetCash(fundamentals: FundamentalsResponse | null): number | null {
  const latest =
    fundamentals?.ttm ??
    (fundamentals?.annual && fundamentals.annual.length > 0
      ? fundamentals.annual[fundamentals.annual.length - 1]
      : null);
  if (!latest) return null;
  if (isValidNumber(latest.cash) && isValidNumber(latest.total_debt)) {
    return latest.cash - latest.total_debt;
  }
  return isValidNumber(latest.net_debt) ? -latest.net_debt : null;
}

export function CompareWinnerTable({
  overviewA,
  overviewB,
  fundamentalsA,
  fundamentalsB,
}: CompareWinnerTableProps) {
  const { convertAmount, formatDisplayCompact } = useDisplayCurrency();

  const tkA = overviewA.info.ticker;
  const tkB = overviewB.info.ticker;
  const mA = overviewA.scores.metrics || {};
  const mB = overviewB.scores.metrics || {};

  const numOrNull = (v: number | null | undefined): number | null =>
    isValidNumber(v) ? v : null;

  const peA = numOrNull(mA.pe ?? overviewA.info.pe);
  const peB = numOrNull(mB.pe ?? overviewB.info.pe);
  const fpeA = numOrNull(mA.forward_pe ?? overviewA.info.forward_pe);
  const fpeB = numOrNull(mB.forward_pe ?? overviewB.info.forward_pe);
  const pfcfA = numOrNull(mA.p_fcf);
  const pfcfB = numOrNull(mB.p_fcf);
  const pegA = numOrNull(mA.peg ?? overviewA.info.peg);
  const pegB = numOrNull(mB.peg ?? overviewB.info.peg);
  const upA = overviewA.fair_value.available ? numOrNull(overviewA.fair_value.upside_pct) : null;
  const upB = overviewB.fair_value.available ? numOrNull(overviewB.fair_value.upside_pct) : null;

  const rev1A = numOrNull(mA.rev_growth_1y);
  const rev1B = numOrNull(mB.rev_growth_1y);
  const rev3A = numOrNull(mA.rev_growth_3y);
  const rev3B = numOrNull(mB.rev_growth_3y);
  const eps1A = numOrNull(mA.eps_growth_1y);
  const eps1B = numOrNull(mB.eps_growth_1y);

  const gmA = numOrNull(mA.gross_margin ?? overviewA.info.gross_margin);
  const gmB = numOrNull(mB.gross_margin ?? overviewB.info.gross_margin);
  const omA = numOrNull(mA.op_margin ?? overviewA.info.op_margin);
  const omB = numOrNull(mB.op_margin ?? overviewB.info.op_margin);
  const nmA = numOrNull(mA.net_margin ?? overviewA.info.net_margin);
  const nmB = numOrNull(mB.net_margin ?? overviewB.info.net_margin);
  const roeA = numOrNull(mA.roe ?? overviewA.info.roe);
  const roeB = numOrNull(mB.roe ?? overviewB.info.roe);
  const roicA = numOrNull(mA.roic);
  const roicB = numOrNull(mB.roic);

  const ndA = numOrNull(mA.net_debt_ebitda);
  const ndB = numOrNull(mB.net_debt_ebitda);
  const deA = numOrNull(mA.debt_to_equity);
  const deB = numOrNull(mB.debt_to_equity);
  const rawNetCashA = getRawNetCash(fundamentalsA);
  const rawNetCashB = getRawNetCash(fundamentalsB);
  const netCashA = convertAmount(rawNetCashA, overviewA.info.currency);
  const netCashB = convertAmount(rawNetCashB, overviewB.info.currency);

  const rows: TableRowSpec[] = [
    {
      group: "Valorisation",
      label: "Cours / Bénéfice (PER)",
      tooltip: "Nombre d'années de bénéfices payées au cours actuel (le plus bas gagne).",
      valA: peA,
      valB: peB,
      fmtA: formatMultiple(peA),
      fmtB: formatMultiple(peB),
      higherIsBetter: false,
      positiveOnly: true,
    },
    {
      group: "Valorisation",
      label: "PER prévisionnel",
      tooltip: "PER calculé sur les bénéfices estimés pour les 12 prochains mois (le plus bas gagne).",
      valA: fpeA,
      valB: fpeB,
      fmtA: formatMultiple(fpeA),
      fmtB: formatMultiple(fpeB),
      higherIsBetter: false,
      positiveOnly: true,
    },
    {
      group: "Valorisation",
      label: "Cours / Cash libre (P/FCF)",
      tooltip: "Prix payé rapporté au vrai cash libre généré (le plus bas gagne).",
      valA: pfcfA,
      valB: pfcfB,
      fmtA: formatMultiple(pfcfA),
      fmtB: formatMultiple(pfcfB),
      higherIsBetter: false,
      positiveOnly: true,
    },
    {
      group: "Valorisation",
      label: "Ratio PEG",
      tooltip: "PER rapporté à la croissance attendue des bénéfices (sous 1,0 = attractif, le plus bas gagne).",
      valA: pegA,
      valB: pegB,
      fmtA: formatMultiple(pegA, 2),
      fmtB: formatMultiple(pegB, 2),
      higherIsBetter: false,
      positiveOnly: true,
    },
    {
      group: "Valorisation",
      label: "Potentiel Prix Juste (%)",
      tooltip: "Marge de hausse (+) ou décote par rapport au Prix Juste estimé (le plus élevé gagne).",
      valA: upA,
      valB: upB,
      fmtA: formatPercent(upA, { signed: true }),
      fmtB: formatPercent(upB, { signed: true }),
      higherIsBetter: true,
    },
    {
      group: "Croissance",
      label: "Chiffre d'affaires (1A)",
      tooltip: "Croissance annuelle récente des ventes.",
      valA: rev1A,
      valB: rev1B,
      fmtA: formatPercent(rev1A, { isDecimal: true, signed: true }),
      fmtB: formatPercent(rev1B, { isDecimal: true, signed: true }),
      higherIsBetter: true,
    },
    {
      group: "Croissance",
      label: "Chiffre d'affaires (3A CAGR)",
      tooltip: "Rythme moyen de croissance annuelle des ventes sur 3 ans.",
      valA: rev3A,
      valB: rev3B,
      fmtA: formatPercent(rev3A, { isDecimal: true, signed: true }),
      fmtB: formatPercent(rev3B, { isDecimal: true, signed: true }),
      higherIsBetter: true,
    },
    {
      group: "Croissance",
      label: "Bénéfices / BPA (1A)",
      tooltip: "Progression du bénéfice par action sur la dernière année.",
      valA: eps1A,
      valB: eps1B,
      fmtA: formatPercent(eps1A, { isDecimal: true, signed: true }),
      fmtB: formatPercent(eps1B, { isDecimal: true, signed: true }),
      higherIsBetter: true,
    },
    {
      group: "Rentabilité",
      label: "Marge brute",
      tooltip: "Part du chiffre d'affaires restante après coûts directs.",
      valA: gmA,
      valB: gmB,
      fmtA: formatPercent(gmA, { isDecimal: true }),
      fmtB: formatPercent(gmB, { isDecimal: true }),
      higherIsBetter: true,
    },
    {
      group: "Rentabilité",
      label: "Marge opérationnelle",
      tooltip: "Rentabilité opérationnelle avant impôts et intérêts.",
      valA: omA,
      valB: omB,
      fmtA: formatPercent(omA, { isDecimal: true }),
      fmtB: formatPercent(omB, { isDecimal: true }),
      higherIsBetter: true,
    },
    {
      group: "Rentabilité",
      label: "Marge nette",
      tooltip: "Pourcentage final des ventes conservé en profit net.",
      valA: nmA,
      valB: nmB,
      fmtA: formatPercent(nmA, { isDecimal: true }),
      fmtB: formatPercent(nmB, { isDecimal: true }),
      higherIsBetter: true,
    },
    {
      group: "Rentabilité",
      label: "Rentabilité fonds propres (ROE)",
      tooltip: "Profit net généré rapporté aux capitaux des actionnaires.",
      valA: roeA,
      valB: roeB,
      fmtA: formatPercent(roeA, { isDecimal: true }),
      fmtB: formatPercent(roeB, { isDecimal: true }),
      higherIsBetter: true,
    },
    {
      group: "Rentabilité",
      label: "Rentabilité du capital (ROIC)",
      tooltip: "Rendement global du capital investi (fonds propres + dette nette).",
      valA: roicA,
      valB: roicB,
      fmtA: formatPercent(roicA, { isDecimal: true }),
      fmtB: formatPercent(roicB, { isDecimal: true }),
      higherIsBetter: true,
    },
    {
      group: "Santé",
      label: "Dette nette / EBITDA",
      tooltip: "Années d'EBITDA pour rembourser la dette nette (négatif = plus de cash que de dette ; le plus bas gagne).",
      valA: ndA,
      valB: ndB,
      fmtA: formatMultiple(ndA),
      fmtB: formatMultiple(ndB),
      higherIsBetter: false,
    },
    {
      group: "Santé",
      label: "Dette / Fonds propres",
      tooltip: "Levier financier rapporté aux capitaux propres (le plus bas gagne).",
      valA: deA,
      valB: deB,
      fmtA: formatMultiple(deA, 2),
      fmtB: formatMultiple(deB, 2),
      higherIsBetter: false,
    },
    {
      group: "Santé",
      label: "Trésorerie nette",
      tooltip: "Cash en banque moins dette financière totale (positif = excédent de trésorerie ; le plus élevé gagne).",
      valA: netCashA,
      valB: netCashB,
      fmtA: formatDisplayCompact(rawNetCashA, overviewA.info.currency),
      fmtB: formatDisplayCompact(rawNetCashB, overviewB.info.currency),
      higherIsBetter: true,
    },
  ];

  let rowWinsA = 0;
  let rowWinsB = 0;
  const evaluated = rows.map((row) => {
    let winner: "A" | "B" | null = null;
    const validA = isValidNumber(row.valA) && (!row.positiveOnly || row.valA > 0);
    const validB = isValidNumber(row.valB) && (!row.positiveOnly || row.valB > 0);
    if (validA && validB && row.valA !== row.valB) {
      const aWins = row.higherIsBetter ? row.valA! > row.valB! : row.valA! < row.valB!;
      winner = aWins ? "A" : "B";
      if (winner === "A") rowWinsA += 1;
      else rowWinsB += 1;
    }
    return { ...row, winner };
  });

  const groups: ("Valorisation" | "Croissance" | "Rentabilité" | "Santé")[] = [
    "Valorisation",
    "Croissance",
    "Rentabilité",
    "Santé",
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <CardTitle>Tableau Comparatif &laquo; Gagnant par Ligne &raquo;</CardTitle>
          <InfoTooltip text="La cellule gagnante de chaque ligne est surlignée en vert (le plus bas gagne pour les multiples de prix et la dette ; le plus élevé gagne pour la croissance, la rentabilité et la trésorerie nette)." />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="default">
            {tkA} : {rowWinsA} point(s)
          </Badge>
          <Badge variant="outline">
            {tkB} : {rowWinsB} point(s)
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-xs">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/40">
                <th className="w-[30%] px-4 py-3 text-right font-bold text-blue-600 dark:text-blue-400">
                  {tkA}
                </th>
                <th className="w-[40%] px-4 py-3 text-center font-semibold text-slate-500 dark:text-slate-400">
                  Indicateur
                </th>
                <th className="w-[30%] px-4 py-3 text-left font-bold text-violet-600 dark:text-violet-400">
                  {tkB}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {groups.map((grp) => (
                <FragmentGroup
                  key={grp}
                  groupName={grp}
                  rows={evaluated.filter((r) => r.group === grp)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentGroup({
  groupName,
  rows,
}: {
  groupName: string;
  rows: (TableRowSpec & { winner: "A" | "B" | null })[];
}) {
  return (
    <>
      <tr className="bg-slate-50/60 dark:bg-slate-900/60">
        <td
          colSpan={3}
          className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
        >
          {groupName}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.label} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
          <td
            className={cn(
              "px-4 py-2.5 text-right tabular-nums transition-colors",
              r.winner === "A"
                ? "bg-emerald-50/90 font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "font-medium text-slate-800 dark:text-slate-200"
            )}
          >
            {r.fmtA}
          </td>
          <td className="px-4 py-2.5 text-center text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center justify-center gap-1">
              <span>{r.label}</span>
              <InfoTooltip text={r.tooltip} />
            </span>
          </td>
          <td
            className={cn(
              "px-4 py-2.5 text-left tabular-nums transition-colors",
              r.winner === "B"
                ? "bg-emerald-50/90 font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "font-medium text-slate-800 dark:text-slate-200"
            )}
          >
            {r.fmtB}
          </td>
        </tr>
      ))}
    </>
  );
}
