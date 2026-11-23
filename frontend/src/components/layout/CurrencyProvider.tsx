"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getFxEurUsd, getFxRate } from "@/lib/api";
import { formatCompactNumber, formatPrice, isValidNumber } from "@/lib/formatters";

export type DisplayCurrency = "EUR" | "USD";

interface CurrencyContextValue {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (cur: DisplayCurrency) => void;
  eurusdRate: number;
  fxToEurMap: Record<string, number>;
  registerFxRate: (fromCurrency: string, rateToEur: number) => void;
  ensureFxRate: (fromCurrency?: string | null) => void;
  resolveCurrency: (fromCurrency?: string | null) => string;
  convertAmount: (
    val: number | null | undefined,
    fromCurrency?: string | null,
    targetCurrency?: string
  ) => number | null;
  formatDisplayPrice: (
    val: number | null | undefined,
    fromCurrency?: string | null,
    decimals?: number
  ) => string;
  formatDisplayCompact: (
    val: number | null | undefined,
    fromCurrency?: string | null
  ) => string;
}

const STORAGE_KEY = "finscope-display-currency";

const CurrencyContext = createContext<CurrencyContextValue>({
  displayCurrency: "EUR",
  setDisplayCurrency: () => {},
  eurusdRate: 1.08,
  fxToEurMap: {},
  registerFxRate: () => {},
  ensureFxRate: () => {},
  resolveCurrency: (from) => {
    const f = (from || "EUR").trim().toUpperCase();
    return f === "USD" || f === "EUR" ? "EUR" : f;
  },
  convertAmount: (val) => (isValidNumber(val) ? val : null),
  formatDisplayPrice: (val, from, dec = 2) => formatPrice(val, from || "EUR", dec),
  formatDisplayCompact: (val, from) => formatCompactNumber(val, from || "EUR"),
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>("EUR");
  const [eurusdRate, setEurusdRate] = useState<number>(1.08);
  const [fxToEurMap, setFxToEurMap] = useState<Record<string, number>>({});
  const inflightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "USD" || saved === "EUR") {
        setDisplayCurrencyState(saved);
      }
    } catch {
      // ignore storage errors
    }

    let cancelled = false;
    getFxEurUsd(false)
      .then((res) => {
        if (!cancelled && isValidNumber(res.rate) && res.rate > 0) {
          setEurusdRate(res.rate);
        }
      })
      .catch(() => {
        // keep 1.08 fallback cleanly
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setDisplayCurrency = useCallback((cur: DisplayCurrency) => {
    setDisplayCurrencyState(cur);
    try {
      window.localStorage.setItem(STORAGE_KEY, cur);
    } catch {
      // ignore storage errors
    }
  }, []);

  const registerFxRate = useCallback((fromCurrency: string, rateToEur: number) => {
    const key = fromCurrency.trim();
    if (!key || !isValidNumber(rateToEur) || rateToEur <= 0) return;
    setFxToEurMap((prev) => {
      if (prev[key] === rateToEur) return prev;
      return { ...prev, [key]: rateToEur };
    });
  }, []);

  const findRateToEur = useCallback(
    (fromRaw: string): number | null => {
      const raw = fromRaw.trim();
      const upper = raw.toUpperCase();
      if (upper === "EUR") return 1.0;
      if (upper === "USD") return eurusdRate > 0 ? 1.0 / eurusdRate : null;
      if (isValidNumber(fxToEurMap[raw])) return fxToEurMap[raw];
      if (raw !== upper && isValidNumber(fxToEurMap[upper])) return fxToEurMap[upper];
      return null;
    },
    [eurusdRate, fxToEurMap]
  );

  const ensureFxRate = useCallback(
    (fromCurrency?: string | null) => {
      const raw = (fromCurrency || "").trim();
      if (!raw) return;
      const upper = raw.toUpperCase();
      if (upper === "EUR" || upper === "USD") return;
      if (findRateToEur(raw) !== null || inflightRef.current.has(raw)) return;

      inflightRef.current.add(raw);
      getFxRate(raw, "EUR", false)
        .then((res) => {
          if (isValidNumber(res.rate) && res.rate > 0) {
            registerFxRate(raw, res.rate);
          }
        })
        .catch(() => {
          // ignore silent FX lookup failure
        })
        .finally(() => {
          inflightRef.current.delete(raw);
        });
    },
    [findRateToEur, registerFxRate]
  );

  const resolveCurrency = useCallback(
    (fromCurrency?: string | null): string => {
      const raw = (fromCurrency || "USD").trim();
      const upper = raw.toUpperCase();
      if (upper === "USD" || upper === "EUR") return displayCurrency;
      if (findRateToEur(raw) !== null) return displayCurrency;
      return raw || displayCurrency;
    },
    [displayCurrency, findRateToEur]
  );

  const convertAmount = useCallback(
    (
      val: number | null | undefined,
      fromCurrency?: string | null,
      targetCurrency?: string
    ): number | null => {
      if (!isValidNumber(val)) return null;
      const fromRaw = (fromCurrency || "USD").trim();
      const fromUpper = fromRaw.toUpperCase();
      const to = (targetCurrency || displayCurrency).trim().toUpperCase();
      if (fromRaw === to || (fromUpper === to && fromRaw !== "GBp" && fromRaw !== "GBX")) {
        return val;
      }

      const toEur = findRateToEur(fromRaw);
      if (toEur !== null && toEur > 0) {
        const eurVal = val * toEur;
        if (to === "EUR") return eurVal;
        if (to === "USD") return eurVal * eurusdRate;
      }
      return val;
    },
    [displayCurrency, eurusdRate, findRateToEur]
  );

  const formatDisplayPrice = useCallback(
    (val: number | null | undefined, fromCurrency?: string | null, decimals = 2): string => {
      const converted = convertAmount(val, fromCurrency);
      return formatPrice(converted, resolveCurrency(fromCurrency), decimals);
    },
    [convertAmount, resolveCurrency]
  );

  const formatDisplayCompact = useCallback(
    (val: number | null | undefined, fromCurrency?: string | null): string => {
      const converted = convertAmount(val, fromCurrency);
      return formatCompactNumber(converted, resolveCurrency(fromCurrency));
    },
    [convertAmount, resolveCurrency]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({
      displayCurrency,
      setDisplayCurrency,
      eurusdRate,
      fxToEurMap,
      registerFxRate,
      ensureFxRate,
      resolveCurrency,
      convertAmount,
      formatDisplayPrice,
      formatDisplayCompact,
    }),
    [
      displayCurrency,
      setDisplayCurrency,
      eurusdRate,
      fxToEurMap,
      registerFxRate,
      ensureFxRate,
      resolveCurrency,
      convertAmount,
      formatDisplayPrice,
      formatDisplayCompact,
    ]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useDisplayCurrency() {
  return useContext(CurrencyContext);
}
