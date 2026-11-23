export function isValidNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

export function formatDateFR(isoDate?: string | null): string {
  if (!isoDate) return "—";
  const cleaned = String(isoDate).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(cleaned);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const dt = new Date(cleaned);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  return cleaned;
}

export function formatMonthYearFR(val?: string | null): string {
  if (!val) return "—";
  const cleaned = String(val).trim();
  if (cleaned === "TTM" || /^\d{4}$/.test(cleaned)) return cleaned;
  const match = /^(\d{4})-(\d{2})/.exec(cleaned);
  if (match) {
    return `${match[2]}/${match[1]}`;
  }
  return cleaned;
}

export function currencySymbol(currency?: string | null): string {
  const raw = (currency || "USD").trim();
  if (raw === "GBp" || raw === "GBX") return "p";
  if (raw === "ZAc") return "c";
  switch (raw.toUpperCase()) {
    case "EUR":
      return "€";
    case "USD":
      return "$";
    case "GBP":
      return "£";
    case "CHF":
      return "CHF";
    case "JPY":
      return "¥";
    case "DKK":
      return "DKK";
    case "SEK":
      return "SEK";
    case "NOK":
      return "NOK";
    case "CAD":
      return "CA$";
    case "HKD":
      return "HK$";
    case "AUD":
      return "A$";
    default:
      return raw || "";
  }
}

export function formatPrice(val: number | null | undefined, currency?: string | null, decimals = 2): string {
  if (!isValidNumber(val)) return "—";
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val);
  const sym = currencySymbol(currency);
  return sym ? `${formatted} ${sym}` : formatted;
}

export function formatCompactNumber(val: number | null | undefined, currency?: string | null): string {
  if (!isValidNumber(val)) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  const sym = currency ? ` ${currencySymbol(currency)}` : "";

  if (abs >= 1e12) {
    return `${sign}${(abs / 1e12).toFixed(2).replace(".", ",")} T${sym}`;
  }
  if (abs >= 1e9) {
    return `${sign}${(abs / 1e9).toFixed(2).replace(".", ",")} Md${sym}`;
  }
  if (abs >= 1e6) {
    return `${sign}${(abs / 1e6).toFixed(1).replace(".", ",")} M${sym}`;
  }
  if (abs >= 1e3) {
    return `${sign}${(abs / 1e3).toFixed(1).replace(".", ",")} k${sym}`;
  }
  return `${sign}${abs.toFixed(2).replace(".", ",")}${sym}`;
}

export function formatPercent(
  val: number | null | undefined,
  options?: { isDecimal?: boolean; signed?: boolean; decimals?: number }
): string {
  if (!isValidNumber(val)) return "—";
  const isDecimal = options?.isDecimal ?? false;
  const signed = options?.signed ?? false;
  const decimals = options?.decimals ?? 1;

  const pct = isDecimal ? val * 100 : val;
  const prefix = signed && pct > 0 ? "+" : "";
  return `${prefix}${pct.toFixed(decimals).replace(".", ",")} %`;
}

export function formatMultiple(val: number | null | undefined, decimals = 1): string {
  if (!isValidNumber(val)) return "—";
  return `${val.toFixed(decimals).replace(".", ",")}x`;
}

export function formatRelativeTime(isoDate?: string | null): string {
  if (!isoDate) return "Actualisation inconnue";
  const dt = new Date(isoDate);
  if (Number.isNaN(dt.getTime())) return "Actualisation inconnue";

  const diffSec = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  if (diffSec < 60) return "Mis à jour à l'instant";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Mis à jour il y a ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Mis à jour il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Mis à jour il y a ${diffDays} j`;
}

export function getToneClasses(tone?: string | null) {
  switch (tone) {
    case "emerald":
      return {
        text: "text-emerald-600 dark:text-emerald-400",
        bg: "bg-emerald-50 dark:bg-emerald-950/40",
        border: "border-emerald-200 dark:border-emerald-800/60",
        stroke: "#10B981",
        badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
      };
    case "coral":
      return {
        text: "text-rose-600 dark:text-rose-400",
        bg: "bg-rose-50 dark:bg-rose-950/40",
        border: "border-rose-200 dark:border-rose-800/60",
        stroke: "#F43F5E",
        badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200 dark:border-rose-800",
      };
    default:
      return {
        text: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-50 dark:bg-amber-950/40",
        border: "border-amber-200 dark:border-amber-800/60",
        stroke: "#F59E0B",
        badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800",
      };
  }
}
