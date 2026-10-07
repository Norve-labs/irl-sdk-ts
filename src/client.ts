/**
 * IRLClient — send authorized trade intents to the IRL Engine.
 *
 * @example
 * ```ts
 * import { IRLClient } from "irl-sdk";
 *
 * const client = new IRLClient({
 *   irlUrl: "https://norve.dev",
 *   apiToken: process.env.IRL_API_TOKEN!,
 * });
 *
 * const result = await client.authorize({
 *   agent_id: "550e8400-e29b-41d4-a716-446655440000",
 *   model_id: "my-algo-v1",
 *   model_hash_hex: "abc123...".padEnd(64, "0"),
 *   action: "Long",
 *   asset: "BTC-USD",
 *   venue_id: "CBSE",
 *   quantity: 0.1,
 *   notional: 6500,
 * });
 *
 * console.log(result.trace_id, result.authorized);
 * await client.close();
 * ```
 */

import type {
  AuthorizeRequest,
  AuthorizeResult,
  Heartbeat,
  IRLClientOptions,
  TradeAction,
} from "./models.js";

export class IRLClient {
  private readonly irlUrl: string;
  private readonly mtaUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;

  constructor(options: IRLClientOptions) {
    this.irlUrl = options.irlUrl.replace(/\/$/, "");
    this.mtaUrl = (options.mtaUrl ?? "").replace(/\/$/, "");
    this.headers = {
      Authorization: `Bearer ${options.apiToken}`,
      "Content-Type": "application/json",
    };
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
  }

  /**
   * Submit a trade intent for authorization.
   *
   * When `mtaUrl` is set, a fresh signed heartbeat is fetched from that regime
   * operator first and attached (L2 anti-replay; never cache or reuse one).
   * Without `mtaUrl` no heartbeat is sent, as IRL servers with no regime
   * operator (`MTA_MODE=none`) expect.
   *
   * @throws {IRLError} on 4xx/5xx responses from the IRL Engine
   * @throws {IRLHeartbeatError} if an MTA is configured and the heartbeat fetch fails
   */
  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    const heartbeat = this.mtaUrl ? await this.fetchHeartbeat() : undefined;

    const body = this.buildBody(req, heartbeat);

    const resp = await this.fetchWithRetry(`${this.irlUrl}/irl/authorize`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new IRLError(resp.status, text);
    }

    const data = await resp.json() as Record<string, unknown>;
    return {
      trace_id: data["trace_id"] as string,
      reasoning_hash: data["reasoning_hash"] as string,
      authorized: data["authorized"] as boolean,
      shadow_blocked: (data["shadow_blocked"] as boolean | undefined) ?? false,
    };
  }

  /**
   * Bind an exchange execution to a previously authorized trace.
   * Call this after your exchange confirms the order.
   */
  async bindExecution(params: {
    trace_id: string;
    exchange_tx_id: string;
    execution_status: "Filled" | "PartialFill" | "Rejected" | "Expired";
    asset: string;
    executed_quantity: number;
    execution_price: number;
  }): Promise<{ final_proof: string; status: string }> {
    const resp = await this.fetchWithRetry(`${this.irlUrl}/irl/bind-execution`, {
      method: "POST",
      body: JSON.stringify(params),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new IRLError(resp.status, text);
    }

    const data = await resp.json() as Record<string, unknown>;
    return {
      final_proof: data["final_proof"] as string,
      status: data["status"] as string,
    };
  }

  /** Retrieve a full trace by ID (forensic replay). */
  async getTrace(trace_id: string): Promise<Record<string, unknown>> {
    const resp = await this.fetchWithRetry(`${this.irlUrl}/irl/trace/${trace_id}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new IRLError(resp.status, text);
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }

  /**
   * Return the full ancestry chain for a trace (multi-agent audit trail).
   *
   * Walks from the given trace up to the root orchestrator and returns all
   * ancestor nodes plus the direct children dispatched from this trace.
   *
   * @throws {IRLError} on 4xx/5xx (404 if trace not found)
   */
  async getTraceChain(trace_id: string): Promise<Record<string, unknown>> {
    const resp = await this.fetchWithRetry(`${this.irlUrl}/irl/trace/${trace_id}/chain`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new IRLError(resp.status, text);
    }
    return resp.json() as Promise<Record<string, unknown>>;
  }

  /** Fetch the latest signed heartbeat from the configured regime operator (MTA). */
  async fetchHeartbeat(): Promise<Heartbeat> {
    if (!this.mtaUrl) throw new IRLHeartbeatError(0, "no mtaUrl configured");
    const resp = await this.fetch(`${this.mtaUrl}/v1/irl/heartbeat`, {
      headers: {},   // no auth needed for heartbeat
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new IRLHeartbeatError(resp.status, text);
    }
    return resp.json() as Promise<Heartbeat>;
  }

  /** No-op — included for symmetry with Python SDK's async context manager. */
  async close(): Promise<void> {}

  private buildBody(req: AuthorizeRequest, heartbeat: Heartbeat | undefined): Record<string, unknown> {
    const action = serializeAction(req.action, req.quantity);

    const body: Record<string, unknown> = {
      agent_id: req.agent_id,
      model_id: req.model_id,
      model_hash_hex: req.model_hash_hex,
      prompt_version: req.prompt_version ?? "v1",
      feature_schema_id: req.feature_schema_id ?? "default",
      hyperparameter_checksum: req.hyperparameter_checksum ?? "0".repeat(64),
      action,
      asset: req.asset,
      order_type: req.order_type ?? "MARKET",
      venue_id: req.venue_id,
      quantity: req.quantity,
      notional: req.notional,
      notional_currency: req.notional_currency ?? "USD",
      multiplier: req.multiplier ?? 1.0,
      reduce_only: req.reduce_only ?? false,
      client_order_id: req.client_order_id ?? "",
      agent_valid_time: req.agent_valid_time ?? Date.now(),
    };
    if (heartbeat !== undefined) body["heartbeat"] = heartbeat;

    if (req.limit_price !== undefined) body["limit_price"] = req.limit_price;
    if (req.stop_price !== undefined) body["stop_price"] = req.stop_price;
    if (req.parent_trace_id !== undefined) body["parent_trace_id"] = req.parent_trace_id;

    return body;
  }

  /** Fetch with exponential backoff retry on 5xx responses only. */
  private async fetchWithRetry(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const resp = await this.fetch(url, init);
      if (resp.status < 500 || attempt === this.maxRetries) {
        return resp;
      }
      await sleep(this.backoffBaseMs * Math.pow(2, attempt));
    }
    // unreachable — satisfies TS control-flow analysis
    return this.fetch(url, init);
  }

  private fetch(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    return globalThis.fetch(url, {
      ...init,
      headers: { ...this.headers, ...init.headers },
      signal,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function serializeAction(action: TradeAction, quantity: number): unknown {
  if (action === "Long") return { Long: quantity };
  if (action === "Short") return { Short: quantity };
  return "Neutral";
}

export class IRLError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`IRL Engine error ${status}: ${body}`);
    this.name = "IRLError";
  }
}

export class IRLHeartbeatError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Heartbeat fetch failed ${status}: ${body}`);
    this.name = "IRLHeartbeatError";
  }
}
