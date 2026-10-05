# Changelog

All notable changes to the IRL TypeScript SDK.
Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/).

---

## [0.2.0] — 2026-04-14

### Added
- **Full Layer 2 support** — `IRLClient.authorize()` now automatically fetches, verifies, and attaches a signed Ed25519 MTA heartbeat on every call. No API changes required.
- `mtaUrl` constructor option — pass `""` to disable heartbeat fetch (L1 mode or `LAYER2_ENABLED=false`)
- `AuthorizeResult.shadowBlocked` field (reflects engine shadow mode state)

### Changed
- Minimum IRL Engine version: 1.1.0 (L2 heartbeat endpoint required)
- `bindExecution()` now includes `mtaRef` in the returned result for audit trail traceability

### Fixed
- Heartbeat clock drift edge case — SDK now uses server-reported timestamp rather than `Date.now()` when constructing `agentValidTime`

---

## [0.1.0] — 2026-04-14

### Added
- `IRLClient` — async client wrapping all IRL Engine endpoints
- `client.authorize(AuthorizeRequest)` → `AuthorizeResult`
- `client.bindExecution(BindExecutionRequest)` → `BindExecutionResult`
- `TradeAction` enum: `LONG`, `SHORT`, `NEUTRAL`
- `OrderType` enum: `MARKET`, `LIMIT`, `STOP`, `TWAP`, `VWAP`
- Full TypeScript strict-mode typings with exported types for all request/response shapes
- End-to-end example (`examples/demo_e2e.ts`) against the public sandbox
- Full error code documentation

[0.2.0]: https://github.com/macropulse-lab/irl-sdk-ts/releases/tag/v0.2.0
[0.1.0]: https://github.com/macropulse-lab/irl-sdk-ts/releases/tag/v0.1.0
