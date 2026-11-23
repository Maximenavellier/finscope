"use client";

import { RotateCcw, Shield, Sparkles, Tag, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS = [
  {
    id: "quality_on_sale",
    label: "Qualité en solde",
    description: "Qualité ≥ 70 & Valorisation ≥ 60",
    icon: Tag,
  },
  {
    id: "profitable_hypergrowth",
    label: "Hyper-croissance rentable",
    description: "Croissance ≥ 70, Qualité ≥ 60, CA ≥ +15 %",
    icon: TrendingUp,
  },
  {
    id: "financial_fortresses",
    label: "Forteresses financières",
    description: "Santé ≥ 75, Qualité ≥ 65, Dette/EBITDA ≤ 1x",
    icon: Shield,
  },
  {
    id: "pea_eligible",
    label: "Éligible PEA",
    description: "Actions & ETF éligibles PEA",
    icon: Sparkles,
  },
];

interface ScreenerPresetsProps {
  activePreset: string | null;
  onSelectPreset: (presetId: string) => void;
  onReset: () => void;
}

export function ScreenerPresets({
  activePreset,
  onSelectPreset,
  onReset,
}: ScreenerPresetsProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const active = activePreset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              title={p.description}
              onClick={() => onSelectPreset(p.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer",
                active
                  ? "border-blue-600 bg-blue-600 text-white shadow-xs"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-700"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>

      <Button variant="ghost" size="sm" onClick={onReset}>
        <RotateCcw className="h-3.5 w-3.5" />
        <span>Réinitialiser</span>
      </Button>
    </div>
  );
}
