"use client";

import { CheckCircle2, Database, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SeedStatusResponse } from "@/lib/types";

interface SeedStatusBannerProps {
  scoredCount: number;
  universeCount: number;
  seedStatus: SeedStatusResponse | null;
  onStartSeed: (onlyMissing: boolean) => void;
}

export function SeedStatusBanner({
  scoredCount,
  universeCount,
  seedStatus,
  onStartSeed,
}: SeedStatusBannerProps) {
  const isRunning = seedStatus?.status === "running";
  const missingCount = Math.max(0, universeCount - scoredCount);

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Univers Screener : {scoredCount} / {universeCount} valeurs analysées
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enrichissement automatique à chaque recherche + tâche de fond par petits lots
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {missingCount > 0 && (
              <Button
                size="sm"
                disabled={isRunning}
                onClick={() => onStartSeed(true)}
              >
                {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Enrichir les {missingCount} manquantes</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={isRunning}
              onClick={() => onStartSeed(false)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRunning ? "animate-spin" : ""}`} />
              <span>Tout actualiser</span>
            </Button>
          </div>
        </div>

        {isRunning && seedStatus && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
              <span>
                Enrichissement en cours : {seedStatus.processed} / {seedStatus.total} (Lot{" "}
                {seedStatus.current_batch}/{seedStatus.total_batches})
              </span>
              <span className="font-semibold tabular-nums">{seedStatus.progress_pct.toFixed(0)} %</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(4, seedStatus.progress_pct))}%` }}
              />
            </div>
          </div>
        )}

        {seedStatus?.status === "completed" && seedStatus.total > 0 && (
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>
              Dernière mise à jour terminée : {seedStatus.succeeded}/{seedStatus.total} réussies
              {seedStatus.failed > 0 ? ` (${seedStatus.failed} échecs)` : ""}.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
