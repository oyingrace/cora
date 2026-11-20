# Cora local smoke checklist

After `npm install` finishes at the repo root:

```bash
# Terminal 1 — mock VCC (port 4300)
cd /Users/apple/cora && npm run mock:vcc

# Terminal 2 — API (port 4200)
cd /Users/apple/cora/backend && npm run dev

# Terminal 3 — web (port 3200)
cd /Users/apple/cora/web && npm run dev
```

Then:

1. Open http://localhost:3200 — lean landing, Sign in only in nav
2. Open http://localhost:3200/dashboard — login OTP (check backend logs if SMTP unset)
3. Create an agent → copy claim code
4. `npx cora onboard --claim cora_… --api-base http://127.0.0.1:4200/v1`
5. Fund wallet with testnet XLM → `npx cora purchase --amount 5 --network testnet`
6. Dashboard → Orders → Reveal card details

MCP (`npx cora mcp`) intentionally exits until Phase 10 is approved.
