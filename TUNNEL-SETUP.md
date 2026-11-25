# Cloudflare Tunnel Setup for Cora

## The origin must be plain HTTP on 3200 / 4200

```bash
cloudflared tunnel --url http://localhost:4200   # backend  — NOT https, NOT port 42
cloudflared tunnel --url http://localhost:3200   # dashboard
```

cloudflared terminates TLS itself and proxies to the origin over local HTTP.
Pointing it at `https://localhost:4200` fails the TLS handshake, and pointing it
at the wrong port fails with:

```
Unable to reach the origin service ... dial tcp [::1]:42: connect: connection refused
originService=https://localhost:42
```

That error is **not** a network/firewall problem — the origin URL in the
cloudflared command (or in your connector settings) is wrong or stale.

## Current Tunnel URLs

- **Backend API**: Run `cloudflared tunnel --url http://localhost:4200`
- **Dashboard**: Run `cloudflared tunnel --url http://localhost:3200`

**Important**: Quick tunnel URLs change every time you restart cloudflared. Update your `.env` files after restarting!

## Starting Tunnels

### Manual Start (Recommended for now)

```bash
# Terminal 1 - Backend tunnel
cloudflared tunnel --url http://localhost:4200

# Terminal 2 - Dashboard tunnel  
cloudflared tunnel --url http://localhost:3200
```

After starting, copy the URLs (like `https://xyz-abc-123.trycloudflare.com`) and update:

**backend/.env:**
```bash
CORA_BASE_URL=https://your-backend-tunnel.trycloudflare.com
CORA_DASHBOARD_URL=https://your-dashboard-tunnel.trycloudflare.com
```

Then restart the backend — env is read at boot, so an edit alone changes nothing
(`npm run dev` uses `--env-file=.env`; `npm start` relies on `dotenv.config()`).

## Connector (claude.ai) — how the OAuth handshake runs

1. claude.ai opens `https://<backend-tunnel>/oauth/authorize?...` in a browser.
2. That route can only authenticate an `Authorization: Bearer` header, which a
   browser navigation cannot send — so it renders a sign-in page whose
   "continue" link points at
   `https://<dashboard-tunnel>/dashboard/oauth/authorize?...`
   (built from `CORA_DASHBOARD_URL`).
3. The dashboard has the session cookie, so it renders the agent picker and
   mints the code through `POST /dashboard/oauth/authorize` (proxied server-side
   by `/api/admin-proxy`, cookie → Bearer).
4. The browser is redirected back to claude.ai with `?code&state`, and claude.ai
   exchanges it at `POST /oauth/token`.

Requirements: both tunnels running, `MCP_ENABLED=true`, `OAUTH_ENABLED=true`, and
the connector URL registered in claude.ai must be the **current** backend tunnel
hostname. After restarting cloudflared you must re-point the connector.

## About Those "Unauthorized" Errors

You'll see errors like:
```
ERR  error="malformed HTTP response \"Unauthorized\"" ... /_next/hmr
```

**These are SAFE to ignore!** They're just WebSocket (Hot Module Replacement) connections failing. Your dashboard still works perfectly for:
- Loading pages ✅
- Signing in ✅  
- Using all features ✅

The only thing that doesn't work is live code reloading during development (not needed for production).

## Auto-Start on Login (Optional)

If you want tunnels to start automatically:

```bash
# Copy the launchd plist file
cp /Users/apple/cora/cora-tunnels.plist ~/Library/LaunchAgents/

# Load it
launchctl load ~/Library/LaunchAgents/cora-tunnels.plist
```

Or use the startup script:
```bash
./start-tunnels.sh
```

## Permanent Solution (Requires Cloudflare Domain)

If you have a custom domain in Cloudflare, you can create **named tunnels** with stable URLs:

1. Buy/add a domain to Cloudflare  
2. Run `cloudflared tunnel login`
3. Create named tunnels with fixed subdomains

For now, quick tunnels work great for testing!
