# Cora — agent skill

Cora gives AI agents wallets, spend controls, and virtual Visa cards on Stellar.

**Network:** testnet by default.

## Setup

1. Operator creates an agent in the Cora dashboard and copies a one-time claim code (`cora_…`).
2. Run:

```bash
npx -y @cora-agent/cora@latest onboard --claim cora_<code> --api-base https://cora-backend.fly.dev/v1
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