/** Data models matching the IRL Engine wire format. */

export type TradeAction = "Long" | "Short" | "Neutral";

export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP"
  | "STOP_LIMIT"
  | "TWAP"
  | "VWAP"
  | "IOC"
  | "FOK"
  | "POST_ONLY"
  | "PEGGED"
  | "TRAILING_STOP"
  | "ICEBERG";

export interface AuthorizeRequest {
  /** UUID string — must be registered in the Multi-Agent Registry. */
  agent_id: string;
  /** SHA-256 of the agent's model configuration (hex, 64 chars). */
  model_hash_hex: string;
  /** Human-readable model identifier. */
  model_id: string;

  prompt_version?: string;
  feature_schema_id?: string;
  hyperparameter_checksum?: string;

  action: TradeAction;
  asset: string;
  order_type?: OrderType;
  venue_id: string;
  quantity: number;
  notional: number;
  notional_currency?: string;
  multiplier?: number;
  limit_price?: number;
  stop_price?: number;
  client_order_id?: string;
  reduce_only?: boolean;

  /**
   * Unix milliseconds of the agent's decision time.
   * If omitted, IRLClient sets it to Date.now() before submission.
   */
  agent_valid_time?: number;

  /**
   * Multi-agent linking: trace_id of the orchestrator decision that triggered
   * this sub-agent call. Enables full causal chain audits.
   */
  parent_trace_id?: string;
}

export interface AuthorizeResult {
  trace_id: string;
  reasoning_hash: string;
  authorized: boolean;
  shadow_blocked: boolean;
}

export interface Heartbeat {
  sequence_id: number;
  timestamp_ms: number;
  regime_id: number;
  mta_ref: string;
  signature: string;
}

export interface IRLClientOptions {
  /** Base URL of the IRL Engine (e.g. "https://irl.macropulse.live"). */
  irlUrl: string;
  /** Bearer token issued via IRL Engine admin. */
  apiToken: string;
  /**
   * Base URL of a regime operator (MTA) for Layer 2 heartbeats. Set it only
   * when your IRL server runs with LAYER2_ENABLED=true. Unset (the default)
   * sends no heartbeat, for servers with MTA_MODE=none (agent caps only).
   */
  mtaUrl?: string;
  /** Fetch timeout in milliseconds. Defaults to 5000. */
  timeoutMs?: number;
  /** Max retry attempts on 5xx responses. Defaults to 3. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Defaults to 500. */
  backoffBaseMs?: number;
}
