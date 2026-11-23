"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortfolioPosition, searchAssets, updatePortfolioPosition } from "@/lib/api";
import type { PortfolioPositionItem, SearchAssetItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PositionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPosition?: PortfolioPositionItem | null;
  defaultTicker?: string;
  defaultAssetType?: "EQUITY" | "ETF";
  defaultEnvelope?: "PEA" | "CTO";
  defaultCurrency?: string | null;
  defaultPru?: number | null;
  onSaved?: (saved: PortfolioPositionItem) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PositionModal({
  open,
  onOpenChange,
  initialPosition,
  defaultTicker,
  defaultAssetType = "EQUITY",
  defaultEnvelope = "CTO",
  defaultCurrency,
  defaultPru,
  onSaved,
}: PositionModalProps) {
  const isEdit = Boolean(initialPosition);
  const tickerLocked = isEdit || Boolean(defaultTicker);

  const [ticker, setTicker] = useState("");
  const [suggestions, setSuggestions] = useState<SearchAssetItem[]>([]);
  const [assetType, setAssetType] = useState<"EQUITY" | "ETF">("EQUITY");
  const [envelope, setEnvelope] = useState<"PEA" | "CTO">("CTO");
  const [mode, setMode] = useState<"qty_pru" | "amount">("qty_pru");
  const [quantity, setQuantity] = useState("");
  const [pru, setPru] = useState("");
  const [investedAmount, setInvestedAmount] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [feesEur, setFeesEur] = useState("1");
  const [feesTouched, setFeesTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuggestions([]);
    if (initialPosition) {
      setTicker(initialPosition.ticker);
      setAssetType(initialPosition.asset_type === "ETF" ? "ETF" : "EQUITY");
      setEnvelope(initialPosition.envelope === "PEA" ? "PEA" : "CTO");
      const hasQty = initialPosition.quantity != null && initialPosition.pru != null;
      setMode(hasQty ? "qty_pru" : "amount");
      setQuantity(initialPosition.quantity != null ? String(initialPosition.quantity) : "");
      setPru(initialPosition.pru != null ? String(initialPosition.pru) : "");
      setInvestedAmount(
        initialPosition.invested_amount != null ? String(initialPosition.invested_amount) : ""
      );
      setCurrency(initialPosition.currency === "USD" ? "USD" : "EUR");
      setPurchaseDate(initialPosition.purchase_date || "");
      setFeesEur(String(initialPosition.fees_eur ?? 0));
      setFeesTouched(true);
      setNotes(initialPosition.notes || "");
    } else {
      setTicker(defaultTicker || "");
      setAssetType(defaultAssetType);
      setEnvelope(defaultEnvelope);
      setMode("qty_pru");
      setQuantity("");
      setPru(defaultPru && defaultPru > 0 ? String(Number(defaultPru.toFixed(2))) : "");
      setInvestedAmount("");
      setCurrency(defaultCurrency === "USD" ? "USD" : "EUR");
      setPurchaseDate(todayIso());
      setFeesEur(defaultEnvelope === "CTO" ? "1" : "0");
      setFeesTouched(false);
      setNotes("");
    }
  }, [open, initialPosition, defaultTicker, defaultAssetType, defaultEnvelope, defaultCurrency, defaultPru]);

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

    const qtyNum = Number(quantity.replace(",", "."));
    const pruNum = Number(pru.replace(",", "."));
    const amtNum = Number(investedAmount.replace(",", "."));
    const feesNum = Math.max(0, Number(feesEur.replace(",", ".")) || 0);

    if (mode === "qty_pru") {
      if (!Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isFinite(pruNum) || pruNum <= 0) {
        setError("Quantité et PRU doivent être des nombres positifs.");
        return;
      }
    } else if (!Number.isFinite(amtNum) || amtNum <= 0) {
      setError("Le montant investi doit être un nombre positif.");
      return;
    }

    setSaving(true);
    try {
      let saved: PortfolioPositionItem;
      if (isEdit && initialPosition) {
        saved = await updatePortfolioPosition(initialPosition.id, {
          asset_type: assetType,
          envelope,
          quantity: mode === "qty_pru" ? qtyNum : undefined,
          pru: mode === "qty_pru" ? pruNum : undefined,
          invested_amount: mode === "amount" ? amtNum : undefined,
          clear_quantity_pru: mode === "amount",
          currency,
          purchase_date: purchaseDate.trim() || "",
          fees_eur: feesNum,
          notes: notes.trim() || "",
        });
      } else {
        saved = await createPortfolioPosition({
          ticker: sym,
          asset_type: assetType,
          envelope,
          quantity: mode === "qty_pru" ? qtyNum : undefined,
          pru: mode === "qty_pru" ? pruNum : undefined,
          invested_amount: mode === "amount" ? amtNum : undefined,
          currency,
          purchase_date: purchaseDate.trim() || undefined,
          fees_eur: feesNum,
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
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {isEdit ? `Modifier ${initialPosition?.ticker}` : "Ajouter une position"}
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
          {/* Ticker */}
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
                placeholder="Ex: NVDA, ASML.AS, CW8.PA..."
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
                        const nextEnv = s.pea_eligible ? "PEA" : "CTO";
                        setTicker(s.ticker);
                        setAssetType(s.asset_type === "ETF" ? "ETF" : "EQUITY");
                        setEnvelope(nextEnv);
                        if (!feesTouched) setFeesEur(nextEnv === "CTO" ? "1" : "0");
                        setSuggestions([]);
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <span className="truncate">
                        <strong className="text-slate-900 dark:text-white">{s.ticker}</strong>{" "}
                        <span className="text-slate-500">— {s.name}</span>
                      </span>
                      <span className="ml-2 shrink-0 text-[10px] font-semibold text-slate-400">
                        {s.asset_type === "ETF" ? "ETF" : s.pea_eligible ? "PEA" : s.region}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Enveloppe + Type d'actif */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Enveloppe
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(["PEA", "CTO"] as const).map((env) => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => {
                      setEnvelope(env);
                      if (!isEdit && !feesTouched) {
                        setFeesEur(env === "CTO" ? "1" : "0");
                      }
                    }}
                    className={cn(
                      "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      envelope === env
                        ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                        : "text-slate-600 dark:text-slate-400"
                    )}
                  >
                    {env}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Type d&apos;actif
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    { id: "EQUITY", label: "Action" },
                    { id: "ETF", label: "ETF" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAssetType(t.id)}
                    className={cn(
                      "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      assetType === t.id
                        ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                        : "text-slate-600 dark:text-slate-400"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Devise d'achat + Date d'achat */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Devise d&apos;achat
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(["EUR", "USD"] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setCurrency(cur)}
                    className={cn(
                      "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                      currency === cur
                        ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                        : "text-slate-600 dark:text-slate-400"
                    )}
                  >
                    {cur === "EUR" ? "EUR (€)" : "USD ($)"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Date d&apos;achat (opt.)
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Mode Quantité+PRU vs Montant investi */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setMode("qty_pru")}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  mode === "qty_pru"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 dark:text-slate-400"
                )}
              >
                Quantité + PRU
              </button>
              <button
                type="button"
                onClick={() => setMode("amount")}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  mode === "amount"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 dark:text-slate-400"
                )}
              >
                Montant investi
              </button>
            </div>

            {mode === "qty_pru" ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 dark:text-slate-400">Quantité</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="10"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 dark:text-slate-400">
                    PRU ({currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={pru}
                    onChange={(e) => setPru(e.target.value)}
                    placeholder="120.00"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs text-slate-500 dark:text-slate-400">
                  Montant investi ({currency})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={investedAmount}
                  onChange={(e) => setInvestedAmount(e.target.value)}
                  placeholder="2500"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          {/* Frais de courtage + Notes */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.9fr_1.3fr]">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Frais (€)
                </label>
                <span className="text-[10px] text-slate-400">
                  {envelope === "CTO" ? "1 € auto CTO" : "0 € PEA"}
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                value={feesEur}
                onChange={(e) => {
                  setFeesEur(e.target.value);
                  setFeesTouched(true);
                }}
                placeholder="1"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Notes (optionnel)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Thèse d'investissement..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{isEdit ? "Enregistrer" : "Ajouter"}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
