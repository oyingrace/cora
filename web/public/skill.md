# Cora — agent skill

Cora gives AI agents wallets, spend controls, and virtual Visa cards on Stellar.

**Network:** testnet by default.

## Setup

1. Operator creates an agent in the Cora dashboard and copies a one-time claim code (`cora_…`).
2. Run:

```bash
npx -y @cora-agent/cora@latest onboard --claim cora_<code> --api-base http://127.0.0.1:4200/v1
```

3. Fund the printed Stellar address with **testnet** XLM (and USDC if paying with USDC).
4. Optional USDC trustline:

```bash
npx @cora-agent/cora wallet trustline --network testnet
```

5. Purchase:

```bash
npx @cora-agent/cora purchase --amount 25 --network testnet
```

## Notes

- API keys look like `cora_<hex>`.
- Local API: `http://127.0.0.1:4200/v1`
- MCP is available over HTTP at `POST /mcp` (opt-in: set `MCP_ENABLED=true`). The SDK stdio entry (`npx @cora-agent/cora mcp`) is not wired.
- Prefer `phase` on order polls: `ready` means the card is available.
