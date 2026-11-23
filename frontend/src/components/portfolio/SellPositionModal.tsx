"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Button } from "@/components/ui/button";
import { sellPortfolioPosition } from "@/lib/api";
import { formatPercent, formatPrice, isValidNumber } from "@/lib/formatters";
import type { PortfolioPositionItem, PortfolioSellResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SellPositionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: PortfolioPositionItem | null;
  onSold?: (res: PortfolioSellResponse) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SellPositionModal({
  open,
  onOpenChange,
  position,
  onSold,
}: SellPositionModalProps) {
  const { displayCurrency, convertAmount, eurusdRate } = useDisplayCurrency();

  const [mode, setMode] = useState<"full" | "partial">("partial");
  const [partialUnit, setPartialUnit] = useState<"pct" | "qty" | "amount">("pct");
  const [partialValue, setPartialValue] = useState("50");
  const [sellCurrency, setSellCurrency] = useState<"EUR" | "USD">("EUR");
  const [sellPrice, setSellPrice] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !position) return;
    setError(null);
    setMode("full");
    setPartialUnit("pct");
    setPartialValue("50");
    setSellCurrency("EUR");
    setSaleDate(todayIso());
    setNotes("");

    const liveEur = convertAmount(position.current_price, position.asset_currency, "EUR");
    const pruEur = convertAmount(position.pru, position.currency, "EUR");
    const initialPx = liveEur ?? pruEur;
    setSellPrice(initialPx && initialPx > 0 ? String(Number(initialPx.toFixed(2))) : "");
  }, [open, position, convertAmount]);

  const handleCurrencyToggle = (nextCur: "EUR" | "USD") => {
    if (nextCur === sellCurrency) return;
    const rawNum = Number(sellPrice.replace(",", "."));
    if (Number.isFinite(rawNum) && rawNum > 0 && eurusdRate > 0) {
      const converted = nextCur === "USD" ? rawNum * eurusdRate : rawNum / eurusdRate;
      setSellPrice(String(Number(converted.toFixed(2))));
    }
    setSellCurrency(nextCur);
  };

  const preview = useMemo(() => {
    if (!position) return null;
    const priceNum = Number(sellPrice.replace(",", "."));
    const validPrice = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : 0;
    const sellPriceEur =
      sellCurrency === "USD" && eurusdRate > 0 ? priceNum / eurusdRate : priceNum;

    let totalQty = 0;
    if (position.quantity != null && position.quantity > 0) {
      totalQty = position.quantity;
    } else if (position.invested_amount != null && position.pru != null && position.pru > 0) {
      totalQty = position.invested_amount / position.pru;
    } else if (position.current_value_eur > 0 && sellPriceEur > 0) {
      totalQty = position.current_value_eur / sellPriceEur;
    }

    let fraction = 1;
    let qtySold = totalQty;
    if (mode === "partial" && totalQty > 0) {
      const pNum = Number(partialValue.replace(",", "."));
      if (Number.isFinite(pNum) && pNum > 0) {
        if (partialUnit === "pct") {
          fraction = Math.min(1, pNum / 100);
          qtySold = totalQty * fraction;
        } else if (partialUnit === "qty") {
          qtySold = Math.min(totalQty, pNum);
          fraction = qtySold / totalQty;
        } else {
          const amtEur = sellCurrency === "USD" && eurusdRate > 0 ? pNum / eurusdRate : pNum;
          qtySold = sellPriceEur > 0 ? Math.min(totalQty, amtEur / sellPriceEur) : 0;
          fraction = qtySold / totalQty;
        }
      } else {
        fraction = 0;
        qtySold = 0;
      }
    }

    const remainingQty = Math.max(0, totalQty - qtySold);
    const proceedsEur = validPrice > 0 ? qtySold * sellPriceEur : 0;
    const costSoldEur = position.cost_basis_eur * fraction;
    const pnlEur = proceedsEur - costSoldEur;
    const pnlPct = costSoldEur > 0 ? (pnlEur / costSoldEur) * 100 : null;

    return {
      totalQty,
      qtySold,
      remainingQty,
      fraction,
      proceedsDisplay: convertAmount(proceedsEur, "EUR", displayCurrency),
      pnlDisplay: convertAmount(pnlEur, "EUR", displayCurrency),
      pnlRawEur: pnlEur,
      pnlPct,
    };
  }, [
    position,
    mode,
    partialUnit,
    partialValue,
    sellPrice,
    sellCurrency,
    eurusdRate,
    convertAmount,
    displayCurrency,
  ]);

  if (!open || !position) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const priceNum = Number(sellPrice.replace(",", "."));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Veuillez saisir un prix de vente valide.");
      return;
    }

    const pNum = Number(partialValue.replace(",", "."));
    if (mode === "partial" && (!Number.isFinite(pNum) || pNum <= 0)) {
      setError("Veuillez saisir une quantité, un pourcentage ou un montant à vendre.");
      return;
    }

    setSaving(true);
    try {
      const res = await sellPortfolioPosition(position.id, {
        mode,
        sell_percent: mode === "partial" && partialUnit === "pct" ? Math.min(100, pNum) : undefined,
        sell_quantity: mode === "partial" && partialUnit === "qty" ? pNum : undefined,
        sell_amount: mode === "partial" && partialUnit === "amount" ? pNum : undefined,
        sell_price: priceNum,
        sell_currency: sellCurrency,
        sale_date: saleDate.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSold?.(res);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement de la vente.");
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
              Vendre {position.ticker}
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
          {/* Mode de vente */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Mode de vente
            </label>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setMode("full")}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  mode === "full"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 dark:text-slate-400"
                )}
              >
                Vente totale (100 %)
              </button>
              <button
                type="button"
                onClick={() => setMode("partial")}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  mode === "partial"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-600 dark:text-slate-400"
                )}
              >
                Vente partielle
              </button>
            </div>
          </div>

          {mode === "partial" && (
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  {[25, 50, 75].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        setPartialUnit("pct");
                        setPartialValue(String(pct));
                      }}
                      className={cn(
                        "rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer",
                        partialUnit === "pct" && Number(partialValue) === pct
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200"
                      )}
                    >
                      {pct} %
                    </button>
                  ))}
                </div>

                <div className="flex rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-800">
                  {(
                    [
                      { id: "pct", label: "%" },
                      { id: "qty", label: "Qté" },
                      { id: "amount", label: sellCurrency === "USD" ? "$" : "€" },
                    ] as const
                  ).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setPartialUnit(u.id)}
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[11px] font-semibold cursor-pointer",
                        partialUnit === u.id
                          ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                          : "text-slate-500 dark:text-slate-400"
                      )}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="number"
                step="any"
                min="0"
                value={partialValue}
                onChange={(e) => setPartialValue(e.target.value)}
                placeholder={
                  partialUnit === "pct"
                    ? "Ex : 50"
                    : partialUnit === "qty"
                    ? "Nombre de titres"
                    : `Montant (${sellCurrency})`
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          )}

          {/* Prix de vente + Devise + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Prix de vente
                </label>
                <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                  {(["EUR", "USD"] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => handleCurrencyToggle(cur)}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] font-bold cursor-pointer",
                        sellCurrency === cur
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
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Date de vente
              </label>
              <input
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
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
              placeholder="Prise de profits, rééquilibrage..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {preview && preview.qtySold > 0 && (
            <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/50">
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Quantité vendue / restante :</span>
                <span className="font-semibold tabular-nums">
                  {preview.qtySold.toFixed(4).replace(/\.?0+$/, "")} /{" "}
                  {preview.remainingQty.toFixed(4).replace(/\.?0+$/, "")}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-300">
                <span>Montant encaissé :</span>
                <span className="font-semibold tabular-nums">
                  {formatPrice(preview.proceedsDisplay, displayCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-300">+/- Value réalisée estimée :</span>
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    preview.pnlRawEur >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {preview.pnlRawEur > 0 ? "+" : ""}
                  {formatPrice(preview.pnlDisplay, displayCurrency)}
                  {isValidNumber(preview.pnlPct) &&
                    ` (${formatPercent(preview.pnlPct, { signed: true })})`}
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
              <span>Confirmer la vente</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
