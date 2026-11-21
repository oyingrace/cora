# Cora Architecture

Cora is an agentic virtual-card service on **Stellar testnet** (default). Agents pay USDC or XLM to a Soroban receiver contract; Cora detects the payment, fulfills a virtual Visa card via VCC, and returns PAN / CVV / expiry.

## Components

| Component | Directory   | Role |
| --------- | ----------- | ---- |
| Backend   | `backend/`  | Agent HTTP API, Soroban watcher, order state machine, dashboard API, policy engine |
| Web       | `web/`      | Landing + operator dashboard (Next.js, port 3200) |
| SDK       | `sdk/`      | TypeScript client + CLI (`npx @cora-agent/cora`); MCP stub until Phase 10 |
| Contract  | `contract/` | Soroban receiver (`pay_usdc` / `pay_xlm`) |
| Scripts   | `scripts/`  | mock-vcc (4300), init-receiver, verify |

## Local ports

| Service  | Port |
| -------- | ---- |
| Web      | 3200 |
| Backend  | 4200 |
| Mock VCC | 4300 |

## Payment flow

```
Agent → POST /v1/orders → payment instructions
Agent → Soroban pay_usdc / pay_xlm
Backend watcher → fulfillment (VCC) → card credentials
Agent → GET /v1/orders/:id (phase=ready)
```

## Design

UI follows `design/skill.md` (Apple-style fluid interfaces). Product positioning: `docs/project-description.md`. Build sequence: `plan.md`.
