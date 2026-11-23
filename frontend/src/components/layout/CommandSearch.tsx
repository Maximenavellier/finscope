"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Search, TrendingUp, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { searchAssets } from "@/lib/api";
import type { SearchAssetItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const DEFAULT_SUGGESTIONS: SearchAssetItem[] = [
  { ticker: "NVDA", name: "NVIDIA Corporation", asset_type: "EQUITY", region: "US", pea_eligible: false, sector: "Technology" },
  { ticker: "ASML.AS", name: "ASML Holding N.V.", asset_type: "EQUITY", region: "EU", pea_eligible: true, sector: "Technology" },
  { ticker: "MC.PA", name: "LVMH Moët Hennessy - Louis Vuitton", asset_type: "EQUITY", region: "EU", pea_eligible: true, sector: "Consumer Cyclical" },
  { ticker: "MSFT", name: "Microsoft Corporation", asset_type: "EQUITY", region: "US", pea_eligible: false, sector: "Technology" },
  { ticker: "LLY", name: "Eli Lilly and Company", asset_type: "EQUITY", region: "US", pea_eligible: false, sector: "Healthcare" },
  { ticker: "CW8.PA", name: "Amundi MSCI World UCITS ETF", asset_type: "ETF", region: "EU", pea_eligible: true, sector: null },
];

interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandSearch({ open, onOpenChange }: CommandSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchAssetItem[]>(DEFAULT_SUGGESTIONS);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setSearchError(null);
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery("");
      setSearchError(null);
      setResults(DEFAULT_SUGGESTIONS);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    setSearchError(null);
    if (!trimmed) {
      setResults(DEFAULT_SUGGESTIONS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchAssets(trimmed, 12);
        if (!cancelled) {
          setResults(res.results.length > 0 ? res.results : []);
          setActiveIndex(0);
          setSearchError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setResults([]);
          setSearchError(
            err instanceof Error
              ? err.message
              : "Impossible de joindre l'API backend. Vérifiez que le serveur FastAPI est démarré."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const navigateTo = (ticker: string) => {
    onOpenChange(false);
    router.push(`/stock/${encodeURIComponent(ticker)}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (results[activeIndex]) {
        navigateTo(results[activeIndex].ticker);
      } else if (!searchError && query.trim().length >= 1) {
        navigateTo(query.trim().toUpperCase());
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 px-4 pt-16 backdrop-blur-xs sm:pt-24"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une action US, Europe ou ETF (ex: NVDA, ASML.AS, CW8.PA)..."
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
          ) : (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          <div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {query.trim() ? "Résultats" : "Suggestions rapides"}
          </div>

          {searchError ? (
            <div className="m-2 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/50 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold">Serveur backend inaccessible</p>
                <p>{searchError}</p>
              </div>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              Aucun résultat trouvé.{" "}
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => navigateTo(query.trim().toUpperCase())}
                  className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  Ouvrir directement {query.trim().toUpperCase()}
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {results.map((item, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li key={item.ticker}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => navigateTo(item.ticker)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer",
                        isActive
                          ? "bg-blue-50 dark:bg-blue-950/60"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {item.ticker.slice(0, 4)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                              {item.ticker}
                            </span>
                            {item.asset_type === "ETF" && <Badge variant="secondary">ETF</Badge>}
                            {item.pea_eligible && <Badge variant="emerald">PEA</Badge>}
                            <Badge variant="outline">{item.region}</Badge>
                          </div>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {item.name}
                            {item.sector ? ` · ${item.sector}` : ""}
                          </p>
                        </div>
                      </div>

                      {typeof item.score_global === "number" ? (
                        <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                          <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                          <span>{item.score_global.toFixed(0)}/100</span>
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
          <span>↑↓ pour naviguer · Entrée pour ouvrir</span>
          <span>Échap pour fermer</span>
        </div>
      </div>
    </div>
  );
}
