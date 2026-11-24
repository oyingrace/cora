# Cora

**The financial operating system for AI agents.** Prepaid Visa virtual cards on
demand — an agent pays USDC or XLM on Stellar through a Soroban contract and gets
back a card number, CVV, and expiry in about a minute.

Live: `https://cora-agents-card.vercel.app`

> **Network:** Cora targets **Stellar testnet** by default. Mainnet is opt-in via
> `STELLAR_NETWORK=mainnet`.

---

## Repository structure

```
cora/
├── backend/        Node.js/Express API, Soroban watcher, SQLite, policy engine
├── contract/       Soroban receiver contract (Rust)
├── sdk/            TypeScript client + CLI + OWS helpers (npm: @cora-agent/cora)
├── web/            Next.js landing page + operator dashboard
├── scripts/        mock-vcc, init-receiver, smoke tests, verify
├── docs/           Product description
├── design/         UI skill (Apple-style fluid interfaces)
└── plan.md         Migration / build plan
```

Everything in this repo is open source. Card procurement runs through a separate
fulfillment service (**vcc**) that the backend talks to over HTTP + HMAC-signed
callbacks. `scripts/mock-vcc.mjs` stands in for it locally so the whole flow runs
end-to-end on testnet without any external dependency.

---

## Components

### `backend/` — API server

Node.js/Express backend. Soroban event watcher with a persisted ledger cursor,
order state machine, policy engine (spend limits, approval flows, time windows),
agent auth (API keys with bcrypt + prefix index), tenant dashboard API and
platform-owner admin API, webhook delivery with retries, and background jobs
(order expiry, approval expiry, reconciliation, pruning).

It also mounts, off by default, the MCP HTTP endpoint (`POST /mcp`, gated by
`MCP_ENABLED`), OAuth 2.0 for the claude.ai connector (`OAUTH_ENABLED`), and
MPP discovery/challenge routes.

```bash
cd backend
npm install
cp .env.example .env     # fill in Stellar keys, receiver contract ID, VCC config
npm run dev              # http://localhost:4200
npm test                 # unit + integration suites
```

SQLite (WAL mode, better-sqlite3). Migrations run automatically on startup.

### `sdk/` — TypeScript SDK + CLI

Agent-facing client library. Exports `CoraClient` (HTTP wrapper),
`payViaContract` / `payViaContractOWS` (Soroban contract invocation),
`purchaseCard` / `purchaseCardOWS` (create → pay → wait, all in one), OWS wallet
helpers (`createOWSWallet`, `getOWSBalance`), and a typed error taxonomy
(`CoraError` + subclasses such as `SpendLimitError`, `WaitTimeoutError`).

```bash
cd sdk
npm install
npm run build
```

CLI commands: `cora onboard`, `cora purchase`, `cora wallet`
(`address` | `balance` | `trustline`), `cora connector`, `cora mcp`, `cora version`.
Published to npm as [`@cora-agent/cora`](https://www.npmjs.com/package/@cora-agent/cora).
The CLI reads `~/.cora/config.json` written by `cora onboard`, so no API key flag
is needed on later commands.

### `web/` — Landing page + operator dashboard

Next.js 16 (App Router) app on port **3200**. A single marketing landing page,
privacy/terms pages, the agent-facing docs served as `public/skill.md` and
`public/llms.txt`, and the full operator dashboard — overview,
agents, orders (with card reveal), approvals, analytics, merchants, developer /
webhooks, alerts, audit log, teams, settings, feedback — plus the platform-owner
surface (orders, agents, users, treasury, margins, webhooks, approvals, unmatched,
audit, health).

```bash
npm run dev -w web       # http://localhost:3200
npm run build -w web
npm run test -w web      # vitest; Playwright E2E in web/e2e
```

### `contract/` — Soroban receiver contract

Rust contract that receives USDC or XLM from agents and emits a payment event
carrying the order UUID; the backend watcher indexes those events, so no memo or
destination matching is needed.

```bash
cd contract
cargo build --target wasm32-unknown-unknown --release
```

`pay_usdc` / `pay_xlm` transfer to the treasury and publish
`(Symbol("pay_usdc"|"pay_xlm"), order_id_bytes, from_address)` with the amount.
`init` is one-shot and `upgrade` is admin-gated — burn the admin key for a fully
immutable deployment. Contract ID is set via `RECEIVER_CONTRACT_ID` in the backend
env; see [`contract/README.md`](./contract/README.md) for deploy/init steps.

### `scripts/`

`mock-vcc.mjs` (Luhn-valid fake PANs, port **4300**), `init-receiver.sh` (derives
the treasury address and picks the right USDC/XLM SAC per network),
`smoke-testnet.mjs`, `install-ows.sh`, and `verify.sh` (typecheck → lint → build →
tests → docs lint).

---

## Quick start (agents)

1. Your operator creates an agent in the dashboard and hands you a claim code.
2. `npx -y @cora-agent/cora onboard --claim <code> --network testnet` — exchanges the claim code for an API key and creates an OWS wallet.
3. Fund the wallet: ≥ 1 XLM to pay with XLM, or ≥ 2 XLM plus USDC to pay with USDC (the trustline is added automatically).
4. `npx -y @cora-agent/cora purchase --amount 10` — buys a $10 Visa card.

Or use the SDK programmatically:

```typescript
import { purchaseCardOWS } from '@cora-agent/cora';

const card = await purchaseCardOWS({
  apiKey: process.env.CORA_API_KEY!,
  walletName: 'my-agent',
  amountUsdc: '10.00',
  paymentAsset: 'usdc', // or 'xlm'
});
// card = { number, cvv, expiry, brand, order_id }
```

For raw-keypair wallets (no OWS), use `payViaContract` + `CoraClient`:

```typescript
import { CoraClient, payViaContract } from '@cora-agent/cora';

const client = new CoraClient({ apiKey: 'cora_...' });
const order = await client.createOrder({ amount_usdc: '10.00' });
await payViaContract({ walletSecret: process.env.STELLAR_SECRET!, payment: order.payment });
const card = await client.waitForCard(order.order_id);
```

Full agent-facing reference (phases, idempotency, webhooks, error codes, wallet
setup): [`AGENTS.md`](./AGENTS.md).

---

## Quick start (local stack)

```bash
# 1. Mock VCC fulfillment (port 4300)
npm run mock:vcc

# 2. Backend API (port 4200)
cd backend && npm install && cp .env.example .env && npm run dev

# 3. Web (port 3200)
cd .. && npm install && npm run dev:web
```

| Service  | Port |
| -------- | ---- |
| Web      | 3200 |
| Backend  | 4200 |
| Mock VCC | 4300 |

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for components, the payment flow, and
the order state machine. Product positioning lives in
[docs/project-description.md](./docs/project-description.md); the phased build
sequence and port map are in [plan.md](./plan.md).

---

## MCP

MCP is wired on the backend as an HTTP endpoint, `POST /mcp`, and is **off by
default** (`MCP_ENABLED=false` in `backend/.env.example`). When enabled it exposes
`purchase_vcc`, `check_order`, `check_budget`, and `wallet_balance`. OAuth 2.0 for
the claude.ai connector is gated the same way (`OAUTH_ENABLED`, plus `cora
connector` for one-time client registration).

The SDK's stdio MCP entry (`cora mcp`) is not wired — MCP clients connect to the
backend endpoint instead.

---

## Development

The repo uses npm workspaces (`web`, `sdk`). The backend has its own
`package.json` and is installed separately. `.npmrc` sets `legacy-peer-deps=true`
to work around an npm 11 arborist crash on this workspace peer graph.

```bash
npm install              # root + workspaces
cd backend && npm install

npm run dev:web          # web on :3200
npm run dev:api          # backend on :4200
npm run mock:vcc         # mock fulfillment on :4300

npm run typecheck        # web + sdk
npm run lint             # eslint (root)
npm run format:check     # prettier
npm test                 # workspace test suites
npm run verify           # typecheck → lint → build → tests → docs lint
```
