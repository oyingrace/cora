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

const registerLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 10,
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});

// ── CORS helper for dynamic registration ──────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ── POST /oauth/register ──────────────────────────────────────────────────────
// OAuth 2.0 Dynamic Client Registration (RFC 7591)

router.post('/register', registerLimiter, async (req, res) => {
  if ((process.env.OAUTH_ENABLED || 'false') !== 'true') {
    return res.status(503).json({ error: 'oauth_disabled', error_description: 'OAuth is not enabled' }, corsHeaders());
  }

  try {
    const body = req.body || {};
    const { searchParams } = new URL(req.url, `https://${req.get('host')}`);

    // Get mcp_slug from query param (set by virtual auth server metadata)
    let mcpSlug = searchParams.get('mcp_slug');

    // If no slug in query param, try to extract from Referer/Origin header
    // MCP SDK might include the MCP server URL in the Referer
    if (!mcpSlug) {
      const referer = req.headers.referer || req.headers.origin;
      if (referer) {
        const match = referer.match(/\/mcp\/([^\/\?]+)/);
        if (match) {
          mcpSlug = match[1];
          bizEvent('oauth.register.mcp_slug_extracted', { mcp_slug: mcpSlug, referer });
        }
      }
    }

    const {
      redirect_uris: redirectUris,
      client_name: clientName,
      client_uri: clientUri,
      logo_uri: logoUri,
      scope,
    } = body;

    // Validate redirect_uris
    if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be a non-empty array',
      }, corsHeaders());
    }

    // Validate each redirect URI
    for (const uri of redirectUris) {
      try {
        new URL(uri);
      } catch {
        return res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `Invalid redirect URI: ${uri}`,
        }, corsHeaders());
      }
    }

    // Parse requested scopes (default to mcp:tools)
    const requestedScopes = scope
      ? scope.split(' ').filter(Boolean)
      : ['mcp:tools'];

    // Normalize redirect URIs for comparison (sorted, lowercase)
    const normalizedUris = [...redirectUris].map((u) => u.toLowerCase()).sort();

    // Check for existing client with matching redirect_uris
    const allClients = /** @type {any[]} */ (db.prepare(`SELECT * FROM oauth_clients WHERE is_active = 1`).all());
    const existingClient = allClients.find((client) => {
      if (!client.redirect_uris) return false;
      let clientUris;
      try { clientUris = JSON.parse(client.redirect_uris); } catch { return false; }
      if (!Array.isArray(clientUris)) return false;
      const clientNormalizedUris = [...clientUris].map((u) => u.toLowerCase()).sort();
      return JSON.stringify(clientNormalizedUris) === JSON.stringify(normalizedUris);
    });

    // Generate new secret (used for both new and existing clients)
    const clientSecret = crypto.randomBytes(32).toString('base64url');
    const secretHash = sha256(clientSecret);

    let clientId;

    if (existingClient) {
      // Update existing client with new secret and scopes
      clientId = existingClient.client_id;
      db.prepare(
        `UPDATE oauth_clients SET client_secret_hash = ?, name = ?, logo_url = ?, allowed_scopes = ?, mcp_slug = ? WHERE client_id = ?`
      ).run(secretHash, clientName || existingClient.name, logoUri || existingClient.logo_url, requestedScopes.join(' '), mcpSlug || existingClient.mcp_slug, clientId);

      bizEvent('oauth.client_refreshed', {
        client_id: clientId,
        name: clientName || existingClient.name,
        redirect_uris: redirectUris,
        scopes: requestedScopes,
        mcp_slug: mcpSlug || existingClient.mcp_slug,
      });
    } else {
      // Create new client
      clientId = `cora_oauth_${crypto.randomBytes(16).toString('hex')}`;
      // Use first redirect_uri for legacy redirect_uri column (NOT NULL constraint)
      const primaryRedirectUri = redirectUris[0];
      db.prepare(
        `INSERT INTO oauth_clients (client_id, client_secret_hash, name, description, logo_url, redirect_uri, redirect_uris, allowed_scopes, mcp_slug, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      ).run(
        clientId,
        secretHash,
        clientName || 'MCP Client',
        clientUri ? `Client from ${clientUri}` : 'Dynamically registered MCP client',
        logoUri || null,
        primaryRedirectUri,
        JSON.stringify(redirectUris),
        requestedScopes.join(' '),
        mcpSlug || null
      );

      bizEvent('oauth.client_registered', {
        client_id: clientId,
        name: clientName || 'MCP Client',
        redirect_uris: redirectUris,
        scopes: requestedScopes,
        mcp_slug: mcpSlug,
      });
    }

    // Return client credentials (RFC 7591 response)
    // Note: For existing clients, we return 200 instead of 201
    const isNew = !existingClient;
    res.set(corsHeaders());
    return res.status(isNew ? 201 : 200).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0, // Never expires
      redirect_uris: redirectUris,
      client_name: clientName || 'MCP Client',
      client_uri: clientUri,
      logo_uri: logoUri,
      scope: requestedScopes.join(' '),
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    });

  } catch (error) {
    console.error('[POST /oauth/register] Error:', error);
    res.set(corsHeaders());
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to register client',
    });
  }
});

router.options('/register', (req, res) => {
  res.set(corsHeaders());
  res.status(204).end();
});

// ── GET /oauth/authorize ──────────────────────────────────────────────────────
// Custom auth middleware that shows a sign-in page instead of returning JSON
// when the user is not authenticated. This is required for OAuth flows where
// the client (claude.ai) expects HTML, not JSON errors.

function requireAuthOrSignInPage(req, res, next) {
  // Try to authenticate using requireAuth logic
  const crypto = require('crypto');
  function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
  
  const rawAuth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : null;
  if (!rawAuth || !rawAuth.toLowerCase().startsWith('bearer ')) {
    // No auth header - show sign-in page
    return showSignInPage(req, res);
  }
  
  const token = rawAuth.slice(7).trim();
  if (!token) {
    return showSignInPage(req, res);
  }
  
  const row = db.prepare(`
    SELECT u.id, u.email, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = ?
      AND datetime(s.expires_at) > datetime('now')
  `).get(hashToken(token));
  
  if (!row) {
    return showSignInPage(req, res);
  }
  
  const { isPlatformOwner } = require('../lib/platform');
  req.user = { ...row, is_platform_owner: isPlatformOwner(row.email) };
  next();
}

function showSignInPage(req, res) {
  const { client_id, redirect_uri, state, response_type } = req.query;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  
  // The dashboard origin the browser must be sent to. CORA_DASHBOARD_URL is the
  // public dashboard URL (tunnel or localhost:3200); the backend URL is NOT a
  // valid fallback here because it serves JSON APIs, not dashboard pages.
  const dashboardUrl =
    process.env.CORA_DASHBOARD_URL || `http://localhost:${process.env.DASHBOARD_PORT || 3200}`;

  // Hand the browser off to the dashboard, which owns the session cookie and
  // can therefore finish the authorize step. Pointing this at a relative
  // /oauth/authorize URL (the previous behaviour) re-rendered this same page
  // forever: the browser sends cookies on a link click, never a Bearer header.
  const returnUrl = `${dashboardUrl.replace(/\/$/, '')}/dashboard/oauth/authorize?${new URLSearchParams(req.query).toString()}`;
  
  // 401 is the contract for this page: the caller is not authenticated yet and
  // the HTML body is the actionable sign-in instructions. (Pre-fix this sent
  // 200, so an unauthenticated GET /oauth/authorize looked like a success.)
  res.status(401);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign In — Cora OAuth</title>
<style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
max-width:420px;margin:60px auto;padding:0 20px;color:#111;background:#f9f9f9}
h1{font-size:1.5rem;font-weight:600;margin-bottom:8px}p{color:#666;margin-top:0;line-height:1.5}
.card{border:1px solid #e5e5e5;border-radius:12px;padding:24px;margin:20px 0;background:#fff}
.info{background:#f0f7ff;border:1px solid #d0e7ff;padding:16px;border-radius:8px;margin:16px 0}
.info strong{color:#0066cc}
a{color:#0066cc;text-decoration:none}a:hover{text-decoration:underline}
</style></head><body>
<h1>Sign In Required</h1>
<p>To authorize this application, you need to sign in to your Cora dashboard first.</p>
<div class="card info">
  <strong>Next steps:</strong>
  <ol style="margin:8px 0 0;padding-left:20px">
    <li>Open <a href="${esc(dashboardUrl)}" target="_blank">${esc(dashboardUrl)}</a> in a new tab</li>
    <li>Sign in with your Cora dashboard account</li>
    <li>Return to this tab and <a href="${esc(returnUrl)}">click here to continue</a></li>
  </ol>
</div>
<p style="color:#888;font-size:0.875rem;margin-top:32px">
  Attempting to authorize: ${esc(client_id || 'unknown client')}
</p>
</body></html>`);
}

router.get('/authorize', authorizeLimiter, requireAuthOrSignInPage, (req, res) => {
  const { client_id, redirect_uri, state, response_type, code_challenge, code_challenge_method, mcp_slug } = req.query;

  if (response_type !== 'code')
    return res.status(400).json({ error: 'unsupported_response_type' });
  if (!client_id || typeof client_id !== 'string')
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
  if (!redirect_uri || typeof redirect_uri !== 'string')
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri required' });
  if (!state || typeof state !== 'string')
    return res.status(400).json({ error: 'invalid_request', error_description: 'state required' });
  // PKCE validation (RFC 7636)
  if (code_challenge !== undefined) {
    if (typeof code_challenge !== 'string' || code_challenge.length < 43 || code_challenge.length > 128) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge length must be 43-128 characters' });
    }
    if (code_challenge_method !== undefined && code_challenge_method !== 'S256') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge_method must be S256' });
    }
  }

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

  // Pass PKCE params and mcp_slug through to the form
  const pkceFields = (code_challenge
    ? `<input type="hidden" name="code_challenge" value="${esc(code_challenge)}">\n` +
      `<input type="hidden" name="code_challenge_method" value="${esc(code_challenge_method || 'S256')}">`
    : '') +
    (mcp_slug ? `<input type="hidden" name="mcp_slug" value="${esc(mcp_slug)}">` : '');

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
  ${pkceFields}
  <div class="card"><strong>Select an agent</strong>${agentOptions}</div>
  ${agents.length > 0 ? '<button type="submit">Authorize</button>' : ''}
</form>
<a class="cancel" href="${esc(buildCancelRedirect(redirect_uri, state))}">Cancel</a>
</body></html>`);
});

// ── POST /oauth/authorize ─────────────────────────────────────────────────────

router.post('/authorize', authorizeLimiter, requireAuth, (req, res) => {
  const { client_id, redirect_uri, state, api_key_id, code_challenge, code_challenge_method, mcp_slug } = req.body || {};
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

  // PKCE: store code_challenge and code_challenge_method if provided (RFC 7636)
  const pkceChallenge = code_challenge && typeof code_challenge === 'string' ? code_challenge : null;
  const pkceMethod = pkceChallenge && code_challenge_method && typeof code_challenge_method === 'string'
    ? code_challenge_method
    : null;
  // Store mcp_slug if provided (for multi-tenant MCP support)
  const storedMcpSlug = mcp_slug && typeof mcp_slug === 'string' ? mcp_slug : null;

  const rawCode = generateToken('coauth_');
  const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();
  db.prepare(
    `INSERT INTO oauth_codes (id, client_id, user_id, api_key_id, code_hash, redirect_uri, state, expires_at, code_challenge, code_challenge_method, mcp_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(uuidv4(), client_id, user.id, api_key_id, sha256(rawCode), redirect_uri, state, expires, pkceChallenge, pkceMethod, storedMcpSlug);

  bizEvent('oauth.code_issued', { client_id, user_id: user.id, api_key_id });

  const url = new URL(redirect_uri);
  url.searchParams.set('code', rawCode);
  url.searchParams.set('state', state);
  return res.redirect(302, url.toString());
});

// ── POST /oauth/token ─────────────────────────────────────────────────────────

router.post('/token', tokenLimiter, (req, res) => {
  const body = req.body || {};
  const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier } = body;

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

    // PKCE verification (RFC 7636)
    if (row.code_challenge) {
      if (!code_verifier || typeof code_verifier !== 'string') {
        return { error: 'invalid_grant', error_description: 'code_verifier required for PKCE' };
      }
      if (row.code_challenge_method === 'S256') {
        // code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
        const expectedChallenge = crypto
          .createHash('sha256')
          .update(code_verifier)
          .digest('base64url'); // base64url encoding (no padding, -_ instead of +/)
        if (expectedChallenge !== row.code_challenge) {
          return { error: 'invalid_grant', error_description: 'PKCE verification failed' };
        }
      } else {
        // Unsupported code_challenge_method
        return { error: 'invalid_grant', error_description: 'Unsupported code_challenge_method' };
      }
    }

    db.prepare(`UPDATE oauth_codes SET used_at = datetime('now') WHERE id = ?`).run(row.id);
    return row;
  })();

  if (!result) return res.status(400).json({ error: 'invalid_grant' });
  if (result.error) return res.status(400).json(result);

  const rawToken = generateToken('cora_mcp_');
  const expires = new Date(Date.now() + TOKEN_TTL_HOURS * 3_600_000).toISOString();
  const tokenMcpSlug = result.mcp_slug || null;

  db.prepare(
    `INSERT INTO oauth_tokens (id, client_id, user_id, api_key_id, token_hash, expires_at, mcp_slug)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uuidv4(), client_id, result.user_id, result.api_key_id, sha256(rawToken), expires, tokenMcpSlug);

  bizEvent('oauth.token_issued', { client_id, user_id: result.user_id, api_key_id: result.api_key_id, mcp_slug: result.mcp_slug });

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
