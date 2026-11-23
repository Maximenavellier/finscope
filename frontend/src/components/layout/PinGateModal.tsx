"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setStoredAppPin, subscribePinRequired, verifyAppPin } from "@/lib/api";

export function PinGateModal() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return subscribePinRequired((required) => {
      if (required) {
        setOpen(true);
      }
    });
  }, []);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = pin.trim();
    if (!cleaned || checking) return;

    setChecking(true);
    setError(null);
    const ok = await verifyAppPin(cleaned);
    setChecking(false);

    if (!ok) {
      setStoredAppPin("");
      setError("Code PIN incorrect ou serveur inaccessible. Réessayez.");
      return;
    }

    setStoredAppPin(cleaned);
    setOpen(false);
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Accès protégé par PIN
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Saisissez votre code PIN FinScope pour déverrouiller vos données.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type={showPin ? "text" : "password"}
              autoFocus
              autoComplete="current-password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Code PIN..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={() => setShowPin((prev) => !prev)}
              className="absolute inset-y-0 right-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={showPin ? "Masquer le PIN" : "Afficher le PIN"}
            >
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" size="sm" className="w-full" disabled={checking || !pin.trim()}>
            {checking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Vérification...
              </>
            ) : (
              "Déverrouiller FinScope"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
