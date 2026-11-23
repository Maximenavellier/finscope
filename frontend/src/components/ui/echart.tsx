"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ECharts, EChartsOption } from "echarts";
import { cn } from "@/lib/utils";

interface EChartProps {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
  onInstanceReady?: (instance: ECharts | null) => void;
  onEvents?: Record<string, (params: unknown) => void>;
}

export function EChart({
  option,
  className,
  style,
  onInstanceReady,
  onEvents,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const onInstanceReadyRef = useRef(onInstanceReady);
  onInstanceReadyRef.current = onInstanceReady;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el);
    instanceRef.current = chart;
    onInstanceReadyRef.current?.(chart);

    const observer = new ResizeObserver(() => {
      if (instanceRef.current && !instanceRef.current.isDisposed()) {
        instanceRef.current.resize();
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      onInstanceReadyRef.current?.(null);
      chart.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart || chart.isDisposed()) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart || chart.isDisposed() || !onEvents) return;
    const entries = Object.entries(onEvents);
    for (const [evt, handler] of entries) {
      chart.on(evt, handler as never);
    }
    return () => {
      if (chart.isDisposed()) return;
      for (const [evt, handler] of entries) {
        chart.off(evt, handler as never);
      }
    };
  }, [onEvents]);

  return <div ref={containerRef} className={cn("w-full h-72", className)} style={style} />;
}
