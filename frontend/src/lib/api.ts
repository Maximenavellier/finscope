import type {
  AnalystsResponse,
  DcaPlanResponse,
  DcaSettings,
  FairValueResponse,
  FundamentalsResponse,
  FxRateResponse,
  OpportunityRadarResponse,
  PeerOverridesResponse,
  PeersComparisonResponse,
  PortfolioBackupPayload,
  PortfolioDashboardResponse,
  PortfolioPerformanceResponse,
  PortfolioPositionItem,
  PortfolioRestoreResponse,
  PortfolioSellResponse,
  PriceHistoryResponse,
  ProjectionDefaultsResponse,
  ProjectionRequest,
  ProjectionResponse,
  ScoreHistoryResponse,
  ScreenerQueryParams,
  ScreenerResponse,
  SearchResponse,
  SeedStatusResponse,
  SegmentsResponse,
  StockNewsResponse,
  StockOverviewResponse,
  SurprisesResponse,
  SystemStatusResponse,
  WatchlistItemEnriched,
  WatchlistResponse,
} from "./types";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 55_000;
const COLD_START_THRESHOLD_MS = 3_000;
const RETRY_DELAY_MS = 2_500;

type WakeupListener = (waking: boolean) => void;
const wakeupListeners = new Set<WakeupListener>();
let slowRequestCount = 0;

type PinListener = (required: boolean) => void;
const pinListeners = new Set<PinListener>();

function notifyWakeup() {
  const waking = slowRequestCount > 0;
  for (const listener of wakeupListeners) {
    listener(waking);
  }
}

export function subscribeBackendWakeup(listener: WakeupListener): () => void {
  wakeupListeners.add(listener);
  listener(slowRequestCount > 0);
  return () => {
    wakeupListeners.delete(listener);
  };
}

export function subscribePinRequired(listener: PinListener): () => void {
  pinListeners.add(listener);
  return () => {
    pinListeners.delete(listener);
  };
}

export function setStoredAppPin(pin: string) {
  if (typeof window !== "undefined") {
    if (pin.trim()) {
      window.localStorage.setItem("finscope_pin", pin.trim());
    } else {
      window.localStorage.removeItem("finscope_pin");
    }
  }
}

export async function verifyAppPin(pin: string): Promise<boolean> {
  const cleaned = pin.trim();
  if (!cleaned) return false;
  try {
    const res = await fetch(`${API_BASE}/api/auth/verify`, {
      method: "GET",
      headers: { "X-App-Pin": cleaned },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

function getAppPin(): string {
  if (process.env.NEXT_PUBLIC_APP_PIN) {
    return process.env.NEXT_PUBLIC_APP_PIN;
  }
  if (typeof window !== "undefined") {
    return window.localStorage.getItem("finscope_pin") || "";
  }
  return "";
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeFetch<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let markedSlow = false;
  const slowTimer = setTimeout(() => {
    markedSlow = true;
    slowRequestCount += 1;
    notifyWakeup();
  }, COLD_START_THRESHOLD_MS);

  try {
    const headers = new Headers(init?.headers || {});
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }
    const pin = getAppPin();
    if (pin) {
      headers.set("X-App-Pin", pin);
    }

    const res = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if ([502, 503, 504].includes(res.status) && allowRetry) {
      await sleep(RETRY_DELAY_MS);
      return executeFetch<T>(path, init, false);
    }

    if (!res.ok) {
      if (res.status === 401) {
        for (const listener of pinListeners) {
          listener(true);
        }
      }
      let detail = `Erreur serveur (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson?.detail) detail = String(errJson.detail);
      } catch {
        // ignore JSON parse error
      }
      throw new Error(detail);
    }

    return (await res.json()) as T;
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const isNetwork = err instanceof TypeError;
    if ((isNetwork || isAbort) && allowRetry) {
      await sleep(RETRY_DELAY_MS);
      return executeFetch<T>(path, init, false);
    }
    if (isAbort) {
      throw new Error("Le serveur met trop de temps à répondre (démarrage à froid en cours). Réessayez dans un instant.");
    }
    if (isNetwork) {
      throw new Error("Impossible de joindre l'API backend. Vérifiez que le serveur FastAPI est démarré.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(slowTimer);
    if (markedSlow) {
      slowRequestCount = Math.max(0, slowRequestCount - 1);
      notifyWakeup();
    }
  }
}

export async function searchAssets(query: string, limit = 12): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return executeFetch<SearchResponse>(`/api/search?${params.toString()}`);
}

export async function getFxEurUsd(refresh = false): Promise<FxRateResponse> {
  return executeFetch<FxRateResponse>(`/api/fx/eurusd?refresh=${refresh}`);
}

export async function getFxRate(
  fromCurrency: string,
  toCurrency = "EUR",
  refresh = false
): Promise<FxRateResponse> {
  const params = new URLSearchParams({
    from: fromCurrency,
    to: toCurrency,
    refresh: String(refresh),
  });
  return executeFetch<FxRateResponse>(`/api/fx/rate?${params.toString()}`);
}

export async function getStockOverview(ticker: string, refresh = false): Promise<StockOverviewResponse> {
  return executeFetch<StockOverviewResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/overview?refresh=${refresh}`
  );
}

export async function getStockPrices(
  ticker: string,
  period = "MAX",
  currency?: string,
  refresh = false
): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({ period, refresh: String(refresh) });
  if (currency) params.set("currency", currency);
  return executeFetch<PriceHistoryResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/prices?${params.toString()}`
  );
}

export async function getStockFundamentals(
  ticker: string,
  frequency: "annual" | "quarterly" = "annual",
  perShare = false,
  refresh = false
): Promise<FundamentalsResponse> {
  const params = new URLSearchParams({
    frequency,
    per_share: String(perShare),
    refresh: String(refresh),
  });
  return executeFetch<FundamentalsResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/fundamentals?${params.toString()}`
  );
}

export async function getStockSurprises(ticker: string, refresh = false): Promise<SurprisesResponse> {
  return executeFetch<SurprisesResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/surprises?refresh=${refresh}`
  );
}

export async function getStockSegments(ticker: string, refresh = false): Promise<SegmentsResponse> {
  return executeFetch<SegmentsResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/segments?refresh=${refresh}`
  );
}

export async function getStockNews(
  ticker: string,
  limit = 5,
  refresh = false
): Promise<StockNewsResponse> {
  return executeFetch<StockNewsResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/news?limit=${limit}&refresh=${refresh}`
  );
}

export async function getStockScoreHistory(
  ticker: string,
  refresh = false
): Promise<ScoreHistoryResponse> {
  return executeFetch<ScoreHistoryResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/score-history?refresh=${refresh}`
  );
}

export async function getStockPeers(
  ticker: string,
  options?: { extra?: string[]; exclude?: string[]; refresh?: boolean }
): Promise<PeersComparisonResponse> {
  const params = new URLSearchParams();
  if (options?.extra?.length) params.set("extra", options.extra.join(","));
  if (options?.exclude?.length) params.set("exclude", options.exclude.join(","));
  if (options?.refresh) params.set("refresh", "true");
  const qs = params.toString();
  return executeFetch<PeersComparisonResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/peers${qs ? `?${qs}` : ""}`
  );
}

export async function updatePeerOverride(
  ticker: string,
  peerTicker: string | null,
  action: "ADD" | "EXCLUDE" | "REMOVE" | "RESET"
): Promise<PeerOverridesResponse> {
  return executeFetch<PeerOverridesResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/peers/overrides`,
    {
      method: "PUT",
      body: JSON.stringify({ peer_ticker: peerTicker, action }),
    }
  );
}

export async function postFairValue(
  ticker: string,
  body: {
    expected_growth_pct: number;
    exit_multiple: number;
    required_return_pct: number;
    horizon_years?: number;
    metric_used?: "FCF" | "EPS";
  }
): Promise<FairValueResponse> {
  return executeFetch<FairValueResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/fair-value`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  );
}

export async function getPortfolio(refresh = false): Promise<PortfolioDashboardResponse> {
  return executeFetch<PortfolioDashboardResponse>(`/api/portfolio?refresh=${refresh}`);
}

export async function savePortfolioCash(cash_eur: number): Promise<{ cash_eur: number }> {
  return executeFetch<{ cash_eur: number }>("/api/portfolio/cash", {
    method: "PUT",
    body: JSON.stringify({ cash_eur }),
  });
}

export async function getPortfolioPerformance(
  period = "1Y",
  benchmark = "^GSPC",
  currency = "EUR",
  mode: "real" | "backtest" = "real",
  refresh = false
): Promise<PortfolioPerformanceResponse> {
  const params = new URLSearchParams({
    period,
    benchmark,
    currency,
    mode,
    refresh: String(refresh),
  });
  return executeFetch<PortfolioPerformanceResponse>(`/api/portfolio/performance?${params.toString()}`);
}

export async function createPortfolioPosition(body: {
  ticker: string;
  asset_type?: "EQUITY" | "ETF";
  envelope: "PEA" | "CTO";
  quantity?: number;
  pru?: number;
  invested_amount?: number;
  currency?: string;
  purchase_date?: string;
  fees_eur?: number;
  notes?: string;
}): Promise<PortfolioPositionItem> {
  return executeFetch<PortfolioPositionItem>("/api/portfolio/positions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updatePortfolioPosition(
  positionId: number,
  body: {
    asset_type?: "EQUITY" | "ETF";
    envelope?: "PEA" | "CTO";
    quantity?: number;
    pru?: number;
    invested_amount?: number;
    clear_quantity_pru?: boolean;
    currency?: string;
    purchase_date?: string;
    fees_eur?: number;
    notes?: string;
  }
): Promise<PortfolioPositionItem> {
  return executeFetch<PortfolioPositionItem>(`/api/portfolio/positions/${positionId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function reinforcePortfolioPosition(
  positionId: number,
  body: {
    amount?: number;
    quantity?: number;
    price: number;
    currency: "EUR" | "USD";
    purchase_date?: string;
    fees_eur?: number;
    notes?: string;
  }
): Promise<PortfolioPositionItem> {
  return executeFetch<PortfolioPositionItem>(`/api/portfolio/positions/${positionId}/reinforce`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function sellPortfolioPosition(
  positionId: number,
  body: {
    mode: "full" | "partial";
    sell_percent?: number;
    sell_quantity?: number;
    sell_amount?: number;
    sell_price: number;
    sell_currency: "EUR" | "USD";
    sale_date?: string;
    notes?: string;
  }
): Promise<PortfolioSellResponse> {
  return executeFetch<PortfolioSellResponse>(`/api/portfolio/positions/${positionId}/sell`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deletePortfolioPosition(positionId: number): Promise<{ deleted: boolean; id: number }> {
  return executeFetch<{ deleted: boolean; id: number }>(`/api/portfolio/positions/${positionId}`, {
    method: "DELETE",
  });
}

export async function deletePortfolioSale(saleId: number): Promise<{ deleted: boolean; id: number }> {
  return executeFetch<{ deleted: boolean; id: number }>(`/api/portfolio/sales/${saleId}`, {
    method: "DELETE",
  });
}

export async function getWatchlist(refresh = false): Promise<WatchlistResponse> {
  return executeFetch<WatchlistResponse>(`/api/watchlist?refresh=${refresh}`);
}

export async function upsertWatchlistItem(body: {
  ticker: string;
  target_price?: number;
  target_currency?: string;
  notes?: string;
}): Promise<WatchlistItemEnriched> {
  return executeFetch<WatchlistItemEnriched>("/api/watchlist", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateWatchlistItem(
  itemId: number,
  body: {
    target_price?: number;
    clear_target?: boolean;
    target_currency?: string;
    notes?: string;
  }
): Promise<WatchlistItemEnriched> {
  return executeFetch<WatchlistItemEnriched>(`/api/watchlist/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteWatchlistItem(itemId: number): Promise<{ deleted: boolean; id: number }> {
  return executeFetch<{ deleted: boolean; id: number }>(`/api/watchlist/${itemId}`, {
    method: "DELETE",
  });
}

export async function deleteWatchlistByTicker(ticker: string): Promise<{ deleted: boolean; ticker: string }> {
  return executeFetch<{ deleted: boolean; ticker: string }>(
    `/api/watchlist/by-ticker/${encodeURIComponent(ticker)}`,
    { method: "DELETE" }
  );
}

export async function getScreener(params: ScreenerQueryParams = {}): Promise<ScreenerResponse> {
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null || val === "") continue;
    qs.set(key, String(val));
  }
  const query = qs.toString();
  return executeFetch<ScreenerResponse>(`/api/screener${query ? `?${query}` : ""}`);
}

export async function startScreenerSeed(body?: {
  only_missing?: boolean;
  batch_size?: number;
  delay_seconds?: number;
  limit?: number;
}): Promise<SeedStatusResponse> {
  return executeFetch<SeedStatusResponse>("/api/screener/seed", {
    method: "POST",
    body: JSON.stringify(body || { only_missing: true }),
  });
}

export async function getScreenerSeedStatus(): Promise<SeedStatusResponse> {
  return executeFetch<SeedStatusResponse>("/api/screener/seed/status");
}

export async function getStockAnalysts(ticker: string, refresh = false): Promise<AnalystsResponse> {
  return executeFetch<AnalystsResponse>(
    `/api/stocks/${encodeURIComponent(ticker)}/analysts?refresh=${refresh}`
  );
}

export async function getSystemStatus(refresh = false): Promise<SystemStatusResponse> {
  return executeFetch<SystemStatusResponse>(`/api/system/status?refresh=${refresh}`);
}

export async function clearBackendCache(prefix?: string): Promise<{ cleared: number }> {
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return executeFetch<{ cleared: number }>(`/api/system/cache/clear${qs}`, {
    method: "POST",
  });
}

export async function getOpportunityRadar(refresh = false): Promise<OpportunityRadarResponse> {
  return executeFetch<OpportunityRadarResponse>(`/api/portfolio/radar?refresh=${refresh}`);
}

export async function getDcaSettings(): Promise<DcaSettings> {
  return executeFetch<DcaSettings>("/api/portfolio/dca/settings");
}

export async function saveDcaSettings(body: DcaSettings): Promise<DcaSettings> {
  return executeFetch<DcaSettings>("/api/portfolio/dca/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function postDcaPlan(body: {
  amount_eur: number;
  etf_target_pct: number;
  mode: "standard" | "opportunistic";
  save_settings?: boolean;
}): Promise<DcaPlanResponse> {
  return executeFetch<DcaPlanResponse>("/api/portfolio/dca/plan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getProjectionDefaults(refresh = false): Promise<ProjectionDefaultsResponse> {
  return executeFetch<ProjectionDefaultsResponse>(
    `/api/portfolio/projections/defaults?refresh=${refresh}`
  );
}

export async function postProjections(body: ProjectionRequest): Promise<ProjectionResponse> {
  return executeFetch<ProjectionResponse>("/api/portfolio/projections", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadPortfolioCsv(kind: "positions" | "sales"): Promise<void> {
  const pin = getAppPin();
  const headers: Record<string, string> = {};
  if (pin) headers["X-App-Pin"] = pin;

  const res = await fetch(`${API_BASE}/api/portfolio/export/csv?kind=${kind}`, {
    headers,
  });
  if (res.status === 401) {
    for (const listener of pinListeners) {
      listener(true);
    }
  }
  if (!res.ok) {
    throw new Error(`Export CSV impossible (${res.status}).`);
  }
  const blob = await res.blob();
  const today = new Date().toISOString().slice(0, 10);
  triggerBrowserDownload(blob, `finscope-${kind}-${today}.csv`);
}

export async function downloadPortfolioBackup(): Promise<void> {
  const backup = await executeFetch<PortfolioBackupPayload>("/api/portfolio/backup");
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const today = new Date().toISOString().slice(0, 10);
  triggerBrowserDownload(blob, `finscope-backup-${today}.json`);
}

export async function restorePortfolioBackup(
  payload: PortfolioBackupPayload
): Promise<PortfolioRestoreResponse> {
  return executeFetch<PortfolioRestoreResponse>("/api/portfolio/restore", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
