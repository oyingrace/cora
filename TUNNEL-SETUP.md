# Cloudflare Tunnel Setup for Cora

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

Then restart the backend: `cd backend && node src/index.js`

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
