"use client";

import { useRef, useState } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { Download, Maximize2, X } from "lucide-react";
import { useTheme } from "next-themes";
import { InfoTooltip } from "@/components/stock/InfoTooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EChart } from "@/components/ui/echart";
import { cn } from "@/lib/utils";

interface ExpandableChartCardProps {
  title: string;
  subtitle?: string;
  tooltip?: string;
  option: EChartsOption;
  modalOption?: EChartsOption;
  headerRight?: React.ReactNode;
  topControls?: React.ReactNode;
  footer?: React.ReactNode;
  modalControls?: React.ReactNode;
  downloadName?: string;
  chartClassName?: string;
  emptyMessage?: string;
  hasData?: boolean;
  onEvents?: Record<string, (params: unknown) => void>;
}

export function ExpandableChartCard({
  title,
  subtitle,
  tooltip,
  option,
  modalOption,
  headerRight,
  topControls,
  footer,
  modalControls,
  downloadName,
  chartClassName = "h-56",
  emptyMessage = "Données indisponibles",
  hasData = true,
  onEvents,
}: ExpandableChartCardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [expanded, setExpanded] = useState(false);
  const modalChartRef = useRef<ECharts | null>(null);

  const handleDownloadPng = () => {
    const inst = modalChartRef.current;
    if (!inst || inst.isDisposed()) return;
    const url = inst.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(downloadName || title).replace(/\s+/g, "_")}.png`;
    a.click();
  };

  return (
    <>
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-sm">{title}</CardTitle>
              {tooltip && <InfoTooltip text={tooltip} />}
            </div>
            {subtitle && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {headerRight}
            {hasData && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                title="Agrandir le graphique"
                aria-label={`Agrandir ${title}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-700 cursor-pointer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-1">
          {topControls && <div>{topControls}</div>}
          {hasData ? (
            <EChart option={option} className={cn("w-full", chartClassName)} onEvents={onEvents} />
          ) : (
            <div className="flex h-52 items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400 dark:border-slate-800">
              {emptyMessage}
            </div>
          )}

          {footer && <div className="pt-1">{footer}</div>}
        </CardContent>
      </Card>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-xs sm:p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
                {subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {modalControls}
                <Button variant="outline" size="sm" onClick={handleDownloadPng}>
                  <Download className="h-3.5 w-3.5" />
                  <span>PNG</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Fermer"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {topControls && <div className="mb-4">{topControls}</div>}
              <EChart
                option={modalOption || option}
                className="h-[400px] sm:h-[480px]"
                onInstanceReady={(inst) => {
                  modalChartRef.current = inst;
                }}
                onEvents={onEvents}
              />
              {footer && <div className="mt-4">{footer}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
