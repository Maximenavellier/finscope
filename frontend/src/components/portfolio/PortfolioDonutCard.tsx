"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { useTheme } from "next-themes";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EChart } from "@/components/ui/echart";
import { formatPrice } from "@/lib/formatters";
import type { PortfolioDonuts } from "@/lib/types";
import { cn } from "@/lib/utils";

const PALETTE = [
  "#2563EB",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#F43F5E",
  "#06B6D4",
  "#EC4899",
  "#84CC16",
  "#F97316",
  "#6366F1",
  "#14B8A6",
  "#64748B",
];

type DonutMode = "by_position" | "by_envelope" | "by_sector" | "by_geography";

const SECTOR_DISPLAY_FR: Record<string, string> = {
  Technology: "Technologie",
  Healthcare: "Santé",
  "Financial Services": "Finance",
  Financials: "Finance",
  "Communication Services": "Communication",
  "Consumer Cyclical": "Consommation cyclique",
  "Consumer Defensive": "Consommation défensive",
  Industrials: "Industrie",
  Energy: "Énergie",
  "Basic Materials": "Matériaux",
  Utilities: "Services publics",
  "Real Estate": "Immobilier",
  Other: "Autre",
};

function formatSliceLabel(name: string, mode: DonutMode): string {
  if (mode === "by_sector") {
    return SECTOR_DISPLAY_FR[name] ?? name;
  }
  return name;
}

export function PortfolioDonutCard({ donuts }: { donuts: PortfolioDonuts }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { displayCurrency, convertAmount } = useDisplayCurrency();
  const [mode, setMode] = useState<DonutMode>("by_position");
  const [includeEtfSectors, setIncludeEtfSectors] = useState(true);

  const slices = useMemo(() => {
    const raw = (() => {
      if (mode === "by_sector") {
        if (includeEtfSectors) {
          return donuts.by_sector_lookthrough ?? donuts.by_sector ?? [];
        }
        return donuts.by_sector ?? [];
      }
      if (mode === "by_geography") {
        return donuts.by_geography ?? [];
      }
      return donuts[mode] || [];
    })();
    return raw.map((s) => ({
      ...s,
      name: formatSliceLabel(s.name, mode),
    }));
  }, [donuts, mode, includeEtfSectors]);

  const option = useMemo<EChartsOption>(() => {
    if (slices.length === 0) return {};
    return {
      tooltip: {
        trigger: "item",
        backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
        borderColor: isDark ? "#334155" : "#E2E8F0",
        textStyle: { color: isDark ? "#F8FAFC" : "#0F172A", fontSize: 12 },
        valueFormatter: (val) =>
          typeof val === "number" ? formatPrice(val, displayCurrency) : "—",
      },
      color: PALETTE,
      series: [
        {
          name: "Répartition",
          type: "pie",
          radius: ["50%", "78%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: isDark ? "#0F172A" : "#FFFFFF",
            borderWidth: 2,
          },
          label: { show: false },
          data: slices.map((s) => ({
            name: s.name,
            value: convertAmount(s.value_eur, "EUR", displayCurrency) ?? s.value_eur,
          })),
        },
      ],
    };
  }, [slices, isDark, displayCurrency, convertAmount]);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Répartition</CardTitle>
            {mode === "by_sector" && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {includeEtfSectors
                  ? "Exposition réelle (actions + transparence ETF)"
                  : "Actions uniquement (hors ETF)"}
              </p>
            )}
            {mode === "by_geography" && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Exposition géographique réelle (actions + ETF)
              </p>
            )}
          </div>

          {mode === "by_sector" && (
            <button
              type="button"
              onClick={() => setIncludeEtfSectors((v) => !v)}
              aria-pressed={includeEtfSectors}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
                includeEtfSectors
                  ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  includeEtfSectors ? "bg-blue-600 dark:bg-blue-400" : "bg-slate-400"
                )}
              />
              <span>Inclure ETF</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit dark:bg-slate-800">
          {(
            [
              { key: "by_position", label: "Position" },
              { key: "by_envelope", label: "PEA / CTO" },
              { key: "by_sector", label: "Secteur" },
              { key: "by_geography", label: "Géographie" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer",
                mode === tab.key
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "bg-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {slices.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-xs text-slate-400">
            {mode === "by_sector" && !includeEtfSectors
              ? "Aucune action individuelle en portefeuille"
              : "Aucune position valorisée"}
          </div>
        ) : (
          <div className="grid items-center gap-4 sm:grid-cols-[minmax(160px,1fr)_215px]">
            <EChart option={option} className="h-60" />

            <ul className="max-h-60 space-y-2 overflow-y-auto pr-1 text-[11px]">
              {slices.map((s, idx) => (
                <li key={s.name} className="flex items-center justify-between gap-2" title={s.name}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                    />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {s.name}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-slate-900 dark:text-white">
                    {s.weight_pct.toFixed(1).replace(".", ",")} %
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
