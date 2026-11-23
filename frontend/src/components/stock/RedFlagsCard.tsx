"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { RedFlagItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RedFlagsCardProps {
  redFlags: RedFlagItem[];
}

export function RedFlagsCard({ redFlags }: RedFlagsCardProps) {
  if (!redFlags || redFlags.length === 0) {
    return (
      <div className="flex items-center">
        <Badge
          variant="emerald"
          className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Aucun Red Flag détecté</span>
        </Badge>
      </div>
    );
  }

  return (
    <Card className="border-rose-200 bg-rose-50/60 dark:border-rose-900/70 dark:bg-rose-950/20">
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <h2 className="text-sm font-bold">
              {redFlags.length === 1
                ? "1 point de vigilance (« Red Flag ») détecté"
                : `${redFlags.length} points de vigilance (« Red Flags ») détectés`}
            </h2>
          </div>
          <Badge variant="coral">À vérifier avant achat</Badge>
        </div>

        <div className="grid gap-2.5 md:grid-cols-2">
          {redFlags.map((flag) => (
            <div
              key={flag.id}
              className={cn(
                "rounded-xl border bg-white/90 p-3 dark:bg-slate-900/90",
                flag.severity === "high"
                  ? "border-rose-200 dark:border-rose-800/80"
                  : "border-amber-200 dark:border-amber-800/80"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {flag.title}
                </span>
                {flag.value_label && (
                  <Badge variant={flag.severity === "high" ? "coral" : "amber"}>
                    {flag.value_label}
                  </Badge>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {flag.detail}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
