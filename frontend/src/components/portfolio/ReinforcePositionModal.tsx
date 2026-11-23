"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Button } from "@/components/ui/button";
import { reinforcePortfolioPosition } from "@/lib/api";
import { formatPrice } from "@/lib/formatters";
import type { PortfolioPositionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ReinforcePositionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: PortfolioPositionItem | null;
  onReinforced?: (saved: PortfolioPositionItem) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReinforcePositionModal({
  open,
  onOpenChange,
  position,
  onReinforced,
}: ReinforcePositionModalProps) {
  const { displayCurrency, convertAmount, eurusdRate } = useDisplayCurrency();

  const [mode, setMode] = useState<"amount" | "qty">("amount");
  const [amountInput, setAmountInput] = useState("500");
  const [qtyInput, setQtyInput] = useState("");
  const [buyCurrency, setBuyCurrency] = useState<"EUR" | "USD">("EUR");
  const [unitPrice, setUnitPrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !position) return;
    setError(null);
    setMode("amount");
    setAmountInput("");
    setQtyInput("");
    setBuyCurrency("EUR");
    setPurchaseDate(todayIso());
    setNotes("");

    const liveEur = convertAmount(position.current_price, position.asset_currency, "EUR");
    const pruEur = convertAmount(position.pru, position.currency, "EUR");
    const initPx = liveEur ?? pruEur;
    setUnitPrice(initPx && initPx > 0 ? String(Number(initPx.toFixed(2))) : "");
  }, [open, position, convertAmount]);

  const handleCurrencyToggle = (nextCur: "EUR" | "USD") => {
    if (nextCur === buyCurrency) return;
    const rawNum = Number(unitPrice.replace(",", "."));
    if (Number.isFinite(rawNum) && rawNum > 0 && eurusdRate > 0) {
      const converted = nextCur === "USD" ? rawNum * eurusdRate : rawNum / eurusdRate;
      setUnitPrice(String(Number(converted.toFixed(2))));
    }
    setBuyCurrency(nextCur);
  };

  const preview = useMemo(() => {
    if (!position) return null;
    const pxNum = Number(unitPrice.replace(",", "."));
    if (!Number.isFinite(pxNum) || pxNum <= 0) return null;

    const pxEur = buyCurrency === "USD" && eurusdRate > 0 ? pxNum / eurusdRate : pxNum;
    let addedQty = 0;
    let addedEur = 0;

    if (mode === "amount") {
      const aNum = Number(amountInput.replace(",", "."));
      if (!Number.isFinite(aNum) || aNum <= 0) return null;
      addedQty = aNum / pxNum;
      addedEur = buyCurrency === "USD" && eurusdRate > 0 ? aNum / eurusdRate : aNum;
    } else {
      const qNum = Number(qtyInput.replace(",", "."));
      if (!Number.isFinite(qNum) || qNum <= 0) return null;
      addedQty = qNum;
      addedEur = addedQty * pxEur;
    }

    let oldQty = 0;
    if (position.quantity != null && position.quantity > 0) {
      oldQty = position.quantity;
    } else if (position.invested_amount != null && position.pru != null && position.pru > 0) {
      oldQty = position.invested_amount / position.pru;
    }

    const oldCostEur = position.cost_basis_eur || 0;
    const newTotalQty = oldQty + addedQty;
    const newTotalCostEur = oldCostEur + addedEur;
    const newPruEur = newTotalQty > 0 ? newTotalCostEur / newTotalQty : null;

    return {
      addedQty,
      newTotalQty,
      newPruDisplay: convertAmount(newPruEur, "EUR", displayCurrency),
      newCostDisplay: convertAmount(newTotalCostEur, "EUR", displayCurrency),
    };
  }, [
    position,
    mode,
    amountInput,
    qtyInput,
    unitPrice,
    buyCurrency,
    eurusdRate,
    convertAmount,
    displayCurrency,
  ]);

  if (!open || !position) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const pxNum = Number(unitPrice.replace(",", "."));
    if (!Number.isFinite(pxNum) || pxNum <= 0) {
      setError("Veuillez saisir un prix d'achat valide.");
      return;
    }

    const amtNum = Number(amountInput.replace(",", "."));
    const qNum = Number(qtyInput.replace(",", "."));

    if (mode === "amount" && (!Number.isFinite(amtNum) || amtNum <= 0)) {
      setError("Veuillez saisir un montant investi positif.");
      return;
    }
    if (mode === "qty" && (!Number.isFinite(qNum) || qNum <= 0)) {
      setError("Veuillez saisir une quantité positive.");
      return;
    }

    setSaving(true);
    try {
      const saved = await reinforcePortfolioPosition(position.id, {
        amount: mode === "amount" ? amtNum : undefined,
        quantity: mode === "qty" ? qNum : undefined,
        price: pxNum,
        currency: buyCurrency,
        purchase_date: purchaseDate.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onReinforced?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du renforcement.");
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
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Renforcer {position.ticker}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {position.name} · {position.envelope}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
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
              Par montant
            </button>
            <button
              type="button"
              onClick={() => setMode("qty")}
              className={cn(
                "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                mode === "qty"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 dark:text-slate-400"
              )}
            >
              Par quantité
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {mode === "amount" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Montant investi ({buyCurrency === "USD" ? "$" : "€"})
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="Ex : 500"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Quantité achetée
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  placeholder="Ex : 5"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Prix d&apos;achat
                </label>
                <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                  {(["EUR", "USD"] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => handleCurrencyToggle(cur)}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-bold cursor-pointer",
                        buyCurrency === cur
                          ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400"
                          : "text-slate-500 dark:text-slate-400"
                      )}
                    >
                      {cur === "EUR" ? "€" : "$"}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Date d&apos;achat
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Notes (opt.)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="DCA mensuel..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>

          {preview && (
            <div className="space-y-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-3 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Titres ajoutés :</span>
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                  +{preview.addedQty.toFixed(4).replace(/\.?0+$/, "")}
                </span>
              </div>
              {preview.newTotalQty > 0 && (
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Nouvelle quantité totale :</span>
                  <span className="font-semibold tabular-nums">
                    {preview.newTotalQty.toFixed(4).replace(/\.?0+$/, "")}
                  </span>
                </div>
              )}
              {preview.newPruDisplay != null && (
                <div className="flex justify-between text-slate-600 dark:text-slate-300">
                  <span>Nouveau PRU moyen pondéré :</span>
                  <span className="font-bold tabular-nums text-slate-900 dark:text-white">
                    {formatPrice(preview.newPruDisplay, displayCurrency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Nouveau capital investi :</span>
                <span className="font-semibold tabular-nums">
                  {formatPrice(preview.newCostDisplay, displayCurrency)}
                </span>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Ajouter cet achat</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
