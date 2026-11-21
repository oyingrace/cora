// @ts-check
// OAuth 2.0 Authorization Code flow — lets claude.ai sign in with a Cora
// dashboard account and pick which agent the connector acts as.
//
// Endpoints:
//   GET  /oauth/authorize — agent-picker HTML page (requires Cora session)
//   POST /oauth/authorize — form submit: issues code, redirects to client
//   POST /oauth/token     — code → access_token exchange
//   GET  /oauth/userinfo  — introspect a Bearer token
//
// Security:
//   - redirect_uri compared with strict equality (RFC 6749 §4.1.3)
//   - Codes are single-use, 10-minute TTL
//   - Tokens and client secrets are SHA-256 hashed at rest, never stored plain
//   - state is required on every authorize request

'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
/** @type {any} */
const db = require('../db');
const { event: bizEvent } = require('../lib/logger');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

const CODE_TTL_MINUTES = 10;
const TOKEN_TTL_HOURS = parseInt(process.env.OAUTH_TOKEN_TTL_HOURS || '1', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function generateToken(prefix = '') { return `${prefix}${crypto.randomBytes(32).toString('hex')}`; }

function findClient(clientId) {
  return /** @type {any} */ (db.prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`).get(clientId));
}

function verifyClientCredentials(clientId, clientSecret) {
  const client = findClient(clientId);
  if (!client) return null;
  const supplied = Buffer.from(sha256(clientSecret), 'hex');
  const stored   = Buffer.from(client.client_secret_hash, 'hex');
  if (stored.length !== supplied.length) return null;
  if (!crypto.timingSafeEqual(stored, supplied)) return null;
  return client;
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}

function buildCancelRedirect(redirectUri, state) {
  try {
    const u = new URL(redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (state) u.searchParams.set('state', state);
    return u.toString();
  } catch { return '#'; }
}

// ── Rate limiters ─────────────────────────────────────────────────────────────

const authorizeLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 30,
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});

const tokenLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 20,
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});

// ── GET /oauth/authorize ──────────────────────────────────────────────────────

router.get('/authorize', authorizeLimiter, requireAuth, (req, res) => {
  const { client_id, redirect_uri, state, response_type } = req.query;

  if (response_type !== 'code')
    return res.status(400).json({ error: 'unsupported_response_type' });
  if (!client_id || typeof client_id !== 'string')
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
  if (!redirect_uri || typeof redirect_uri !== 'string')
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri required' });
  if (!state || typeof state !== 'string')
    return res.status(400).json({ error: 'invalid_request', error_description: 'state required' });

  const client = findClient(client_id);
  if (!client) return res.status(400).json({ error: 'invalid_client' });
  if (client.redirect_uri !== redirect_uri)
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri mismatch' });

  const user = /** @type {any} */ (req).user;
  const agents = /** @type {any[]} */ (
    db.prepare(
      `SELECT ak.id, ak.label, ak.wallet_public_key
       FROM api_keys ak JOIN dashboards d ON ak.dashboard_id = d.id
       WHERE d.user_id = ? AND ak.enabled = 1 ORDER BY ak.created_at DESC`,
    ).all(user.id)
  );

  const agentOptions = agents.length === 0
    ? '<p style="color:#666">No agents found. Create one in the Cora dashboard first.</p>'
    : agents.map((a) =>
        `<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer">
          <input type="radio" name="api_key_id" value="${esc(a.id)}" required>
          <span><strong>${esc(a.label || 'Unnamed agent')}</strong>
            <small style="color:#888;margin-left:6px">${esc(a.id.slice(0, 8))}…</small>
            ${a.wallet_public_key ? '<small style="color:#2d7a2d">● wallet ready</small>'
                                  : '<small style="color:#888">○ no wallet</small>'}
          </span></label>`).join('');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cora — Authorize ${esc(client.name)}</title>
<style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
max-width:420px;margin:60px auto;padding:0 20px;color:#111}
h1{font-size:1.3rem;font-weight:600;margin-bottom:4px}p{color:#555;margin-top:0}
.card{border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin:20px 0}
button{width:100%;padding:12px;background:#111;color:#fff;border:none;border-radius:8px;
font-size:1rem;cursor:pointer;margin-top:16px}button:hover{background:#333}
.cancel{display:block;text-align:center;margin-top:12px;color:#888;font-size:.875rem;text-decoration:none}
</style></head><body>
<h1>Authorize ${esc(client.name)}</h1>
<p>Signed in as <strong>${esc(user.email)}</strong>. Choose which agent this connector acts as.</p>
<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="client_id"    value="${esc(client_id)}">
  <input type="hidden" name="redirect_uri" value="${esc(redirect_uri)}">
  <input type="hidden" name="state"        value="${esc(state)}">
  <div class="card"><strong>Select an agent</strong>${agentOptions}</div>
  ${agents.length > 0 ? '<button type="submit">Authorize</button>' : ''}
</form>
<a class="cancel" href="${esc(buildCancelRedirect(redirect_uri, state))}">Cancel</a>
</body></html>`);
});

// ── POST /oauth/authorize ─────────────────────────────────────────────────────

router.post('/authorize', authorizeLimiter, requireAuth, (req, res) => {
  const { client_id, redirect_uri, state, api_key_id } = req.body || {};
  const user = /** @type {any} */ (req).user;

  if (!client_id || !redirect_uri || !state || !api_key_id)
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing fields' });

  const client = findClient(client_id);
  if (!client || client.redirect_uri !== redirect_uri)
    return res.status(400).json({ error: 'invalid_client' });

  // Tenancy check — agent must belong to this user's dashboard.
  const agent = /** @type {any} */ (
    db.prepare(
      `SELECT ak.id FROM api_keys ak JOIN dashboards d ON ak.dashboard_id = d.id
       WHERE d.user_id = ? AND ak.id = ? AND ak.enabled = 1`,
    ).get(user.id, api_key_id)
  );
  if (!agent) return res.status(403).json({ error: 'access_denied' });

  const rawCode = generateToken('coauth_');
  const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  db.prepare(
    `INSERT INTO oauth_codes (id, client_id, user_id, api_key_id, code_hash, redirect_uri, state, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(uuidv4(), client_id, user.id, api_key_id, sha256(rawCode), redirect_uri, state, expires);

  bizEvent('oauth.code_issued', { client_id, user_id: user.id, api_key_id });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', rawCode);
  url.searchParams.set('state', state);
  return res.redirect(302, url.toString());
});

// ── POST /oauth/token ─────────────────────────────────────────────────────────

router.post('/token', tokenLimiter, (req, res) => {
  const body = req.body || {};
  const { grant_type, code, redirect_uri, client_id, client_secret } = body;

  if (grant_type !== 'authorization_code')
    return res.status(400).json({ error: 'unsupported_grant_type' });
  if (!code || !redirect_uri || !client_id || !client_secret)
    return res.status(400).json({ error: 'invalid_request', error_description: 'Missing required parameters' });

  const client = verifyClientCredentials(client_id, client_secret);
  if (!client) return res.status(401).json({ error: 'invalid_client' });

  // Atomically mark the code used so two concurrent requests can't both succeed.
  const result = db.transaction(() => {
    const row = /** @type {any} */ (
      db.prepare(
        `SELECT * FROM oauth_codes
         WHERE code_hash = ? AND client_id = ? AND used_at IS NULL
           AND datetime(expires_at) > datetime('now')`,
      ).get(sha256(code), client_id)
    );
    if (!row || row.redirect_uri !== redirect_uri) return null;
    db.prepare(`UPDATE oauth_codes SET used_at = datetime('now') WHERE id = ?`).run(row.id);
    return row;
  })();

  if (!result) return res.status(400).json({ error: 'invalid_grant' });

  const rawToken = generateToken('cora_mcp_');
  const expires = new Date(Date.now() + TOKEN_TTL_HOURS * 3_600_000).toISOString();
  db.prepare(
    `INSERT INTO oauth_tokens (id, client_id, user_id, api_key_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(uuidv4(), client_id, result.user_id, result.api_key_id, sha256(rawToken), expires);

  bizEvent('oauth.token_issued', { client_id, user_id: result.user_id, api_key_id: result.api_key_id });

  return res.json({
    access_token: rawToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_HOURS * 3600,
    scope: `agent:${result.api_key_id}`,
  });
});

// ── GET /oauth/userinfo ───────────────────────────────────────────────────────

router.get('/userinfo', (req, res) => {
  const raw = typeof req.headers.authorization === 'string'
    ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : null;
  if (!raw) return res.status(401).json({ error: 'unauthorized' });

  const row = /** @type {any} */ (
    db.prepare(
      `SELECT ot.user_id, ot.api_key_id, ot.client_id, ot.expires_at,
              u.email, u.role, ak.label AS agent_label, ak.wallet_public_key
       FROM oauth_tokens ot
       JOIN users u ON ot.user_id = u.id
       JOIN api_keys ak ON ot.api_key_id = ak.id
       WHERE ot.token_hash = ? AND ot.revoked_at IS NULL
         AND datetime(ot.expires_at) > datetime('now')`,
    ).get(sha256(raw))
  );

  if (!row) return res.status(401).json({ error: 'invalid_token' });

  return res.json({
    sub: row.user_id,
    email: row.email,
    role: row.role,
    agent_id: row.api_key_id,
    agent_label: row.agent_label,
    wallet_public_key: row.wallet_public_key || null,
    client_id: row.client_id,
    expires_at: row.expires_at,
  });
});

// ── Token resolution (exported for MCP server) ────────────────────────────────

/**
 * Resolve an OAuth Bearer token to the api_keys row it was scoped to.
 * Returns null if the token is missing, expired, revoked, or unknown.
 * @param {string | undefined} rawToken
 * @returns {any | null}
 */
function resolveOAuthToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const row = /** @type {any} */ (
    db.prepare(
      `SELECT ak.* FROM oauth_tokens ot
       JOIN api_keys ak ON ot.api_key_id = ak.id
       WHERE ot.token_hash = ? AND ot.revoked_at IS NULL
         AND datetime(ot.expires_at) > datetime('now') AND ak.enabled = 1`,
    ).get(sha256(rawToken))
  );
  return row || null;
}

module.exports = { router, resolveOAuthToken };
