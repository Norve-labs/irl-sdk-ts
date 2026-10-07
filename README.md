<div align="center">
<sub>IRL by <a href="https://github.com/horkos-labs">Horkos Labs</a></sub>
</div>

# irl-sdk

[![npm version](https://img.shields.io/badge/npm-0.3.0-blue)](https://www.npmjs.com/package/irl-sdk)
[![Node](https://img.shields.io/badge/node-18%2B-blue)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue)](https://www.typescriptlang.org)

TypeScript/JavaScript SDK for the [IRL Engine](https://macropulse.live/irl) — cryptographic pre-execution compliance rail for autonomous trading agents.

## What's new in 0.3.0

- **No regime operator by default**: `mtaUrl` no longer defaults to `api.macropulse.live`. Without it, `authorize()` sends no heartbeat, which is what IRL servers with `MTA_MODE=none` (agent caps only) expect. Set `mtaUrl` only for a server with `LAYER2_ENABLED=true`.
- **Retry + backoff**: All API calls retry on 5xx with exponential backoff. Configure via `maxRetries` (default: 3) and `backoffBaseMs` (default: 500 ms).
- **Multi-agent linking**: `AuthorizeRequest.parent_trace_id` connects sub-agent calls to orchestrators. `getTraceChain()` returns the full causal ancestry.
- **Extended order types**: `OrderType` union expanded with `VWAP`, `IOC`, `FOK`, `POST_ONLY`, `PEGGED`, `TRAILING_STOP`, `ICEBERG`.

## Install

```bash
npm install irl-sdk
# or
pnpm add irl-sdk
# or
yarn add irl-sdk
```

Node.js ≥ 18 required (uses native `fetch` and `AbortSignal.timeout`).

## Quickstart

```ts
import { IRLClient } from "irl-sdk";

const client = new IRLClient({
  irlUrl: "https://irl.macropulse.live",
  apiToken: process.env.IRL_API_TOKEN!,
});

// 1. Authorize a trade intent (attaches a fresh heartbeat only if you set mtaUrl)
const result = await client.authorize({
  agent_id: "550e8400-e29b-41d4-a716-446655440000",
  model_id: "btc-momentum-v2",
  model_hash_hex: "a3f2e1d4...".padEnd(64, "0"),  // SHA-256 of model config
  action: "Long",
  asset: "BTC-USD",
  venue_id: "CBSE",
  quantity: 0.5,
  notional: 32500,
});

if (result.authorized) {
  // 2. Place the order — attach reasoning_hash to exchange metadata
  const exchangeTxId = await placeOrder({
    asset: "BTC-USD",
    quantity: 0.5,
    irlTraceId: result.trace_id,
    irlReasoningHash: result.reasoning_hash,
  });

  // 3. Bind execution — closes the cryptographic chain
  await client.bindExecution({
    trace_id: result.trace_id,
    exchange_tx_id: exchangeTxId,
    execution_status: "Filled",
    asset: "BTC-USD",
    executed_quantity: 0.5,
    execution_price: 65000,
  });
}

await client.close();
```

## API

### `new IRLClient(options)`

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `irlUrl` | `string` | Yes | IRL Engine base URL |
| `apiToken` | `string` | Yes | Bearer token from IRL admin |
| `mtaUrl` | `string` | No | Regime operator (MTA) base URL for Layer 2 heartbeats. Unset (default): no heartbeat is sent. |
| `timeoutMs` | `number` | No | Request timeout in ms (default: `5000`) |
| `maxRetries` | `number` | No | Max retries on 5xx (default: `3`) |
| `backoffBaseMs` | `number` | No | Base delay for exponential backoff in ms (default: `500`) |

### `client.authorize(req)` → `Promise<AuthorizeResult>`

Submits the trade intent, with a fresh heartbeat first when `mtaUrl` is set.

**`AuthorizeRequest`** key fields:

| Field | Type | Description |
|-------|------|-------------|
| `agent_id` | `string` | UUID — must be registered in the MAR |
| `model_hash_hex` | `string` | 64-char SHA-256 of the model config |
| `action` | `"Long" \| "Short" \| "Neutral"` | Trade direction |
| `asset` | `string` | e.g. `"BTC-USD"` |
| `venue_id` | `string` | e.g. `"CBSE"` |
| `quantity` | `number` | Units |
| `notional` | `number` | USD notional |

**`AuthorizeResult`**:

```ts
{
  trace_id: string;        // Attach to exchange order metadata
  reasoning_hash: string;  // SHA-256 of the sealed reasoning snapshot
  authorized: boolean;     // false = blocked by policy engine
  shadow_blocked: boolean; // true = would have been blocked (shadow mode)
}
```

### `client.bindExecution(params)` → `Promise<{ final_proof, status }>`

Closes the cryptographic chain after exchange confirmation.

### `client.getTrace(trace_id)` → `Promise<Record<string, unknown>>`

Retrieve a full trace for forensic replay or regulator review.

### `client.getTraceChain(trace_id)` → `Promise<Record<string, unknown>>`

Return the full causal ancestry chain for a multi-agent trace. Walks from the given trace to the root orchestrator and returns ancestors plus direct children.

### `client.fetchHeartbeat()` → `Promise<Heartbeat>`

Fetch the latest signed heartbeat manually (normally handled by `authorize`).

## Error handling

```ts
import { IRLClient, IRLError, IRLHeartbeatError } from "irl-sdk";

try {
  const result = await client.authorize(req);
} catch (err) {
  if (err instanceof IRLHeartbeatError) {
    // heartbeat fetch from your mtaUrl failed
  } else if (err instanceof IRLError) {
    console.error(err.status, err.body);  // 4xx/5xx from IRL Engine
  }
}
```

## Layer 2 anti-replay

With `mtaUrl` set, the client fetches a fresh heartbeat before every `authorize` call. **Do not cache or reuse heartbeats** — each must be consumed once. Reuse will result in a `HEARTBEAT_REPLAY` rejection from the engine.

## MtaMode::None

If the IRL Engine runs with `MTA_MODE=none` (the public server does), only the agent's own mandate applies and no heartbeat is needed. Leave `mtaUrl` unset:

```ts
const client = new IRLClient({
  irlUrl: "https://irl.macropulse.live",
  apiToken: "your-token",
});
```

---

## Ecosystem

| Repo | Description |
|---|---|
| [irl](https://github.com/horkos-labs/irl) | Core IRL Engine (FSL-1.1-ALv2) |
| [irl-gateway](https://github.com/horkos-labs/irl-gateway) | MCP server: AI agents trade through IRL (`pip install irl-gateway`) |
| [irl-sdk-python](https://github.com/horkos-labs/irl-sdk-python) | Python SDK |
| [irl-public-docs](https://github.com/horkos-labs/irl-public-docs) | Public documentation hub |
| [macropulse](https://macropulse.live) | MacroPulse — MTA operator |

## Links

- [IRL Engine product page](https://macropulse.live/irl)
- [Developer Guide](https://github.com/horkos-labs/irl-public-docs/blob/master/docs/developer-guide.md)
- [Live Sandbox + Swagger UI](https://irl.macropulse.live/swagger-ui/)
- [Python SDK on PyPI](https://pypi.org/project/irl-sdk/)

---

<div align="center">
<sub>IRL by <a href="https://github.com/horkos-labs">Horkos Labs</a> · <a href="https://irl.macropulse.live">irl.macropulse.live</a></sub>
</div>
