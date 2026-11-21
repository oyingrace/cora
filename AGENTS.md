# Cora — Agent Guide

Cora issues prepaid Visa virtual cards on demand. AI agents pay USDC or XLM on Stellar via a smart contract and get back a card number, CVV, and expiry — ready to use for online purchases.

**Default network: Stellar testnet.**

## Quick orientation

- **API base (local)**: `http://127.0.0.1:4200/v1`
- **Auth**: `X-Api-Key: cora_...` header on every request
- **Payment**: Stellar testnet — USDC or XLM via Soroban contract call
- **Typical latency**: ~45–120 seconds from payment confirmation to card delivery
- **SDK**: `npm install @cora-agent/cora` — CLI via `npx @cora-agent/cora`
- **MCP**: not enabled yet (see `plan.md` Phase 10)

## Core flow

```
POST /v1/orders → get Soroban contract payment instructions
  ↓
Call contract.pay_usdc() or contract.pay_xlm() → send funds to receiver contract
  ↓
GET /v1/orders/:id → poll until phase = "ready"
  ↓
Use card.number, card.cvv, card.expiry
```

## Creating an order

```http
POST /v1/orders
X-Api-Key: cora_...
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "amount_usdc": "25.00",
  "webhook_url": "https://your-app.com/webhook"
}
```

Both USDC and XLM quotes are returned; pick one by invoking `pay_usdc` or `pay_xlm`.

## SDK one-shot

```typescript
import { purchaseCardOWS } from '@cora-agent/cora';

const card = await purchaseCardOWS({
  apiKey: process.env.CORA_API_KEY!,
  walletName: process.env.OWS_WALLET_NAME!,
  amountUsdc: '25.00',
  paymentAsset: 'usdc', // or 'xlm'
});
```

## CLI

```bash
npx @cora-agent/cora onboard --claim cora_<code> --network testnet --api-base http://127.0.0.1:4200/v1
npx @cora-agent/cora purchase --amount 25 --network testnet
npx @cora-agent/cora wallet balance
```

## Phases

| Phase | Meaning |
| ------------------- | ---------------------------------------------------------------- |
| `awaiting_approval` | Held for owner approval |
| `awaiting_payment`  | Ready to pay — response includes `payment` |
| `processing`        | Payment detected; fulfillment in progress |
| `ready`             | Card delivered |
| `failed` / `refunded` / `rejected` / `expired` | Terminal |

Poll every 3–5s until terminal. Prefer `client.waitForCard(orderId)`.

## Local ports

| Service  | Port |
| -------- | ---- |
| Web      | 3200 |
| Backend  | 4200 |
| Mock VCC | 4300 |
