"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, CheckCircle2, AlertCircle, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clearBackendCache, getSystemStatus } from "@/lib/api";
import type { SystemStatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ApiStatusPopover() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearedMsg, setClearedMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const loadStatus = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await getSystemStatus(refresh);
      setStatus(res);
    } catch {
      // ignore silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus(false);
  }, [loadStatus]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleClearCache = async () => {
    setClearing(true);
    setClearedMsg(null);
    try {
      const res = await clearBackendCache();
      setClearedMsg(`${res.cleared} entrée(s) supprimée(s).`);
      await loadStatus(false);
    } catch {
      setClearedMsg("Impossible de vider le cache.");
    } finally {
      setClearing(false);
    }
  };

  const hasError = status?.providers.some((p) => p.status === "error");
  const allOk = status && status.providers.every((p) => p.status === "ok");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Statut des sources de données & cache"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            !status
              ? "bg-slate-400"
              : hasError
                ? "bg-rose-500"
                : allOk
                  ? "bg-emerald-500"
                  : "bg-amber-500"
          )}
        />
        <Activity className="h-3.5 w-3.5 hidden sm:inline" />
        <span className="hidden lg:inline">APIs</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white">
                Statut des sources API
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cache BDD : {status?.cache_entries_count ?? "—"} entrées
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => loadStatus(true)}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              <span>Tester</span>
            </Button>
          </div>

          <div className="space-y-2">
            {(status?.providers || []).map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {p.name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.detail}</p>
                </div>
                <Badge
                  variant={
                    p.status === "ok"
                      ? "emerald"
                      : p.status === "missing"
                        ? "amber"
                        : "coral"
                  }
                  className="shrink-0"
                >
                  {p.status === "ok" ? (
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> OK
                    </span>
                  ) : p.status === "missing" ? (
                    "Manquante"
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> Erreur
                    </span>
                  )}
                </Badge>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={clearing}
              onClick={handleClearCache}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{clearing ? "Vidage..." : "Vider le cache"}</span>
            </Button>
          </div>

          {clearedMsg && (
            <p className="mt-2 text-center text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              {clearedMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
