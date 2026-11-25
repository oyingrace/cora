# @cora-agent/cora

TypeScript SDK and CLI for purchasing prepaid Visa virtual cards via Stellar. AI agents pay USDC or XLM through a Soroban smart contract and receive card details (number, CVV, expiry) in ~60 seconds.

## Features

- **One-Shot Purchase** - `purchaseCardOWS()` handles order creation, Soroban payment, and card delivery in a single call
- **OWS Wallet** - Encrypted on-disk wallet via `@ctx.com/stellar-ows-core` native bindings
- **Dual Asset Support** - Pay with USDC or XLM; auto-picks based on wallet balance
- **MCP Server** - Stdio-based Model Context Protocol server for Claude Desktop, Cursor, and other MCP clients
- **CLI** - Full onboarding and purchase flow from the command line
- **SSE Streaming** - Real-time order status via Server-Sent Events (polling fallback included)

## Environment Setup

| Variable | Description |
|----------|-------------|
| `CORA_API_KEY` | API key from cora dashboard (`cora_...`) |
| `CORA_API_URL` | API base URL (default: `http://127.0.0.1:4200/v1`) |
| `STELLAR_NETWORK` | `testnet` or `mainnet` (default: `testnet`) |
| `CORA_CONFIG_DIR` | Config directory (default: `~/.cora`) |

## Installation

```bash
npm install @cora-agent/cora
```

Requires Node.js 18+. Supported platforms: macOS (arm64 + x64), Linux (arm64 + x64).

## Running

### CLI Commands

```bash
# Onboard a new agent with a claim code
cora onboard --claim <code> --network testnet --api-base http://127.0.0.1:4200/v1

# Purchase a card
cora purchase --amount 25 --network testnet

# Wallet operations
cora wallet address            # Print Stellar address
cora wallet balance            # Print XLM + USDC balances
cora wallet trustline          # Open USDC trustline

# MCP server (default when no subcommand)
cora mcp

# Claude.ai OAuth connector registration
cora connector

# Version
cora version
```

### SDK Usage

```typescript
import { purchaseCardOWS } from '@cora-agent/cora';

const card = await purchaseCardOWS({
  apiKey: process.env.CORA_API_KEY!,
  walletName: 'my-agent',
  amountUsdc: '25.00',
  paymentAsset: 'xlm', // or 'usdc'
});

console.log(card.number, card.cvv, card.expiry);
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `cora onboard --claim <code>` | Trade claim code for API key + create wallet |
| `cora purchase --amount <USD>` | Buy a card using onboarded wallet |
| `cora wallet address` | Print Stellar address |
| `cora wallet balance` | Print XLM + USDC balances from Horizon |
| `cora wallet trustline` | Open USDC trustline (required for USDC) |
| `cora connector` | Register claude.ai MCP connector |
| `cora mcp` | Start MCP server over stdio |
| `cora version` | Print SDK version |
| `cora --help` | Show help |

## MCP Server

Add to your MCP client config:

```json
{
  "mcpServers": {
    "cora": {
      "command": "npx",
      "args": ["-y", "@cora-agent/cora"],
      "env": { "CORA_API_KEY": "cora_<your key>" }
    }
  }
}
```

**Exposed Tools:** `setup_wallet`, `check_budget`, `check_order`, `purchase_vcc`

## Project Structure

```
src/
├── cli.ts          # CLI dispatcher and help
├── client.ts       # CoraClient API wrapper
├── config.ts       # ~/.cora/config.json management
├── errors.ts       # Typed error classes (CoraError, SpendLimitError, etc.)
├── index.ts        # Public exports
├── mcp.ts          # MCP server entry point
├── mpp.ts          # Micropayment protocol helpers
├── ows.ts          # OWS wallet integration (create, sign, pay)
├── soroban.ts      # Soroban contract interaction
├── stellar.ts      # Stellar/Horizon helpers
├── version-check.ts# npm update checker
└── commands/       # CLI subcommand handlers
    ├── connector.ts    # `cora connector`
    ├── onboard.ts      # `cora onboard`
    ├── purchase.ts     # `cora purchase`
    └── wallet.ts       # `cora wallet`
```

## Error Handling

```typescript
import {
  CoraError,
  AuthError,
  SpendLimitError,
  OrderFailedError,
  WaitTimeoutError,
} from '@cora-agent/cora';

try {
  const card = await purchaseCardOWS({ /* ... */ });
} catch (err) {
  if (err instanceof SpendLimitError) { /* budget cap reached */ }
  else if (err instanceof OrderFailedError) { /* check err.refund */ }
  else if (err instanceof WaitTimeoutError) { /* fulfillment stalled */ }
  else if (err instanceof AuthError) { /* invalid API key */ }
}
```

## Links

- [cora.dev](https://cora.dev) — Dashboard and docs
- [cora.dev/docs](https://cora.dev/docs) — Full API reference
- [cora.dev/skill.md](https://cora.dev/skill.md) — Agent onboarding brief
- [github.com/oyingrace/cora](https://github.com/oyingrace/cora) — Source

## License

MIT — see [LICENSE](./LICENSE).
