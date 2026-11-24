# Cora Migration Plan

Port Cards402 into a standalone **Cora** monorepo — Stellar **testnet**-first — with a distinct Apple-style UI ([design/skill.md](design/skill.md)). MCP shipped in Phase 10 as an opt-in HTTP endpoint (`POST /mcp`).

## Goals

- Standalone product identity: every `cards402` / `Cards402` / `CARDS402` string becomes **Cora** / `CORA` / `cora`.
- Full **dashboard** feature parity (tenant + platform owner).
- **Lean landing**: one marketing page; nav only for essentials (product CTA + Sign in). No blog / careers / press / pricing / compare routes in nav.
- Default network: **Stellar testnet** (not mainnet).
- Bit-by-bit phases so each can be committed separately.
- MCP integration = Phase 10 (complete; runs opt-in via `MCP_ENABLED`).

## Non-goals (this clone)

- ~~Shipping MCP tools / MCP server wiring~~ — shipped in Phase 10 as an opt-in HTTP endpoint.
- Marketing secondary pages (blog, careers, press, affiliate, compare, changelog, etc.).
- Mainnet as the default environment.

## Target layout

```
cora/
├── plan.md                 ← this file
├── docs/project-description.md
├── design/skill.md
├── README.md / AGENTS.md / ARCHITECTURE.md
├── backend/                ← Express API, watcher, jobs, dashboard API
├── web/                    ← Next.js landing + dashboard
├── sdk/                    ← TypeScript client + CLI (MCP served by backend)
├── contract/               ← Soroban receiver (Rust)
└── scripts/                ← mock-vcc, init-receiver, verify
```

## Local ports (coexist with Cards402)

| Service   | Cards402 | Cora  |
| --------- | -------- | ----- |
| Web       | 3000     | 3200  |
| Backend   | 4000     | 4200  |
| Mock VCC  | 4100     | 4300  |

## Naming map

| Cards402              | Cora                |
| --------------------- | ------------------- |
| `cards402` (npm/pkg)  | `cora`              |
| `Cards402Client`      | `CoraClient`        |
| `CARDS402_*` env      | `CORA_*`            |
| `cards402_` API keys  | `cora_`             |
| `X-Cards402-*`        | `X-Cora-*`          |
| Display “Cards402”    | “Cora”              |

## Phases (commit boundaries)

### Phase 0 — Scaffold
- Root `package.json` workspaces (`web`, `sdk`), gitignore, prettier/eslint baselines.
- README describing Cora + testnet-first.
- Empty package stubs for `backend/`, `web/`, `sdk/`, `contract/`, `scripts/`.

### Phase 1 — Backend core
Port from Cards402 `backend/`:
- `env.js`, `db.js`, `app.js`, `index.js`, `policy.js`, `fulfillment.js`, `jobs.js`, `vcc-client.js`, `payment-handler.js`
- `api/auth.js`, `api/orders.js`, `api/vcc-callback.js`
- `payments/*`, `middleware/*`, `lib/*`, `mpp/*`
- Env defaults: `STELLAR_NETWORK=testnet`, `CORA_BASE_URL=http://127.0.0.1:4200`
- Full rename pass.

### Phase 2 — Dashboard + platform API
- Port `api/dashboard.js`, `api/admin.js`, platform routes.
- Card reveal: `GET /dashboard/orders/:id/card`
- Audit, alerts, teams, approvals endpoints.

### Phase 3 — Web shell + design system
- Next.js app shell, auth gate, dashboard layout/sidebar.
- Design tokens + motion primitives per [design/skill.md](design/skill.md):
  - System/SF-like typography, translucent chrome (`backdrop-filter`)
  - Springs for sheets/drawers; reduced-motion fallbacks
  - Distinct from Cards402 editorial Fraunces look

### Phase 4 — Lean landing
- Single `web/app/page.tsx` selling Cora (project-description positioning).
- Nav: brand + Sign in (+ optional Docs anchor). **No** extra marketing routes.
- Copy anticipates MCP (“connect Claude / MCP-compatible agents”) without requiring MCP to work yet.
- Metrics emphasize **testnet** during early development.

### Phase 5 — Main dashboard pages
Port + restyle:
- Overview, Agents (+ detail), Orders (+ VisaCard reveal), Approvals, Analytics, Merchants

### Phase 6 — Admin / teams / platform
Port + restyle:
- Developer/Webhooks, Alerts, Audit, Teams, Settings, Feedback
- Platform owner: Overview, Orders, Agents, Users, Treasury, Margins, Webhooks, Approvals, Unmatched, Audit, Health

### Phase 7 — SDK + CLI
- Port client, OWS helpers, soroban pay, onboard/purchase/wallet commands.
- Package name `cora`; CLI `npx cora …`
- **MCP**: SDK stdio entry stays a stub; MCP is served over HTTP by the backend (see Phase 10).

### Phase 8 — Contract + scripts + docs
- Port Soroban receiver contract.
- `scripts/mock-vcc.mjs` (Luhn PANs) on port **4300**.
- `scripts/init-receiver.sh`, AGENTS.md / ARCHITECTURE.md rewritten for Cora + testnet.

### Phase 9 — E2E verification
- Boot mock-vcc → backend → web.
- Onboard + purchase on testnet against local API.
- Confirm dashboard order → Reveal card details.
- Fix blockers until the happy path works.

### Phase 10 — MCP ✅

Shipped as an opt-in **HTTP** MCP endpoint rather than a stdio server:

- `backend/src/mcp/server.js` — StreamableHTTP (stateless) transport at `POST /mcp`; same `X-Api-Key` bcrypt auth path as `/v1/*`; per-IP rate limit (`MCP_RATE_LIMIT`, default 60/min). Mounted in `backend/src/app.js` before the `/v1` auth chain and gated by `MCP_ENABLED=true` (default `false`).
- `backend/src/mcp/tools.js` — four tools: `check_budget` (spend summary + optional policy dry-run), `check_order` (status; includes the card once delivered), `wallet_balance` (on-chain XLM/USDC), `purchase_vcc` (destructive: creates the order, pays from the server wallet, returns the card).
- OAuth 2.0 for the claude.ai connector: `backend/src/oauth/router.js` (`/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`), clients registered via `POST /dashboard/oauth/clients`, gated by `OAUTH_ENABLED=true` (requires `MCP_ENABLED`).
- One-time client setup: `cora connector` (alias `cora connector register`) walks email OTP → agent pick → OAuth client registration and prints the values to paste into claude.ai. Needs a public HTTPS URL — see `TUNNEL-SETUP.md`.
- Tests: `backend/test/integration/mcp.test.js`, `backend/test/unit/mcp-tools.test.js`.
- Docs: landing MCP section, `web/public/skill.md`, and `web/public/llms.txt` describe MCP as available (opt-in).

Deviations from the original sketch: tools are HTTP-hosted (no stdio MCP server and no `setup_wallet` — wallet setup stays in `cora onboard` / the server-wallet APIs), and the client path is the claude.ai OAuth connector rather than a Claude Desktop JSON snippet. `sdk/src/mcp.ts` remains a stub that exits.

## UI principles (Cora ≠ Cards402)

Follow [design/skill.md](design/skill.md):
- Instant press feedback; interruptible springs; translucent materials; size-specific tracking.
- Restraint: one job per section; no purple-gradient AI cliché; no Cards402 Fraunces/constellation clone.
- Dashboard keeps information architecture; chrome/motion/type are Cora’s.

## Landing content direction (MCP-aware)

Positioning from [docs/project-description.md](docs/project-description.md):
- “Financial operating system for AI agents”
- Wallets + virtual Visa + control plane + MCP (opt-in HTTP endpoint)
- CTA: Sign in to dashboard / get claim code — MCP is available behind `MCP_ENABLED`, not required to buy a card.

## Working agreement

1. Implement one phase at a time; pause if you want to commit before the next phase.
2. Never copy secrets (`.env`) from Cards402 — only `.env.example` with Cora names.
3. Phase 10 is complete; MCP stays opt-in (`MCP_ENABLED`) and gated by the public HTTPS URL requirement.
4. Prefer port-and-rename over blind `cp -R` of marketing pages we are dropping.

## Progress checklist

- [ ] Phase 0 — Scaffold
- [ ] Phase 1 — Backend core
- [ ] Phase 2 — Dashboard API
- [ ] Phase 3 — Web shell + design
- [ ] Phase 4 — Landing
- [ ] Phase 5 — Main dashboard
- [ ] Phase 6 — Admin + platform
- [ ] Phase 7 — SDK + CLI stub
- [ ] Phase 8 — Contract + scripts
- [ ] Phase 9 — E2E works
- [x] Phase 10 — MCP
