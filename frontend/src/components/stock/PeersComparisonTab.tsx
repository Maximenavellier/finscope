"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { EChartsOption } from "echarts";
import { Loader2, Plus, RotateCcw, Search, X } from "lucide-react";
import { useTheme } from "next-themes";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EChart } from "@/components/ui/echart";
import { Skeleton } from "@/components/ui/skeleton";
import { getStockPeers, searchAssets, updatePeerOverride } from "@/lib/api";
import { formatMultiple, formatPercent, isValidNumber } from "@/lib/formatters";
import type { PeerMetricRow, PeersComparisonResponse, SearchAssetItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MetricRowSpec {
  key: keyof PeerMetricRow & string;
  label: string;
  group: string;
  format: (val: number | null | undefined) => string;
  deltaUnit: "pct" | "pts" | "score";
}

const METRIC_ROWS: MetricRowSpec[] = [
  { key: "pe", label: "Cours / Bénéfice (PER)", group: "Valorisation", format: (v) => formatMultiple(v), deltaUnit: "pct" },
  { key: "forward_pe", label: "PER prévisionnel", group: "Valorisation", format: (v) => formatMultiple(v), deltaUnit: "pct" },
  { key: "p_fcf", label: "Cours / Cash libre (P/FCF)", group: "Valorisation", format: (v) => formatMultiple(v), deltaUnit: "pct" },
  { key: "peg", label: "Ratio PEG", group: "Valorisation", format: (v) => formatMultiple(v, 2), deltaUnit: "pct" },
  {
    key: "rev_growth_1y",
    label: "Croissance Chiffre d'affaires (1A)",
    group: "Croissance",
    format: (v) => formatPercent(v, { isDecimal: true, signed: true }),
    deltaUnit: "pts",
  },
  {
    key: "rev_growth_3y",
    label: "Croissance Chiffre d'affaires (3A)",
    group: "Croissance",
    format: (v) => formatPercent(v, { isDecimal: true, signed: true }),
    deltaUnit: "pts",
  },
  {
    key: "eps_growth_1y",
    label: "Croissance Bénéfices (1A)",
    group: "Croissance",
    format: (v) => formatPercent(v, { isDecimal: true, signed: true }),
    deltaUnit: "pts",
  },
  {
    key: "gross_margin",
    label: "Marge brute",
    group: "Rentabilité",
    format: (v) => formatPercent(v, { isDecimal: true }),
    deltaUnit: "pts",
  },
  {
    key: "op_margin",
    label: "Marge opérationnelle",
    group: "Rentabilité",
    format: (v) => formatPercent(v, { isDecimal: true }),
    deltaUnit: "pts",
  },
  {
    key: "net_margin",
    label: "Marge nette",
    group: "Rentabilité",
    format: (v) => formatPercent(v, { isDecimal: true }),
    deltaUnit: "pts",
  },
  {
    key: "roe",
    label: "Rentabilité fonds propres (ROE)",
    group: "Rentabilité",
    format: (v) => formatPercent(v, { isDecimal: true }),
    deltaUnit: "pts",
  },
  {
    key: "net_debt_ebitda",
    label: "Dette nette / EBITDA",
    group: "Santé",
    format: (v) => formatMultiple(v),
    deltaUnit: "pct",
  },
  {
    key: "score_global",
    label: "Note Globale /100",
    group: "Score",
    format: (v) => (isValidNumber(v) ? `${v.toFixed(0)}/100` : "—"),
    deltaUnit: "score",
  },
];

export function PeersComparisonTab({
  ticker,
  refreshKey,
}: {
  ticker: string;
  refreshKey: number;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [data, setData] = useState<PeersComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [peerQuery, setPeerQuery] = useState("");
  const [peerSuggestions, setPeerSuggestions] = useState<SearchAssetItem[]>([]);

  const loadPeers = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await getStockPeers(ticker, { refresh: forceRefresh });
        setData(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors du chargement des concurrents");
      } finally {
        setLoading(false);
      }
    },
    [ticker]
  );

  useEffect(() => {
    loadPeers(refreshKey > 0);
  }, [loadPeers, refreshKey]);

  useEffect(() => {
    const q = peerQuery.trim();
    if (q.length < 2) {
      setPeerSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchAssets(q, 6);
        if (!cancelled) {
          setPeerSuggestions(
            res.results.filter((r) => r.asset_type === "EQUITY" && r.ticker !== ticker)
          );
        }
      } catch {
        if (!cancelled) setPeerSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [peerQuery, ticker]);

  const handleOverride = async (
    peerTicker: string | null,
    action: "ADD" | "EXCLUDE" | "RESET"
  ) => {
    setUpdating(true);
    try {
      await updatePeerOverride(ticker, peerTicker, action);
      setPeerQuery("");
      setPeerSuggestions([]);
      await loadPeers(false);
    } finally {
      setUpdating(false);
    }
  };

  const radarOption = useMemo<EChartsOption>(() => {
    if (!data?.radar) return {};
    const textColor = isDark ? "#CBD5E1" : "#334155";
    const splitLineColor = isDark ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.3)";

    const comp = data.radar.company;
    const avg = data.radar.sector_avg;

    return {
      tooltip: {
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
      },
      legend: {
        bottom: 0,
        textStyle: { color: textColor, fontSize: 11 },
      },
      radar: {
        indicator: [
          { name: "Valorisation", max: 100 },
          { name: "Croissance", max: 100 },
          { name: "Qualité", max: 100 },
          { name: "Santé", max: 100 },
        ],
        radius: "65%",
        axisName: { color: textColor, fontSize: 11 },
        splitLine: { lineStyle: { color: splitLineColor } },
        splitArea: { areaStyle: { color: ["transparent"] } },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: [
                comp.valuation ?? 0,
                comp.growth ?? 0,
                comp.quality ?? 0,
                comp.health ?? 0,
              ],
              name: ticker,
              lineStyle: { color: "#2563EB", width: 2.2 },
              itemStyle: { color: "#2563EB" },
              areaStyle: { color: "rgba(37, 99, 235, 0.2)" },
            },
            {
              value: [
                avg.valuation ?? 0,
                avg.growth ?? 0,
                avg.quality ?? 0,
                avg.health ?? 0,
              ],
              name: "Moyenne secteur",
              lineStyle: { color: "#94A3B8", width: 1.8, type: "dashed" },
              itemStyle: { color: "#94A3B8" },
              areaStyle: { color: "rgba(148, 163, 184, 0.12)" },
            },
          ],
        },
      ],
    };
  }, [data, ticker, isDark]);

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span>Analyse des concurrents directs en parallèle...</span>
          </div>
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-72 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          <Button variant="outline" size="sm" onClick={() => loadPeers(true)}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.available || !data.company) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-slate-500 dark:text-slate-400">
          {data?.summary_sentence || "Aucun concurrent direct trouvé pour ce titre."}
        </CardContent>
      </Card>
    );
  }

  const columns = [data.company, ...data.peers];

  return (
    <div className="space-y-6">
      {/* Top Row: Synthesis + Radar */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Synthèse Concurrentielle</CardTitle>
              {(data.added_overrides.length > 0 || data.excluded_overrides.length > 0) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updating}
                  onClick={() => handleOverride(null, "RESET")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Réinitialiser</span>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-blue-200/70 bg-blue-50/70 p-4 text-sm font-medium text-slate-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-slate-100">
              {data.summary_sentence}
            </div>

            <div className="relative space-y-2">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Ajouter un concurrent manuellement
              </p>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={peerQuery}
                  onChange={(e) => setPeerQuery(e.target.value)}
                  placeholder="Rechercher un ticker (ex: AMD, SAP.DE)..."
                  className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                />
                {updating && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
              </div>

              {peerSuggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {peerSuggestions.map((s) => (
                    <li key={s.ticker}>
                      <button
                        type="button"
                        onClick={() => handleOverride(s.ticker, "ADD")}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <span>
                          <strong className="text-slate-900 dark:text-white">{s.ticker}</strong>{" "}
                          <span className="text-slate-500 dark:text-slate-400">— {s.name}</span>
                        </span>
                        <Plus className="h-3.5 w-3.5 text-blue-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>Profil 4 Piliers vs Secteur</CardTitle>
              <InfoTooltip text="Compare ta pizzeria aux 5 autres de la ville : plus de marge, plus de croissance, et un prix (PER) moins cher que la moyenne du quartier ?" />
            </div>
          </CardHeader>
          <CardContent>
            <EChart option={radarOption} className="h-64" />
          </CardContent>
        </Card>
      </div>

      {/* Comparison Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle>Tableau Comparatif Détaillé</CardTitle>
            <InfoTooltip text="Compare ta pizzeria aux 5 autres de la ville : plus de marge, plus de croissance, et un prix (PER) moins cher que la moyenne du quartier ?" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-xs">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/40">
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                    Métrique
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.ticker}
                      className={cn(
                        "px-3 py-3 text-right font-semibold",
                        col.is_target
                          ? "bg-blue-50/70 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                          : "text-slate-700 dark:text-slate-200"
                      )}
                    >
                      <div className="inline-flex items-center justify-end gap-1">
                        {col.is_target ? (
                          <span>{col.ticker}</span>
                        ) : (
                          <>
                            <Link
                              href={`/stock/${encodeURIComponent(col.ticker)}`}
                              className="hover:text-blue-600 hover:underline dark:hover:text-blue-400"
                            >
                              {col.ticker}
                            </Link>
                            <button
                              type="button"
                              title={`Retirer ${col.ticker}`}
                              onClick={() => handleOverride(col.ticker, "EXCLUDE")}
                              className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-rose-600 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                    Moy. secteur
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                    Écart vs Moy.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {METRIC_ROWS.map((spec) => {
                  const secAvg = data.sector_averages[spec.key];
                  const delta = data.deltas[spec.key];
                  const deltaVariant =
                    delta?.status === "better"
                      ? "emerald"
                      : delta?.status === "worse"
                        ? "coral"
                        : "secondary";

                  let deltaText = "—";
                  if (delta) {
                    if (spec.deltaUnit === "pct" && isValidNumber(delta.diff_pct)) {
                      deltaText = formatPercent(delta.diff_pct, { signed: true, decimals: 0 });
                    } else if (spec.deltaUnit === "pts" && isValidNumber(delta.diff_pts)) {
                      const sign = delta.diff_pts > 0 ? "+" : "";
                      deltaText = `${sign}${delta.diff_pts.toFixed(1).replace(".", ",")} pts`;
                    } else if (spec.deltaUnit === "score" && isValidNumber(delta.diff_pts)) {
                      const sign = delta.diff_pts > 0 ? "+" : "";
                      deltaText = `${sign}${delta.diff_pts.toFixed(1).replace(".", ",")} pts`;
                    }
                  }

                  return (
                    <tr key={spec.key} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <span className="mr-2 text-[10px] uppercase tracking-wide text-slate-400">
                          {spec.group}
                        </span>
                        {spec.label}
                      </td>

                      {columns.map((col) => {
                        const raw = col[spec.key] as number | null | undefined;
                        return (
                          <td
                            key={`${spec.key}-${col.ticker}`}
                            className={cn(
                              "px-3 py-2.5 text-right tabular-nums",
                              col.is_target
                                ? "bg-blue-50/40 font-semibold text-slate-900 dark:bg-blue-950/20 dark:text-white"
                                : "text-slate-600 dark:text-slate-300"
                            )}
                          >
                            {spec.format(raw)}
                          </td>
                        );
                      })}

                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-500 dark:text-slate-400">
                        {spec.format(secAvg)}
                      </td>

                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <Badge variant={deltaVariant}>{deltaText}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
