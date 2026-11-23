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
  "#64748B",
];

type DonutMode = "by_position" | "by_envelope" | "by_sector";

export function PortfolioDonutCard({ donuts }: { donuts: PortfolioDonuts }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { displayCurrency, convertAmount } = useDisplayCurrency();
  const [mode, setMode] = useState<DonutMode>("by_position");

  const slices = donuts[mode] || [];

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
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Répartition</CardTitle>
          {mode === "by_sector" && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Actions uniquement (hors ETF)
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { key: "by_position", label: "Position" },
              { key: "by_envelope", label: "PEA / CTO" },
              { key: "by_sector", label: "Secteur" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                mode === tab.key
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 dark:text-slate-300"
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
            {mode === "by_sector"
              ? "Aucune action individuelle en portefeuille"
              : "Aucune position valorisée"}
          </div>
        ) : (
          <div className="grid items-center gap-4 sm:grid-cols-[1fr_175px]">
            <EChart option={option} className="h-60" />

            <ul className="max-h-60 space-y-2 overflow-y-auto pr-1 text-xs">
              {slices.map((s, idx) => (
                <li key={s.name} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
                    />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                      {s.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">
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
