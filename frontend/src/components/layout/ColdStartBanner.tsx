"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { subscribeBackendWakeup } from "@/lib/api";

export function ColdStartBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    return subscribeBackendWakeup(setWaking);
  }, []);

  if (!waking) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50/95 px-4 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/70 dark:text-amber-200">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" />
        <span>
          Réveil du serveur en cours (20-30s)... Merci de patienter quelques instants.
        </span>
      </div>
    </div>
  );
}
