"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteWatchlistItem, searchAssets, updateWatchlistItem, upsertWatchlistItem } from "@/lib/api";
import type { SearchAssetItem, WatchlistItemEnriched } from "@/lib/types";
import { cn } from "@/lib/utils";

interface WatchlistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialItem?: WatchlistItemEnriched | null;
  defaultTicker?: string;
  defaultCurrency?: string | null;
  defaultPrice?: number | null;
  onSaved?: (saved: WatchlistItemEnriched) => void;
  onRemoved?: (ticker: string) => void;
}

export function WatchlistModal({
  open,
  onOpenChange,
  initialItem,
  defaultTicker,
  defaultCurrency,
  defaultPrice,
  onSaved,
  onRemoved,
}: WatchlistModalProps) {
  const isEdit = Boolean(initialItem);
  const tickerLocked = isEdit || Boolean(defaultTicker);

  const [ticker, setTicker] = useState("");
  const [suggestions, setSuggestions] = useState<SearchAssetItem[]>([]);
  const [targetPrice, setTargetPrice] = useState("");
  const [targetCurrency, setTargetCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuggestions([]);
    if (initialItem) {
      setTicker(initialItem.ticker);
      setTargetPrice(initialItem.target_price != null ? String(initialItem.target_price) : "");
      setTargetCurrency(
        initialItem.target_currency === "EUR" || initialItem.currency === "EUR" ? "EUR" : "USD"
      );
      setNotes(initialItem.notes || "");
    } else {
      setTicker(defaultTicker || "");
      const suggested =
        defaultPrice && defaultPrice > 0 ? String(Number((defaultPrice * 0.9).toFixed(2))) : "";
      setTargetPrice(suggested);
      setTargetCurrency(defaultCurrency === "EUR" ? "EUR" : "USD");
      setNotes("");
    }
  }, [open, initialItem, defaultTicker, defaultCurrency, defaultPrice]);

  useEffect(() => {
    if (!open || tickerLocked) return;
    const q = ticker.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await searchAssets(q, 6);
        if (!cancelled) setSuggestions(res.results);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticker, open, tickerLocked]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const sym = ticker.trim().toUpperCase();
    if (!sym) {
      setError("Veuillez saisir un ticker.");
      return;
    }

    const trimmedTarget = targetPrice.trim().replace(",", ".");
    let parsedTarget: number | undefined;
    if (trimmedTarget) {
      const n = Number(trimmedTarget);
      if (!Number.isFinite(n) || n <= 0) {
        setError("Le prix cible doit être positif.");
        return;
      }
      parsedTarget = n;
    }

    setSaving(true);
    try {
      let saved: WatchlistItemEnriched;
      if (isEdit && initialItem) {
        saved = await updateWatchlistItem(initialItem.id, {
          target_price: parsedTarget,
          clear_target: parsedTarget === undefined,
          target_currency: targetCurrency,
          notes: notes.trim() || "",
        });
      } else {
        saved = await upsertWatchlistItem({
          ticker: sym,
          target_price: parsedTarget,
          target_currency: targetCurrency,
          notes: notes.trim() || undefined,
        });
      }
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {isEdit ? `Watchlist — ${initialItem?.ticker}` : "Ajouter à la Watchlist"}
          </h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Ticker / Actif
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={ticker}
                disabled={tickerLocked}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="Ex: LLY, ZS, ASML.AS..."
                className="w-full bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-70 dark:text-slate-100"
              />
            </div>

            {suggestions.length > 0 && !tickerLocked && (
              <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {suggestions.map((s) => (
                  <li key={s.ticker}>
                    <button
                      type="button"
                      onClick={() => {
                        setTicker(s.ticker);
                        setTargetCurrency(s.region === "EU" ? "EUR" : "USD");
                        setSuggestions([]);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="truncate">
                        <strong className="text-slate-900 dark:text-white">{s.ticker}</strong>{" "}
                        <span className="text-slate-500">— {s.name}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Prix cible perso (optionnel)
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="Ex: 110.00"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Devise
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(["USD", "EUR"] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setTargetCurrency(cur)}
                    className={cn(
                      "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      targetCurrency === cur
                        ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                        : "text-slate-600 dark:text-slate-400"
                    )}
                  >
                    {cur}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Notes (optionnel)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Point d'entrée souhaité..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            {isEdit && initialItem && onRemoved ? (
              <Button
                variant="ghost"
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await deleteWatchlistItem(initialItem.id);
                    onRemoved(initialItem.ticker);
                    onOpenChange(false);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Retirer
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{isEdit ? "Mettre à jour" : "Suivre ce titre"}</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
