"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History, Receipt, Trash2 } from "lucide-react";
import { useDisplayCurrency } from "@/components/layout/CurrencyProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateFR, formatPercent, formatPrice } from "@/lib/formatters";
import type { PortfolioSaleItem } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ClosedSalesSectionProps {
  sales: PortfolioSaleItem[];
  totalRealizedPnlEur: number;
  onDeleteSale: (sale: PortfolioSaleItem) => void;
}

export function ClosedSalesSection({
  sales,
  totalRealizedPnlEur,
  onDeleteSale,
}: ClosedSalesSectionProps) {
  const [expanded, setExpanded] = useState(sales.length > 0 && sales.length <= 8);
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [flatTaxPct, setFlatTaxPct] = useState<number>(31.4);
  const { displayCurrency, convertAmount } = useDisplayCurrency();
  const convEur = (v: number) => convertAmount(v, "EUR", displayCurrency) ?? v;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = Number(window.localStorage.getItem("finscope_flat_tax_pct"));
      if (Number.isFinite(saved) && saved >= 0 && saved <= 60) {
        setFlatTaxPct(saved);
      }
    }
  }, []);

  const handleFlatTaxChange = (nextVal: string) => {
    const num = Number(nextVal.replace(",", "."));
    if (!Number.isFinite(num)) return;
    const clamped = Math.max(0, Math.min(60, num));
    setFlatTaxPct(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("finscope_flat_tax_pct", String(clamped));
    }
  };

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const s of sales) {
      const y = (s.sale_date || "").slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [sales]);

  const filteredSales = useMemo(() => {
    if (selectedYear === "ALL") return sales;
    return sales.filter((s) => (s.sale_date || "").startsWith(selectedYear));
  }, [sales, selectedYear]);

  const taxSummary = useMemo(() => {
    let ctoGains = 0;
    let ctoLosses = 0;
    let peaNet = 0;
    let ctoProceeds = 0;
    let ctoCost = 0;

    for (const s of filteredSales) {
      if (s.envelope === "PEA") {
        peaNet += s.realized_pnl_eur;
      } else {
        ctoProceeds += s.proceeds_eur;
        ctoCost += s.cost_basis_eur;
        if (s.realized_pnl_eur >= 0) ctoGains += s.realized_pnl_eur;
        else ctoLosses += Math.abs(s.realized_pnl_eur);
      }
    }

    const ctoNet = ctoGains - ctoLosses;
    const taxableCto = Math.max(0, ctoNet);
    const carryforwardLoss = ctoNet < 0 ? Math.abs(ctoNet) : 0;
    const estimatedTaxEur = taxableCto * (flatTaxPct / 100);
    const ctoAfterTaxEur = ctoNet - estimatedTaxEur;

    return {
      ctoGains,
      ctoLosses,
      ctoNet,
      ctoProceeds,
      ctoCost,
      estimatedTaxEur,
      ctoAfterTaxEur,
      carryforwardLoss,
      peaNet,
    };
  }, [filteredSales, flatTaxPct]);

  const totalPositive = totalRealizedPnlEur >= 0;

  return (
    <Card>
      <CardHeader
        className="flex flex-row flex-wrap items-center justify-between gap-3 py-4 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
          <History className="h-4 w-4 text-slate-500" />
          <CardTitle className="text-base">
            Historique des ventes & Synthèse fiscale CTO ({sales.length})
          </CardTitle>
        </div>

        {sales.length > 0 && (
          <Badge variant={totalPositive ? "emerald" : "coral"} className="tabular-nums font-semibold">
            Plus-value réalisée totale : {totalRealizedPnlEur > 0 ? "+" : ""}
            {formatPrice(convEur(totalRealizedPnlEur), displayCurrency)}
          </Badge>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 p-0">
          {sales.length === 0 ? (
            <div className="border-t border-slate-100 px-6 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              Aucune vente enregistrée pour le moment. Utilisez le bouton &laquo; Vendre &raquo; sur une ligne du portefeuille.
            </div>
          ) : (
            <>
              {/* Fiscal Year Filter & CTO 2074 Summary */}
              <div className="space-y-3 border-t border-slate-100 px-4 pt-4 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      <Receipt className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      Année fiscale :
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedYear("ALL")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                        selectedYear === "ALL"
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                      )}
                    >
                      Toutes
                    </button>
                    {availableYears.map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => setSelectedYear(yr)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                          selectedYear === yr
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                        )}
                      >
                        {yr}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <label className="text-slate-500 dark:text-slate-400">Flat Tax CTO (%) :</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="60"
                      value={flatTaxPct}
                      onChange={(e) => handleFlatTaxChange(e.target.value)}
                      className="w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-right font-semibold tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs sm:grid-cols-3 lg:grid-cols-5 dark:border-slate-800 dark:bg-slate-950/40">
                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">PV / MV nette CTO</p>
                    <p
                      className={cn(
                        "mt-0.5 font-bold tabular-nums",
                        taxSummary.ctoNet >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {taxSummary.ctoNet > 0 ? "+" : ""}
                      {formatPrice(convEur(taxSummary.ctoNet), displayCurrency)}
                    </p>
                    <p className="text-[10px] tabular-nums text-slate-400">
                      Gains {formatPrice(convEur(taxSummary.ctoGains), displayCurrency)} · Pertes{" "}
                      {formatPrice(convEur(taxSummary.ctoLosses), displayCurrency)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {taxSummary.carryforwardLoss > 0 ? "Moins-value reportable" : "Impôt estimé (PFU)"}
                    </p>
                    {taxSummary.carryforwardLoss > 0 ? (
                      <>
                        <p className="mt-0.5 font-bold tabular-nums text-amber-600 dark:text-amber-400">
                          {formatPrice(convEur(taxSummary.carryforwardLoss), displayCurrency)}
                        </p>
                        <p className="text-[10px] text-slate-400">Reportable 10 ans (2074)</p>
                      </>
                    ) : (
                      <>
                        <p className="mt-0.5 font-bold tabular-nums text-rose-600 dark:text-rose-400">
                          -{formatPrice(convEur(taxSummary.estimatedTaxEur), displayCurrency)}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          Taux {flatTaxPct.toFixed(1).replace(".", ",")} % sur CTO
                        </p>
                      </>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Net CTO après impôt</p>
                    <p
                      className={cn(
                        "mt-0.5 font-bold tabular-nums",
                        taxSummary.ctoAfterTaxEur >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {taxSummary.ctoAfterTaxEur > 0 ? "+" : ""}
                      {formatPrice(convEur(taxSummary.ctoAfterTaxEur), displayCurrency)}
                    </p>
                    <p className="text-[10px] text-slate-400">Reste en poche</p>
                  </div>

                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Cessions CTO (2074)</p>
                    <p className="mt-0.5 font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                      {formatPrice(convEur(taxSummary.ctoProceeds), displayCurrency)}
                    </p>
                    <p className="text-[10px] tabular-nums text-slate-400">
                      Prix d&apos;acquis. {formatPrice(convEur(taxSummary.ctoCost), displayCurrency)}
                    </p>
                  </div>

                  <div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">PV réalisée PEA</p>
                    <p
                      className={cn(
                        "mt-0.5 font-bold tabular-nums",
                        taxSummary.peaNet >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {taxSummary.peaNet > 0 ? "+" : ""}
                      {formatPrice(convEur(taxSummary.peaNet), displayCurrency)}
                    </p>
                    <p className="text-[10px] text-slate-400">0 % IR tant que dans le PEA</p>
                  </div>
                </div>
              </div>

              {/* Mobile card view */}
              <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800/80">
                {filteredSales.map((sale) => {
                  const pnlPos = sale.realized_pnl_eur >= 0;
                  return (
                    <div key={sale.id} className="space-y-2 px-4 py-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/stock/${encodeURIComponent(sale.ticker)}`}
                              className="font-bold text-slate-900 dark:text-white"
                            >
                              {sale.ticker}
                            </Link>
                            <Badge variant={sale.envelope === "PEA" ? "emerald" : "outline"}>
                              {sale.envelope}
                            </Badge>
                            <Badge variant={sale.is_full_sale ? "secondary" : "amber"}>
                              {sale.is_full_sale ? "Totale" : "Partielle"}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-slate-400">{formatDateFR(sale.sale_date)}</p>
                        </div>
                        <div className="text-right tabular-nums">
                          <p
                            className={cn(
                              "font-bold",
                              pnlPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {sale.realized_pnl_eur > 0 ? "+" : ""}
                            {formatPrice(convEur(sale.realized_pnl_eur), displayCurrency)}
                          </p>
                          {sale.realized_pnl_pct != null && (
                            <p className="text-[11px] text-slate-400">
                              {formatPercent(sale.realized_pnl_pct, { signed: true })}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>
                          {Number(sale.quantity_sold.toFixed(4))} · PRU{" "}
                          {formatPrice(convEur(sale.pru_eur), displayCurrency)} →{" "}
                          {formatPrice(convEur(sale.sell_price_eur), displayCurrency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeleteSale(sale)}
                          className="rounded-lg p-1 text-slate-400 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop table view */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[780px] border-collapse text-xs">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50/80 text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-3 py-3 text-left font-semibold">Titre</th>
                      <th className="px-3 py-3 text-left font-semibold">Type</th>
                      <th className="px-3 py-3 text-right font-semibold">Qté vendue</th>
                      <th className="px-3 py-3 text-right font-semibold">PRU</th>
                      <th className="px-3 py-3 text-right font-semibold">Prix vente</th>
                      <th className="px-3 py-3 text-right font-semibold">Plus-value réalisée</th>
                      <th className="px-4 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {filteredSales.map((sale) => {
                      const pnlPos = sale.realized_pnl_eur >= 0;
                      return (
                        <tr key={sale.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                            {formatDateFR(sale.sale_date)}
                          </td>
                          <td className="px-3 py-3">
                            <Link
                              href={`/stock/${encodeURIComponent(sale.ticker)}`}
                              className="inline-flex items-center gap-1.5 font-bold text-slate-900 hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
                            >
                              <span>{sale.ticker}</span>
                              <Badge variant={sale.envelope === "PEA" ? "emerald" : "outline"}>
                                {sale.envelope}
                              </Badge>
                            </Link>
                            <div className="max-w-[180px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {sale.name}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant={sale.is_full_sale ? "secondary" : "amber"}>
                              {sale.is_full_sale ? "Totale" : "Partielle"}
                            </Badge>
                          </td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-800 dark:text-slate-200">
                            {Number(sale.quantity_sold.toFixed(4))}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatPrice(convEur(sale.pru_eur), displayCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-slate-800 dark:text-slate-200">
                            {formatPrice(convEur(sale.sell_price_eur), displayCurrency)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <div
                              className={cn(
                                "font-semibold",
                                pnlPos
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {sale.realized_pnl_eur > 0 ? "+" : ""}
                              {formatPrice(convEur(sale.realized_pnl_eur), displayCurrency)}
                            </div>
                            {sale.realized_pnl_pct != null && (
                              <div
                                className={cn(
                                  "text-[11px]",
                                  pnlPos
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                )}
                              >
                                {formatPercent(sale.realized_pnl_pct, { signed: true })}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => onDeleteSale(sale)}
                              title="Supprimer cette vente"
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
