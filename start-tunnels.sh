#!/bin/bash
# Cora Cloudflare Tunnels Startup Script
# 
# This script starts persistent cloudflare tunnels for the backend and dashboard.
# The tunnel URLs remain stable as long as the processes keep running.
#
# Usage: ./start-tunnels.sh
# To run on login: See instructions at bottom of this file

set -e

BACKEND_PORT=4200
DASHBOARD_PORT=3200
BACKEND_LOG="/tmp/cloudflare-backend-tunnel.log"
DASHBOARD_LOG="/tmp/cloudflare-dashboard-tunnel.log"

echo "🚇 Starting Cloudflare Tunnels for Cora..."

# Kill existing tunnels
echo "   Stopping existing tunnels..."
pkill -f "cloudflared tunnel --url http://localhost:$BACKEND_PORT" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://localhost:$DASHBOARD_PORT" 2>/dev/null || true
sleep 2

# Start backend tunnel
echo "   Starting backend tunnel (port $BACKEND_PORT)..."
nohup cloudflared tunnel --url http://localhost:$BACKEND_PORT > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# Start dashboard tunnel  
echo "   Starting dashboard tunnel (port $DASHBOARD_PORT)..."
nohup cloudflared tunnel --url http://localhost:$DASHBOARD_PORT > "$DASHBOARD_LOG" 2>&1 &
DASHBOARD_PID=$!

# Wait for tunnels to initialize
echo "   Waiting for tunnels to initialize..."
sleep 10

# Extract URLs
BACKEND_URL=$(grep -o 'https://[a-z0-9-]*.trycloudflare.com' "$BACKEND_LOG" | head -1)
DASHBOARD_URL=$(grep -o 'https://[a-z0-9-]*.trycloudflare.com' "$DASHBOARD_LOG" | head -1)

echo ""
echo "✅ Tunnels started successfully!"
echo ""
echo "   Backend API:  $BACKEND_URL (PID: $BACKEND_PID)"
echo "   Dashboard:    $DASHBOARD_URL (PID: $DASHBOARD_PID)"
echo ""
echo "📝 Update your .env files:"
echo ""
echo "   backend/.env:"
echo "   CORA_BASE_URL=$BACKEND_URL"
echo "   CORA_DASHBOARD_URL=$DASHBOARD_URL"
echo ""
echo "💡 To auto-start on login (macOS):"
echo "   1. Open System Settings → General → Login Items"
echo "   2. Click + under 'Open at Login'"
echo "   3. Select this script: $(pwd)/start-tunnels.sh"
echo ""
echo "   OR use launchd: cp cora-tunnels.plist ~/Library/LaunchAgents/"
echo ""
