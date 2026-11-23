"use client";

import { useRef, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileJson, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadPortfolioBackup,
  downloadPortfolioCsv,
  restorePortfolioBackup,
} from "@/lib/api";
import type { PortfolioBackupPayload } from "@/lib/types";

interface ExportBackupMenuProps {
  onRestored: () => Promise<void> | void;
  onNotice?: (msg: string, isError?: boolean) => void;
}

export function ExportBackupMenu({ onRestored, onNotice }: ExportBackupMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAction = async (fn: () => Promise<void>, okMessage: string) => {
    setBusy(true);
    setOpen(false);
    try {
      await fn();
      onNotice?.(okMessage, false);
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : "Erreur export / sauvegarde.", true);
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PortfolioBackupPayload;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.positions)) {
        throw new Error("Fichier de sauvegarde JSON invalide.");
      }
      const ok = window.confirm(
        `Restaurer cette sauvegarde (${parsed.positions.length} positions, ${
          (parsed.sales || []).length
        } ventes, ${(parsed.watchlist || []).length} favoris) ? Les données actuelles du portefeuille seront remplacées.`
      );
      if (!ok) return;

      setBusy(true);
      const res = await restorePortfolioBackup(parsed);
      await onRestored();
      onNotice?.(
        `Sauvegarde restaurée : ${res.positions_count} positions, ${res.sales_count} ventes et ${res.watchlist_count} valeurs en watchlist.`,
        false
      );
    } catch (err) {
      onNotice?.(err instanceof Error ? err.message : "Échec de l'import JSON.", true);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleFileChange}
      />

      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Download className="h-3.5 w-3.5" />
        <span>{busy ? "Traitement..." : "Exporter"}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1.5 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() =>
                handleAction(
                  () => downloadPortfolioCsv("positions"),
                  "Export CSV des positions téléchargé."
                )
              }
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
              <div>
                <p className="font-semibold">CSV — Positions actuelles</p>
                <p className="text-[10px] text-slate-400">Quantités, PRU, valeur et +/- latentes</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() =>
                handleAction(
                  () => downloadPortfolioCsv("sales"),
                  "Export CSV des ventes réalisées téléchargé."
                )
              }
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              <FileSpreadsheet className="h-4 w-4 text-blue-600 shrink-0" />
              <div>
                <p className="font-semibold">CSV — Ventes réalisées (Impôts)</p>
                <p className="text-[10px] text-slate-400">Cessions et plus-values CTO / PEA</p>
              </div>
            </button>

            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            <button
              type="button"
              onClick={() =>
                handleAction(
                  () => downloadPortfolioBackup(),
                  "Sauvegarde JSON complète téléchargée."
                )
              }
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              <FileJson className="h-4 w-4 text-violet-600 shrink-0" />
              <div>
                <p className="font-semibold">Sauvegarde JSON complète</p>
                <p className="text-[10px] text-slate-400">Portefeuille, lots, ventes &amp; watchlist</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                fileInputRef.current?.click();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Upload className="h-4 w-4 text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold">Importer une sauvegarde JSON</p>
                <p className="text-[10px] text-slate-400">Restaurer depuis un fichier .json</p>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
