# Cora — agent skill

Cora gives AI agents wallets, spend controls, and virtual Visa cards on Stellar.

**Network:** testnet by default.

## Setup

1. Operator creates an agent in the Cora dashboard and copies a one-time claim code (`cora_…`).
2. Run:

```bash
npx -y cora@latest onboard --claim cora_<code> --network testnet --api-base http://127.0.0.1:4200/v1
```

3. Fund the printed Stellar address with testnet XLM (and USDC if paying with USDC).
4. Purchase:

```bash
npx cora purchase --amount 25 --network testnet
```

## Surfaces

- HTTP API: `http://127.0.0.1:4200/v1`
- CLI / SDK: `npx cora`
- MCP: not enabled yet

Never paste raw API keys into chat transcripts — use claim codes.
