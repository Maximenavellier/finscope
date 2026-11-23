"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, Search } from "lucide-react";
import { searchAssets } from "@/lib/api";
import type { SearchAssetItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESET_DUELS: { a: string; b: string; label: string }[] = [
  { a: "NVDA", b: "AMD", label: "NVDA vs AMD" },
  { a: "GOOGL", b: "MSFT", label: "GOOGL vs MSFT" },
  { a: "LLY", b: "NVO", label: "LLY vs NVO" },
  { a: "ASML.AS", b: "LRCX", label: "ASML.AS vs LRCX" },
  { a: "CW8.PA", b: "ESE.PA", label: "CW8.PA vs ESE.PA" },
];

interface SlotSearchInputProps {
  slotLabel: string;
  accent: "blue" | "violet";
  ticker: string;
  companyName?: string | null;
  loading?: boolean;
  onSelect: (ticker: string) => void;
}

function SlotSearchInput({
  slotLabel,
  accent,
  ticker,
  companyName,
  loading,
  onSelect,
}: SlotSearchInputProps) {
  const [query, setQuery] = useState(ticker);
  const [suggestions, setSuggestions] = useState<SearchAssetItem[]>([]);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    setQuery(ticker);
    setSuggestions([]);
  }, [ticker]);

  useEffect(() => {
    if (!focused) return;
    const q = query.trim();
    if (q.length < 2 || q.toUpperCase() === ticker.toUpperCase()) {
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
  }, [query, ticker, focused]);

  const commit = (sym: string) => {
    const cleaned = sym.trim().toUpperCase();
    if (!cleaned) return;
    setSuggestions([]);
    setFocused(false);
    setQuery(cleaned);
    onSelect(cleaned);
  };

  const badgeStyle =
    accent === "blue"
      ? "bg-blue-600 text-white"
      : "bg-violet-600 text-white";

  const borderAccent =
    accent === "blue"
      ? "border-blue-200 focus-within:border-blue-500 dark:border-blue-900/60"
      : "border-violet-200 focus-within:border-violet-500 dark:border-violet-900/60";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (suggestions.length > 0 && query.trim().toUpperCase() !== suggestions[0].ticker) {
          commit(suggestions[0].ticker);
        } else {
          commit(query);
        }
      }}
      className="relative flex-1 min-w-0"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", badgeStyle)}>
          {slotLabel}
        </span>
        {companyName && (
          <span className="truncate text-xs text-slate-500 dark:text-slate-400">
            {companyName}
          </span>
        )}
      </div>

      <div
        className={cn(
          "flex h-10 items-center gap-2 rounded-xl border bg-white px-3 transition-colors dark:bg-slate-900",
          borderAccent
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          type="text"
          value={query}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setTimeout(() => setFocused(false), 160);
          }}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          placeholder="Ticker ou nom (ex: NVDA, Eli Lilly...)"
          className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none dark:text-white"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />}
      </div>

      {focused && suggestions.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {suggestions.map((s) => (
            <li key={s.ticker}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(s.ticker);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <span className="truncate">
                  <strong className="text-slate-900 dark:text-white">{s.ticker}</strong>{" "}
                  <span className="text-slate-500 dark:text-slate-400">— {s.name}</span>
                </span>
                <span className="ml-2 shrink-0 text-[10px] font-semibold text-slate-400">
                  {s.asset_type === "ETF" ? "ETF" : s.region}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

interface CompareSelectorBarProps {
  tickerA: string;
  tickerB: string;
  nameA?: string | null;
  nameB?: string | null;
  loadingA?: boolean;
  loadingB?: boolean;
  onChangeA: (ticker: string) => void;
  onChangeB: (ticker: string) => void;
  onSwap: () => void;
  onSelectPreset: (a: string, b: string) => void;
}

export function CompareSelectorBar({
  tickerA,
  tickerB,
  nameA,
  nameB,
  loadingA,
  loadingB,
  onChangeA,
  onChangeB,
  onSwap,
  onSelectPreset,
}: CompareSelectorBarProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <SlotSearchInput
          slotLabel="Action A"
          accent="blue"
          ticker={tickerA}
          companyName={nameA}
          loading={loadingA}
          onSelect={onChangeA}
        />

        <div className="flex justify-center md:pb-1">
          <button
            type="button"
            onClick={onSwap}
            title="Inverser A et B"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 cursor-pointer"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
        </div>

        <SlotSearchInput
          slotLabel="Action B"
          accent="violet"
          ticker={tickerB}
          companyName={nameB}
          loading={loadingB}
          onSelect={onChangeB}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Duels rapides :
        </span>
        {PRESET_DUELS.map((d) => {
          const active =
            tickerA.toUpperCase() === d.a && tickerB.toUpperCase() === d.b;
          return (
            <button
              key={d.label}
              type="button"
              onClick={() => onSelectPreset(d.a, d.b)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer",
                active
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              )}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
