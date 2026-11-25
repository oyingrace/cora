// @ts-check
// MCP HTTP server for Cora — Phase 2 of the MCP plan.
//
// Mounts at POST /mcp (and GET /mcp reserved for SSE in future).
// Auth: X-Api-Key header, same bcrypt path as /v1/* routes.
//
// Tools (all scoped to the authenticated agent):
//   check_budget    — read-only spend summary + optional policy dry-run
//   check_order     — read-only order status; returns card when delivered
//   wallet_balance  — read-only on-chain XLM/USDC balance
//   purchase_vcc    — action: pays and returns a card (marked destructive)
//
// Transport: StreamableHTTP stateless mode (sessionIdGenerator=undefined).
// Gated by MCP_ENABLED=true in app.js, same pattern as MPP_ENABLED.

'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
/** @type {any} */
const db = require('../db');
const { event: bizEvent } = require('../lib/logger');
const { handleCheckBudget, handleCheckOrder, handleWalletBalance, handlePurchaseVcc } = require('./tools');

// ── Auth ──────────────────────────────────────────────────────────────────────

const KEY_PREFIX_TAG = 'cora_';
const KEY_PREFIX_LEN = 12;
const KEY_MIN_LENGTH = KEY_PREFIX_TAG.length + KEY_PREFIX_LEN;
const KEY_MAX_LENGTH = 128;
const MAX_AUTH_CANDIDATES = 20;

/**
 * Authenticate an X-Api-Key value. Returns the api_keys row or null.
 * @param {string | undefined} rawKey
 * @returns {Promise<any | null>}
 */
async function authenticateKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  if (!rawKey.startsWith(KEY_PREFIX_TAG) || rawKey.length < KEY_MIN_LENGTH || rawKey.length > KEY_MAX_LENGTH) {
    return null;
  }
  const keyPrefix = rawKey.slice(KEY_PREFIX_TAG.length, KEY_PREFIX_TAG.length + KEY_PREFIX_LEN);
  const candidates = /** @type {any[]} */ (
    db.prepare(
      `SELECT * FROM api_keys WHERE (key_prefix = ? OR key_prefix IS NULL) AND enabled = 1 LIMIT ?`,
    ).all(keyPrefix, MAX_AUTH_CANDIDATES)
  );
  for (const candidate of candidates) {
    let matched = false;
    try { matched = await bcrypt.compare(rawKey, candidate.key_hash); } catch { continue; }
    if (!matched) continue;
    if (candidate.expires_at) {
      const ms = new Date(candidate.expires_at).getTime();
      if (!Number.isFinite(ms) || ms < Date.now()) return null;
    }
    if (candidate.suspended) return null;
    try { db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(candidate.id); } catch { /* non-fatal */ }
    return candidate;
  }
  return null;
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.MCP_RATE_LIMIT || '60', 10),
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'too_many_requests' }),
});

// ── Tool registry ─────────────────────────────────────────────────────────────
// Built fresh per request so apiKey is closed over — avoids any shared state
// between concurrent requests and keeps context injection clean (no SDK hacks).

/**
 * @param {any}    apiKey     authenticated api_keys row
 * @param {string} [requestId] from X-Request-ID for idempotency
 */
function buildMcpServer(apiKey, requestId) {
  const server = new McpServer({ name: 'cora', version: '0.1.0' });

  server.tool(
    'check_budget',
    "Return this agent's spend budget: limit, settled, in-flight, remaining. " +
      'Optionally provide amount_usdc for a dry-run policy verdict.',
    { amount_usdc: z.string().optional().describe('Optional decimal USDC amount to dry-run (e.g. "25.00")') },
    (args) => handleCheckBudget(apiKey, args),
  );

  server.tool(
    'check_order',
    'Return the current status of a Cora order. ' +
      'When phase is "ready" the card details (number, CVV, expiry) are included.',
    { order_id: z.string().describe('The order ID returned by purchase_vcc') },
    (args) => handleCheckOrder(apiKey, args),
  );

  server.tool(
    'wallet_balance',
    "Return the on-chain XLM and USDC balances of this agent's server-held Stellar wallet.",
    {},
    () => handleWalletBalance(apiKey),
  );

  server.registerTool(
    'purchase_vcc',
    {
      description:
        'Purchase a prepaid Visa virtual card. ' +
        "Pays from this agent's server-held Stellar wallet and returns the card (~60s). " +
        'If fulfillment takes longer, returns an order_id to poll with check_order. ' +
        'IMPORTANT: this tool moves real funds.',
      inputSchema: {
        amount_usdc: z.string().describe('Amount in USDC (e.g. "25.00")'),
        payment_asset: z.enum(['usdc', 'xlm']).optional().default('usdc').describe('Asset to pay with'),
        webhook_url: z.string().url().optional().describe('Optional HTTPS webhook URL for delivery notification'),
      },
      annotations: { destructiveHint: true },
    },
    (args) => handlePurchaseVcc(apiKey, args, requestId),
  );

  return server;
}

// ── Express router ────────────────────────────────────────────────────────────

function buildMcpRouter() {
  const router = Router();
  router.use(mcpLimiter);

  // Helper to get public base URL (used for WWW-Authenticate header)
  function getPublicBaseUrl(req) {
    return process.env.CORA_BASE_URL || `${req.protocol}://${req.get('host')}`;
  }

  // POST /mcp — authenticate then handle one stateless MCP request.
  // Accepts two auth mechanisms, tried in order:
  //   1. Authorization: Bearer <oauth_token>  — from claude.ai OAuth connector
  //   2. X-Api-Key: cora_...                  — raw API key (CLI/SDK/direct)
  router.post('/', async (req, res) => {
    // Try OAuth Bearer token first.
    let apiKey = null;
    const authHeader = typeof req.headers.authorization === 'string'
      ? req.headers.authorization : null;
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      const rawToken = authHeader.slice(7).trim();
      // Only attempt OAuth resolution if OAUTH_ENABLED — avoids a DB query
      // on every request when OAuth is not configured.
      if ((process.env.OAUTH_ENABLED || 'false') === 'true') {
        const { resolveOAuthToken } = require('../oauth/router');
        apiKey = resolveOAuthToken(rawToken);
        if (!apiKey) {
          bizEvent('mcp.oauth_auth_failed', { ip: req.ip });
          const baseUrl = getPublicBaseUrl(req);
          const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
          res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
          return res.status(401).json({ error: 'invalid_token',
            error_description: 'OAuth token is invalid, expired, or revoked' });
        }
      }
    }

    // Fall back to X-Api-Key if no Bearer token was resolved.
    if (!apiKey) {
      const rawKey = /** @type {string | undefined} */ (req.headers['x-api-key']);
      apiKey = await authenticateKey(rawKey);
      if (!apiKey) {
        bizEvent('mcp.auth_failed', { ip: req.ip });
        const baseUrl = getPublicBaseUrl(req);
        const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
        res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
        return res.status(401).json({ error: 'invalid_api_key' });
      }
    }

    bizEvent('mcp.request', { api_key_id: apiKey.id, ip: req.ip });

    const requestId = /** @type {string | undefined} */ (req.id || req.headers['x-request-id']);
    const mcpServer = buildMcpServer(apiKey, requestId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      bizEvent('mcp.request_error', { api_key_id: apiKey.id, error: msg });
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: msg });
    }
  });

  // GET /mcp — SSE not yet enabled; return a clear 405.
  router.get('/', (_req, res) => {
    res.status(405).json({
      error: 'method_not_allowed',
      message: 'Use POST /mcp for stateless requests. SSE sessions are not yet enabled.',
    });
  });

  return router;
}

module.exports = { buildMcpRouter };
