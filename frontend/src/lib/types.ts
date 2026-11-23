export type SemanticTone = "emerald" | "amber" | "coral";

export interface HealthResponse {
  status: string;
  db: string;
  finnhub_configured: boolean;
  fmp_configured: boolean;
  pin_enabled: boolean;
}

export interface FxRateResponse {
  pair: string;
  rate: number;
  fallback: boolean;
  updated_at: string;
  is_stale: boolean;
}

export interface SearchAssetItem {
  ticker: string;
  name: string;
  asset_type: "EQUITY" | "ETF" | string;
  exchange?: string | null;
  region: string;
  pea_eligible: boolean;
  sector?: string | null;
  industry?: string | null;
  logo_url?: string | null;
  price?: number | null;
  score_global?: number | null;
}

export interface SearchResponse {
  query: string;
  results: SearchAssetItem[];
}

export interface StockInfoResponse {
  ticker: string;
  name: string;
  asset_type: "EQUITY" | "ETF" | string;
  exchange?: string | null;
  currency?: string | null;
  country?: string | null;
  region: string;
  pea_eligible: boolean;
  sector?: string | null;
  industry?: string | null;
  website?: string | null;
  logo_url?: string | null;
  description?: string | null;
  price?: number | null;
  previous_close?: number | null;
  day_change?: number | null;
  day_change_pct?: number | null;
  change_1y_pct?: number | null;
  market_cap?: number | null;
  enterprise_value?: number | null;
  shares_outstanding?: number | null;
  pe?: number | null;
  forward_pe?: number | null;
  peg?: number | null;
  price_to_book?: number | null;
  ev_to_ebitda?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
  fifty_two_week_high?: number | null;
  fifty_two_week_low?: number | null;
  analyst_target_price?: number | null;
  recommendation_key?: string | null;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
  roe?: number | null;
  roa?: number | null;
  expense_ratio?: number | null;
  total_assets?: number | null;
  fund_family?: string | null;
  category?: string | null;
  next_earnings_date?: string | null;
  days_until_earnings?: number | null;
  fx_to_eur_rate?: number | null;
  price_eur?: number | null;
  updated_at: string;
  is_stale: boolean;
}

export interface PricePoint {
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number;
  volume?: number | null;
  mm50?: number | null;
  mm200?: number | null;
}

export interface SplitEvent {
  date: string;
  ratio: number;
}

export interface PriceHistoryResponse {
  ticker: string;
  period: string;
  native_currency: string;
  currency: string;
  fx_rate_applied: number;
  perf_pct?: number | null;
  cagr_pct?: number | null;
  max_drawdown_pct?: number | null;
  annualized_volatility_pct?: number | null;
  points: PricePoint[];
  splits: SplitEvent[];
  updated_at: string;
  is_stale: boolean;
}

export interface FundamentalRecord {
  period_end: string;
  fiscal_year?: number | null;
  revenue?: number | null;
  gross_profit?: number | null;
  operating_income?: number | null;
  net_income?: number | null;
  ebitda?: number | null;
  operating_cash_flow?: number | null;
  capex?: number | null;
  free_cash_flow?: number | null;
  eps?: number | null;
  shares_outstanding?: number | null;
  cash?: number | null;
  total_debt?: number | null;
  net_debt?: number | null;
  total_equity?: number | null;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
  roe?: number | null;
  roic?: number | null;
  fcf_conversion?: number | null;
  net_debt_ebitda?: number | null;
  debt_to_equity?: number | null;
  current_ratio?: number | null;
  revenue_per_share?: number | null;
  fcf_per_share?: number | null;
  net_income_per_share?: number | null;
  cash_per_share?: number | null;
  total_debt_per_share?: number | null;
}

export interface HistoricalMultiple {
  period_end: string;
  fiscal_year?: number | null;
  price_at_period_end?: number | null;
  pe?: number | null;
  p_fcf?: number | null;
  ev_ebitda?: number | null;
}

export interface AnalystEstimatePoint {
  avg?: number | null;
  low?: number | null;
  high?: number | null;
  growth?: number | null;
}

export interface DividendAnnualPoint {
  year: number;
  dividend_per_share: number;
}

export interface FundamentalsResponse {
  ticker: string;
  available: boolean;
  reason?: string | null;
  currency?: string | null;
  frequency: "annual" | "quarterly" | string;
  per_share: boolean;
  series: FundamentalRecord[];
  annual: FundamentalRecord[];
  quarterly: FundamentalRecord[];
  ttm?: FundamentalRecord | null;
  dividends_annual?: DividendAnnualPoint[];
  estimates: {
    revenue?: Record<string, AnalystEstimatePoint>;
    eps?: Record<string, AnalystEstimatePoint>;
  };
  historical_multiples: HistoricalMultiple[];
  historical_years_count: number;
  updated_at: string;
  is_stale: boolean;
}

export interface SurprisePoint {
  period: string;
  date: string;
  estimated?: number | null;
  actual?: number | null;
  surprise_pct?: number | null;
}

export interface SurprisesResponse {
  ticker: string;
  available: boolean;
  revenue_estimates_available: boolean;
  eps: SurprisePoint[];
  revenue: SurprisePoint[];
  updated_at: string;
  is_stale: boolean;
}

export interface SegmentSlice {
  name: string;
  revenue: number;
  share_pct: number;
}

export interface SegmentHistoryPoint {
  period: string;
  segments: Record<string, number>;
}

export interface MarginPoint {
  period: string;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
}

export interface SegmentsResponse {
  ticker: string;
  segments_available: boolean;
  segments: SegmentSlice[];
  segment_history: SegmentHistoryPoint[];
  margins_available: boolean;
  margins_annual: MarginPoint[];
  margins_quarterly: MarginPoint[];
  updated_at: string;
  is_stale: boolean;
}

export interface ScorePillar {
  score?: number | null;
  label: string;
  tone: SemanticTone | string;
  explanation: string;
}

export interface EtfMetricsSummary {
  ter_pct?: number | null;
  aum?: number | null;
  perf_1y_pct?: number | null;
  perf_3y_pct?: number | null;
  perf_5y_pct?: number | null;
  perf_max_pct?: number | null;
  cagr_3y_pct?: number | null;
  cagr_5y_pct?: number | null;
  cagr_max_pct?: number | null;
  volatility_pct?: number | null;
  max_drawdown_pct?: number | null;
}

export interface ScoresBundle {
  mode: "EQUITY" | "ETF" | string;
  global: ScorePillar;
  valuation: ScorePillar;
  growth: ScorePillar;
  quality: ScorePillar;
  health: ScorePillar;
  summary_badge: string;
  summary_tone: SemanticTone | string;
  valuation_verdict: string;
  growth_trend: string;
  historical_averages?: {
    years_count: number;
    pe?: number | null;
    p_fcf?: number | null;
    ev_ebitda?: number | null;
    diff_pct?: number | null;
  } | null;
  metrics?: Record<string, number | null> | null;
  etf_metrics?: EtfMetricsSummary | null;
}

export interface FairValueResponse {
  available: boolean;
  reason?: string | null;
  current_price?: number | null;
  base_metric_per_share?: number | null;
  metric_used?: "FCF" | "EPS" | string | null;
  expected_growth_pct?: number | null;
  exit_multiple?: number | null;
  required_return_pct?: number | null;
  default_growth_pct?: number | null;
  default_exit_multiple?: number | null;
  default_required_return_pct?: number | null;
  horizon_years: number;
  projected_metric_per_share?: number | null;
  terminal_price?: number | null;
  fair_value?: number | null;
  upside_pct?: number | null;
  margin_of_safety_pct?: number | null;
  verdict: string;
  verdict_tone: SemanticTone | string;
}

export interface RedFlagItem {
  id: string;
  title: string;
  severity: "high" | "medium" | "low" | string;
  value_label?: string | null;
  detail: string;
}

export interface StockOverviewResponse {
  info: StockInfoResponse;
  scores: ScoresBundle;
  fair_value: FairValueResponse;
  red_flags?: RedFlagItem[];
  updated_at: string;
  is_stale: boolean;
}

export interface PeerMetricRow {
  ticker: string;
  name: string;
  logo_url?: string | null;
  currency?: string | null;
  market_cap?: number | null;
  price?: number | null;
  pe?: number | null;
  forward_pe?: number | null;
  p_fcf?: number | null;
  peg?: number | null;
  rev_growth_1y?: number | null;
  rev_growth_3y?: number | null;
  eps_growth_1y?: number | null;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
  roe?: number | null;
  net_debt_ebitda?: number | null;
  score_global?: number | null;
  score_valuation?: number | null;
  score_growth?: number | null;
  score_quality?: number | null;
  score_health?: number | null;
  is_target: boolean;
}

export interface PeerDelta {
  diff_pct?: number | null;
  diff_pts?: number | null;
  status: "better" | "worse" | "neutral" | string;
}

export interface PeersRadar {
  company: {
    valuation?: number | null;
    growth?: number | null;
    quality?: number | null;
    health?: number | null;
  };
  sector_avg: {
    valuation?: number | null;
    growth?: number | null;
    quality?: number | null;
    health?: number | null;
  };
}

export interface PeersComparisonResponse {
  ticker: string;
  available: boolean;
  reason?: string | null;
  company?: PeerMetricRow | null;
  peers: PeerMetricRow[];
  sector_averages: Record<string, number | null>;
  deltas: Record<string, PeerDelta>;
  radar?: PeersRadar | null;
  summary_sentence: string;
  added_overrides: string[];
  excluded_overrides: string[];
  updated_at: string;
  is_stale: boolean;
}

export interface PeerOverridesResponse {
  ticker: string;
  added: string[];
  excluded: string[];
}

export interface PortfolioPositionItem {
  id: number;
  ticker: string;
  name: string;
  logo_url?: string | null;
  asset_type: "EQUITY" | "ETF" | string;
  sector?: string | null;
  envelope: "PEA" | "CTO" | string;
  quantity?: number | null;
  pru?: number | null;
  invested_amount?: number | null;
  currency: string;
  purchase_date?: string | null;
  current_price?: number | null;
  asset_currency?: string | null;
  current_value_eur: number;
  cost_basis_eur: number;
  pnl_eur: number;
  pnl_pct?: number | null;
  day_change_eur?: number | null;
  day_change_pct?: number | null;
  perf_1m_eur?: number | null;
  perf_1m_pct?: number | null;
  perf_1y_eur?: number | null;
  perf_1y_pct?: number | null;
  weight_pct: number;
  score_global?: number | null;
  score_valuation?: number | null;
  notes?: string | null;
  updated_at: string;
}

export interface PortfolioSaleItem {
  id: number;
  ticker: string;
  name: string;
  asset_type: "EQUITY" | "ETF" | string;
  envelope: "PEA" | "CTO" | string;
  quantity_sold: number;
  pru_eur: number;
  sell_price_eur: number;
  sell_price_input: number;
  sell_currency: string;
  proceeds_eur: number;
  cost_basis_eur: number;
  realized_pnl_eur: number;
  realized_pnl_pct?: number | null;
  sale_date: string;
  is_full_sale: boolean;
  notes?: string | null;
  created_at: string;
}

export interface PortfolioSellResponse {
  sale: PortfolioSaleItem;
  remaining_position?: PortfolioPositionItem | null;
  position_closed: boolean;
}

export interface PortfolioPerformancePoint {
  date: string;
  portfolio_base100: number;
  benchmark_base100: number;
  portfolio_pct: number;
  benchmark_pct: number;
  portfolio_value?: number | null;
  benchmark_price?: number | null;
}

export interface PeriodicReturnItem {
  label: string;
  start_date: string;
  end_date: string;
  portfolio_return_pct: number;
  benchmark_return_pct: number;
  alpha_pts: number;
}

export interface PortfolioPerformanceResponse {
  period: string;
  benchmark: string;
  benchmark_name: string;
  currency: string;
  calculation_mode?: "real" | "backtest" | string;
  calculation_label?: string;
  portfolio_perf_pct?: number | null;
  benchmark_perf_pct?: number | null;
  portfolio_cagr_pct?: number | null;
  benchmark_cagr_pct?: number | null;
  elapsed_years?: number | null;
  alpha_pts?: number | null;
  avg_alpha_pts?: number | null;
  annual_returns?: PeriodicReturnItem[];
  quarterly_returns?: PeriodicReturnItem[];
  points: PortfolioPerformancePoint[];
  positions_included: number;
  updated_at: string;
}

export interface DonutSlice {
  name: string;
  value_eur: number;
  weight_pct: number;
}

export interface PortfolioDonuts {
  by_position: DonutSlice[];
  by_envelope: DonutSlice[];
  by_sector: DonutSlice[];
}

export interface PortfolioWeightedStats {
  total_value_eur: number;
  total_cost_eur: number;
  total_pnl_eur: number;
  total_pnl_pct?: number | null;
  day_pnl_eur?: number | null;
  day_pnl_pct?: number | null;
  perf_1m_eur?: number | null;
  perf_1m_pct?: number | null;
  perf_1y_eur?: number | null;
  perf_1y_pct?: number | null;
  positions_count: number;
  equities_count: number;
  etfs_count: number;
  equities_weight_pct: number;
  etfs_weight_pct: number;
  top5_weight_pct: number;
  avg_market_cap_eur?: number | null;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
  roe?: number | null;
  roa?: number | null;
  rev_growth_1y?: number | null;
  eps_growth_1y?: number | null;
  net_debt_ebitda?: number | null;
  pe?: number | null;
  forward_pe?: number | null;
  p_fcf?: number | null;
  peg?: number | null;
  avg_score_global?: number | null;
  equities_avg_score_global?: number | null;
}

export interface PortfolioDashboardResponse {
  eurusd_rate: number;
  stats: PortfolioWeightedStats;
  donuts: PortfolioDonuts;
  positions: PortfolioPositionItem[];
  sales: PortfolioSaleItem[];
  total_realized_pnl_eur: number;
  updated_at: string;
}

export interface WatchlistItemEnriched {
  id: number;
  ticker: string;
  name: string;
  logo_url?: string | null;
  asset_type: "EQUITY" | "ETF" | string;
  region: string;
  pea_eligible: boolean;
  sector?: string | null;
  currency?: string | null;
  current_price?: number | null;
  day_change_pct?: number | null;
  score_global?: number | null;
  score_valuation?: number | null;
  summary_badge?: string | null;
  summary_tone?: string | null;
  target_price?: number | null;
  target_currency?: string | null;
  distance_to_target_pct?: number | null;
  alert_triggered: boolean;
  notes?: string | null;
  created_at: string;
}

export interface WatchlistResponse {
  items: WatchlistItemEnriched[];
  alerts_count: number;
  updated_at: string;
}

export interface ScreenerItem {
  ticker: string;
  name: string;
  asset_type: "EQUITY" | "ETF" | string;
  region: string;
  pea_eligible: boolean;
  sector?: string | null;
  industry?: string | null;
  logo_url?: string | null;
  currency?: string | null;
  price?: number | null;
  market_cap?: number | null;
  pe?: number | null;
  forward_pe?: number | null;
  p_fcf?: number | null;
  peg?: number | null;
  rev_growth_1y?: number | null;
  rev_growth_3y?: number | null;
  eps_growth_1y?: number | null;
  gross_margin?: number | null;
  op_margin?: number | null;
  net_margin?: number | null;
  roe?: number | null;
  net_debt_ebitda?: number | null;
  score_global?: number | null;
  score_valuation?: number | null;
  score_growth?: number | null;
  score_quality?: number | null;
  score_health?: number | null;
  updated_at?: string | null;
}

export interface ScreenerResponse {
  total: number;
  scored_count: number;
  universe_count: number;
  sectors: string[];
  items: ScreenerItem[];
  page: number;
  page_size: number;
}

export interface ScreenerQueryParams {
  preset?: string;
  q?: string;
  asset_type?: string;
  region?: string;
  pea_only?: boolean;
  sector?: string;
  only_scored?: boolean;
  min_global?: number;
  min_valuation?: number;
  min_growth?: number;
  min_quality?: number;
  min_health?: number;
  max_pe?: number;
  min_rev_growth_pct?: number;
  max_net_debt_ebitda?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface SeedStatusResponse {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  current_batch: number;
  total_batches: number;
  progress_pct: number;
  started_at?: string | null;
  finished_at?: string | null;
  last_error?: string | null;
  failed_tickers: string[];
}

export interface PriceTargetsSummary {
  current?: number | null;
  high?: number | null;
  mean?: number | null;
  median?: number | null;
  low?: number | null;
  upside_high_pct?: number | null;
  upside_mean_pct?: number | null;
  upside_low_pct?: number | null;
}

export interface ForecastPoint {
  period: string;
  year?: number | null;
  is_actual: boolean;
  high?: number | null;
  avg?: number | null;
  low?: number | null;
  num_analysts?: number | null;
}

export interface CagrSummary {
  high?: number | null;
  avg?: number | null;
  low?: number | null;
}

export interface AnalystConsensus {
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
  total: number;
  score_out_of_5?: number | null;
  label?: string | null;
  period?: string | null;
}

export interface AnalystsResponse {
  ticker: string;
  available: boolean;
  reason?: string | null;
  currency?: string | null;
  price_targets?: PriceTargetsSummary | null;
  revenue_forecasts: ForecastPoint[];
  revenue_cagr?: CagrSummary | null;
  eps_forecasts: ForecastPoint[];
  eps_cagr?: CagrSummary | null;
  consensus?: AnalystConsensus | null;
  updated_at: string;
  is_stale: boolean;
}

export interface ApiProviderStatus {
  id: string;
  name: string;
  status: "ok" | "missing" | "error" | string;
  detail: string;
}

export interface SystemStatusResponse {
  providers: ApiProviderStatus[];
  cache_entries_count: number;
  checked_at: string;
}

export interface RadarItem {
  ticker: string;
  name: string;
  logo_url?: string | null;
  asset_type: string;
  region: string;
  pea_eligible: boolean;
  sector?: string | null;
  currency?: string | null;
  in_portfolio: boolean;
  in_watchlist: boolean;
  envelope?: string | null;
  current_value_eur?: number | null;
  current_price?: number | null;
  day_change_pct?: number | null;
  score_global?: number | null;
  fair_value?: number | null;
  margin_of_safety_pct?: number | null;
  price_vs_fair_value_pct?: number | null;
  distance_52w_high_pct?: number | null;
  next_earnings_date?: string | null;
  days_until_earnings?: number | null;
  red_flags_count: number;
  signal: "buy" | "watch" | "wait" | "etf" | string;
  signal_label: string;
  signal_tone: SemanticTone | "slate" | string;
  attractiveness_score: number;
}

export interface RadarEarningsItem {
  ticker: string;
  name: string;
  logo_url?: string | null;
  in_portfolio: boolean;
  in_watchlist: boolean;
  next_earnings_date: string;
  days_until_earnings: number;
  score_global?: number | null;
}

export interface OpportunityRadarResponse {
  items: RadarItem[];
  upcoming_earnings: RadarEarningsItem[];
  buy_zone_count: number;
  updated_at: string;
}

export interface DcaSettings {
  monthly_amount_eur: number;
  etf_target_pct: number;
  equities_target_pct: number;
  default_mode: "standard" | "opportunistic";
}

export interface DcaAllocationLine {
  ticker: string;
  name: string;
  bucket: "ETF" | "EQUITY" | string;
  envelope: string;
  amount_eur: number;
  share_pct: number;
  reason: string;
  score_global?: number | null;
  margin_of_safety_pct?: number | null;
  source: string;
}

export interface DcaPlanResponse {
  amount_eur: number;
  mode: "standard" | "opportunistic";
  etf_target_pct: number;
  equities_target_pct: number;
  current_etf_pct: number;
  current_equities_pct: number;
  projected_etf_pct: number;
  projected_equities_pct: number;
  etf_budget_eur: number;
  equities_budget_eur: number;
  opportunistic_triggered: boolean;
  explanations: string[];
  lines: DcaAllocationLine[];
}

export interface ProjectionDefaultsResponse {
  initial_pea_value: number;
  initial_pea_contributions: number;
  initial_cto_value: number;
  initial_cto_contributions: number;
  monthly_contribution: number;
  pea_share_pct: number;
  pea_cap_eur: number;
  pea_tax_rate_pct: number;
  cto_tax_rate_pct: number;
}

export interface ProjectionRequest {
  initial_pea_value: number;
  initial_pea_contributions: number;
  initial_cto_value: number;
  initial_cto_contributions: number;
  monthly_contribution: number;
  pea_share_pct: number;
  annual_return_pct: number;
  horizon_years: number;
  inflation_pct: number;
  pea_tax_rate_pct: number;
  cto_tax_rate_pct: number;
  pea_cap_eur?: number;
  index_contributions_to_inflation?: boolean;
  career_growth_pct?: number;
}

export interface ProjectionYearPoint {
  year: number;
  calendar_year: number;
  contributed_eur: number;
  pea_contributed_eur: number;
  cto_contributed_eur: number;
  pea_value_eur: number;
  cto_value_eur: number;
  gross_value_eur: number;
  net_value_eur: number;
  net_real_value_eur: number;
}

export interface ProjectionResponse {
  pea_cap_eur: number;
  horizon_years: number;
  index_contributions_to_inflation?: boolean;
  career_growth_pct?: number;
  final_monthly_contribution_eur?: number;
  final_monthly_contribution_real_eur?: number;
  final_contributed_eur: number;
  final_gross_eur: number;
  final_net_eur: number;
  final_net_real_eur: number;
  final_pea_value_eur: number;
  final_cto_value_eur: number;
  total_taxes_eur: number;
  pea_cap_reached_year?: number | null;
  pea_cap_reached_calendar_year?: number | null;
  monthly_rent_4pct_net_eur: number;
  monthly_rent_4pct_real_eur: number;
  points: ProjectionYearPoint[];
}

export interface PortfolioBackupPayload {
  version: number;
  exported_at: string;
  positions: Record<string, unknown>[];
  lots: Record<string, unknown>[];
  sales: Record<string, unknown>[];
  watchlist: Record<string, unknown>[];
  settings: Record<string, unknown>;
}

export interface PortfolioRestoreResponse {
  restored: boolean;
  positions_count: number;
  lots_count: number;
  sales_count: number;
  watchlist_count: number;
  settings_count: number;
}
