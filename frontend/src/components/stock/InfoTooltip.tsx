"use client";

import { useState } from "react";
import { Info } from "lucide-react";

export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={text}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-slate-200 bg-slate-900 px-3 py-2 text-[11px] font-normal leading-snug text-white shadow-lg dark:border-slate-700 dark:bg-slate-800 sm:w-80">
          {text}
        </span>
      )}
    </span>
  );
}
