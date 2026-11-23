"use client";

import { Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface ScreenerFiltersState {
  q: string;
  asset_type: string;
  region: string;
  pea_only: boolean;
  only_scored: boolean;
  sector: string;
  min_global: string;
  min_valuation: string;
  min_growth: string;
  min_quality: string;
  min_health: string;
  max_pe: string;
  min_rev_growth_pct: string;
  max_net_debt_ebitda: string;
}

interface ScreenerFiltersPanelProps {
  filters: ScreenerFiltersState;
  sectors: string[];
  onChange: (patch: Partial<ScreenerFiltersState>) => void;
}

export function ScreenerFiltersPanel({
  filters,
  sectors,
  onChange,
}: ScreenerFiltersPanelProps) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {/* Row 1: Text search + Selects + Checkboxes */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="text"
              value={filters.q}
              onChange={(e) => onChange({ q: e.target.value })}
              placeholder="Nom ou ticker..."
              className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
          </div>

          <select
            value={filters.region}
            onChange={(e) => onChange({ region: e.target.value })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="ALL">Zone : Toutes</option>
            <option value="US">Zone : États-Unis</option>
            <option value="EU">Zone : Europe</option>
          </select>

          <select
            value={filters.asset_type}
            onChange={(e) => onChange({ asset_type: e.target.value })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="ALL">Type : Actions &amp; ETF</option>
            <option value="EQUITY">Type : Actions uniquement</option>
            <option value="ETF">Type : ETF uniquement</option>
          </select>

          <select
            value={filters.sector}
            onChange={(e) => onChange({ sector: e.target.value })}
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="ALL">Secteur : Tous</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-4 px-1">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.pea_only}
                onChange={(e) => onChange({ pea_only: e.target.checked })}
              />
              <span>Éligible PEA</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.only_scored}
                onChange={(e) => onChange({ only_scored: e.target.checked })}
              />
              <span>Notées</span>
            </label>
          </div>
        </div>

        {/* Row 2: Numeric Thresholds */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {(
            [
              { key: "min_global", label: "Globale min", placeholder: "65" },
              { key: "min_valuation", label: "Valo min", placeholder: "60" },
              { key: "min_growth", label: "Croiss. min", placeholder: "60" },
              { key: "min_quality", label: "Qualité min", placeholder: "70" },
              { key: "min_health", label: "Santé min", placeholder: "60" },
              { key: "max_pe", label: "PER max", placeholder: "30" },
              { key: "min_rev_growth_pct", label: "CA 1A min (%)", placeholder: "10" },
              { key: "max_net_debt_ebitda", label: "Dette/EBITDA max", placeholder: "2" },
            ] as const
          ).map((f) => (
            <div key={f.key} className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {f.label}
              </label>
              <input
                type="number"
                step="any"
                value={filters[f.key]}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
