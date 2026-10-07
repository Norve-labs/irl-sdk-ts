import { describe, it, expect, vi, beforeEach } from "vitest";
import { IRLClient, IRLError, IRLHeartbeatError } from "../client.js";

const MOCK_HEARTBEAT = {
  sequence_id: 1,
  timestamp_ms: Date.now(),
  regime_id: 1,
  mta_ref: "abc123",
  signature: "sig==",
};

const MOCK_AUTHORIZE_RESPONSE = {
  trace_id: "trace-uuid",
  reasoning_hash: "a".repeat(64),
  authorized: true,
  shadow_blocked: false,
};

function makeClient() {
  return new IRLClient({
    irlUrl: "https://irl.example.com",
    apiToken: "test-token",
    mtaUrl: "https://mta.example.com",
  });
}

describe("IRLClient.authorize", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("fetches heartbeat then posts to /irl/authorize and returns result", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    const client = makeClient();
    const result = await client.authorize({
      agent_id: "agent-uuid",
      model_id: "model-v1",
      model_hash_hex: "a".repeat(64),
      action: "Long",
      asset: "BTC-USD",
      venue_id: "CBSE",
      quantity: 0.1,
      notional: 6500,
    });

    expect(result.trace_id).toBe("trace-uuid");
    expect(result.authorized).toBe(true);
    expect(result.shadow_blocked).toBe(false);

    // heartbeat fetched first
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/v1/irl/heartbeat"),
      expect.any(Object),
    );
    // authorize posted second
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/irl/authorize"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends correct Authorization header", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    await makeClient().authorize({
      agent_id: "a",
      model_id: "m",
      model_hash_hex: "b".repeat(64),
      action: "Short",
      asset: "ETH-USD",
      venue_id: "BINC",
      quantity: 1,
      notional: 3000,
    });

    const [, authorizeInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const headers = authorizeInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-token");
  });

  it("serializes Long action correctly", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    await makeClient().authorize({
      agent_id: "a",
      model_id: "m",
      model_hash_hex: "c".repeat(64),
      action: "Long",
      asset: "BTC-USD",
      venue_id: "CBSE",
      quantity: 2.5,
      notional: 150000,
    });

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["action"]).toEqual({ Long: 2.5 });
  });

  it("serializes Neutral action correctly", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    await makeClient().authorize({
      agent_id: "a",
      model_id: "m",
      model_hash_hex: "d".repeat(64),
      action: "Neutral",
      asset: "BTC-USD",
      venue_id: "CBSE",
      quantity: 0,
      notional: 0,
    });

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["action"]).toBe("Neutral");
  });

  it("throws IRLHeartbeatError when heartbeat fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503 }),
    );

    await expect(
      makeClient().authorize({
        agent_id: "a",
        model_id: "m",
        model_hash_hex: "e".repeat(64),
        action: "Long",
        asset: "BTC-USD",
        venue_id: "CBSE",
        quantity: 1,
        notional: 60000,
      }),
    ).rejects.toThrow(IRLHeartbeatError);
  });

  it("throws IRLError on 4xx from authorize endpoint", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "AGENT_NOT_FOUND" }), { status: 404 }));

    await expect(
      makeClient().authorize({
        agent_id: "bad-uuid",
        model_id: "m",
        model_hash_hex: "f".repeat(64),
        action: "Long",
        asset: "BTC-USD",
        venue_id: "CBSE",
        quantity: 1,
        notional: 60000,
      }),
    ).rejects.toThrow(IRLError);
  });

  it("defaults agent_valid_time to Date.now() if not provided", async () => {
    const before = Date.now();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    await makeClient().authorize({
      agent_id: "a",
      model_id: "m",
      model_hash_hex: "a".repeat(64),
      action: "Long",
      asset: "BTC-USD",
      venue_id: "CBSE",
      quantity: 1,
      notional: 60000,
    });

    const after = Date.now();
    const [, init] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const avt = body["agent_valid_time"] as number;
    expect(avt).toBeGreaterThanOrEqual(before);
    expect(avt).toBeLessThanOrEqual(after);
  });
});

describe("IRLClient.bindExecution", () => {
  it("posts to /irl/bind-execution and returns final_proof", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ final_proof: "proof-hash", status: "MATCHED" }), { status: 200 }),
    );

    const result = await makeClient().bindExecution({
      trace_id: "trace-uuid",
      exchange_tx_id: "EX-TX-001",
      execution_status: "Filled",
      asset: "BTC-USD",
      executed_quantity: 0.1,
      execution_price: 65000,
    });

    expect(result.final_proof).toBe("proof-hash");
    expect(result.status).toBe("MATCHED");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/irl/bind-execution"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("IRLClient without a regime operator", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  const order = {
    agent_id: "agent-uuid",
    model_id: "model-v1",
    model_hash_hex: "a".repeat(64),
    action: "Long" as const,
    asset: "BTC-USD",
    venue_id: "CBSE",
    quantity: 0.1,
    notional: 6500,
  };

  it.each([undefined, ""])("with mtaUrl %j it posts once and sends no heartbeat", async (mtaUrl) => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    const client = new IRLClient({ irlUrl: "https://irl.example.com", apiToken: "t", mtaUrl });
    const result = await client.authorize(order);

    expect(result.authorized).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/irl/authorize");
    expect(JSON.parse(init.body as string)).not.toHaveProperty("heartbeat");
  });

  it("with mtaUrl it attaches the fetched heartbeat", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_HEARTBEAT), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MOCK_AUTHORIZE_RESPONSE), { status: 200 }));

    await makeClient().authorize(order);

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string).heartbeat).toEqual(MOCK_HEARTBEAT);
  });

  it("fetchHeartbeat refuses to guess an operator", async () => {
    const client = new IRLClient({ irlUrl: "https://irl.example.com", apiToken: "t" });
    await expect(client.fetchHeartbeat()).rejects.toBeInstanceOf(IRLHeartbeatError);
  });
});
