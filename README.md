# Cora

**The financial operating system for AI agents.**

Give your AI agents virtual Visa cards without giving up financial control.

Built on Stellar + Soroban. Agents pay USDC or XLM and receive a usable Visa card in about a minute.

> **Network:** Cora targets **Stellar testnet** by default during development.

## Repo layout

| Path         | Role                                              |
| ------------ | ------------------------------------------------- |
| `backend/`   | Express API, Soroban watcher, dashboard API       |
| `web/`       | Next.js landing + operator dashboard (port 3200)  |
| `sdk/`       | TypeScript client + CLI (`npx @cora-agent/cora`)              |
| `contract/`  | Soroban receiver contract                         |
| `scripts/`   | mock-vcc, init-receiver, verify                   |
| `docs/`      | Product description                               |
| `design/`    | UI skill (Apple-style fluid interfaces)           |
| `plan.md`    | Migration / build plan                            |

## Quick start (local)

```bash
# 1. Mock VCC fulfillment (port 4300)
npm run mock:vcc

# 2. Backend API (port 4200) — copy backend/.env.example → backend/.env first
cd backend && npm install && npm run dev

# 3. Web (port 3200)
cd .. && npm install && npm run dev:web
```

Open http://localhost:3200

## MCP

MCP integration is planned so Claude and other agents can call Cora directly. It is **not enabled yet** — see `plan.md` Phase 10.

## Related docs

- [docs/project-description.md](docs/project-description.md)
- [plan.md](plan.md)
- [design/skill.md](design/skill.md)
