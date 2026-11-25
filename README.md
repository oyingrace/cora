# Cora

Prepaid Visa virtual cards for AI agents. Pay USDC or XLM on Stellar via a Soroban smart contract, receive card number, CVV, and expiry in ~60 seconds.

## Features

- **Instant Card Issuance** - Virtual Visa cards delivered in 45–120 seconds after payment confirmation
- **Dual Asset Support** - Pay with USDC or XLM on Stellar testnet (mainnet supported)
- **Soroban Smart Contract** - Trustless payment via `pay_usdc()` / `pay_xlm()` contract calls
- **SDK + CLI** - TypeScript SDK with one-shot `purchaseCardOWS()` and full CLI tooling
- **MCP Server** - Model Context Protocol integration for Claude Desktop, Cursor, and other MCP clients
- **Operator Dashboard** - Web UI for managing agents, budgets, and approvals

## Environment Setup

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite path (default: `./data/cora.db`) |
| `STELLAR_NETWORK` | `testnet` or `mainnet` (default: `testnet`) |
| `VCC_ENDPOINT` | VCC provider endpoint (default: mock at port 4300) |
| `VCC_API_KEY` | VCC provider API key |
| `CORA_API_KEY` | Agent API key (`cora_...`) |

## Running

```bash
# Install dependencies
npm install

# Start all services (backend + web + mock VCC)
npm run dev:api      # Backend API (port 4200)
npm run dev:web      # Web dashboard (port 3200)
npm run mock:vcc     # Mock VCC provider (port 4300)

# Or run individually
cd backend && npm run dev
cd web && npm run dev
```

## Local Ports

| Service | Port | Description |
|---------|------|-------------|
| Web | 3200 | Landing page + operator dashboard |
| Backend | 4200 | Agent HTTP API |
| Mock VCC | 4300 | Development VCC provider |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/orders` | Create a new card order |
| `GET /v1/orders/:id` | Get order status and card details |
| `GET /v1/orders/:id/stream` | SSE stream for real-time order updates |
| `GET /v1/budget` | Get agent budget and usage |
| `POST /v1/claim` | Exchange claim code for API key |

## Project Structure

```
├── backend/        # Express.js API, Soroban watcher, order state machine
├── web/            # Next.js landing + operator dashboard (port 3200)
├── sdk/            # TypeScript SDK + CLI (`@cora-agent/cora`)
├── contract/       # Soroban receiver contract (pay_usdc / pay_xlm)
├── scripts/        # mock-vcc, init-receiver, verify
├── mock-vcc-worker/# Cloudflare Worker mock VCC
└── docs/           # Project documentation
```

## SDK Quick Start

```bash
# Install
npm install @cora-agent/cora

# Onboard agent
npx @cora-agent/cora onboard --claim <code> --network testnet

# Purchase card
npx @cora-agent/cora purchase --amount 25 --network testnet
```

```typescript
import { purchaseCardOWS } from '@cora-agent/cora';

const card = await purchaseCardOWS({
  apiKey: process.env.CORA_API_KEY!,
  walletName: 'my-agent',
  amountUsdc: '25.00',
  paymentAsset: 'xlm',
});

console.log(card.number, card.cvv, card.expiry);
```

## Payment Flow

```
Agent → POST /v1/orders → payment instructions (contract_id, amount)
    ↓
Agent → Soroban pay_usdc() / pay_xlm() → funds to receiver contract
    ↓
Backend watcher → detects payment → fulfills via VCC
    ↓
Agent → GET /v1/orders/:id (phase=ready) → card credentials
```

## Order Phases

| Phase | Meaning |
|-------|---------|
| `awaiting_approval` | Held for operator approval |
| `awaiting_payment` | Ready to pay — includes `payment` instructions |
| `processing` | Payment detected; fulfillment in progress |
| `ready` | Card delivered |
| `failed` / `refunded` / `rejected` / `expired` | Terminal |

## Links

- [cora.dev](https://cora.dev) — Dashboard and docs
- [cora.dev/docs](https://cora.dev/docs) — Full API reference
- [cora.dev/skill.md](https://cora.dev/skill.md) — Agent onboarding brief

## License

MIT
