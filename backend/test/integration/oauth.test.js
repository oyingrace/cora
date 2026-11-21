// Integration tests for the OAuth 2.0 flow (Phase 3).
// Tests the full authorize → token → MCP chain plus all rejection paths.

require('../helpers/env');
process.env.OAUTH_ENABLED = 'true';
process.env.MCP_ENABLED   = 'true';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

delete require.cache[require.resolve('../../src/app')];
const supertest = require('supertest');
const app = require('../../src/app');
const { db, createTestKey, createTestSession, resetDb } = require('../helpers/app');
const request = supertest(app);

// ── Seed helpers ──────────────────────────────────────────────────────────────

const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function seedOAuthClient(overrides = {}) {
  const id = uuidv4();
  const clientId = `cora_oauth_${crypto.randomBytes(6).toString('hex')}`;
  const rawSecret = `cora_secret_${crypto.randomBytes(12).toString('hex')}`;
  const redirectUri = overrides.redirect_uri || REDIRECT_URI;
  db.prepare(
    `INSERT INTO oauth_clients (id, client_id, client_secret_hash, redirect_uri, name)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, clientId, sha256(rawSecret), redirectUri, overrides.name || 'Test Client');
  return { id, client_id: clientId, client_secret: rawSecret, redirect_uri: redirectUri };
}

async function seedUserWithAgent(email = 'oauth@cora.test') {
  const { token, userId } = createTestSession({ email });
  const dashboardId = uuidv4();
  db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(dashboardId, userId, 'OAuthTest');
  const { id: agentId } = await createTestKey({ label: 'oauth-agent' });
  db.prepare(`UPDATE api_keys SET dashboard_id = ? WHERE id = ?`).run(dashboardId, agentId);
  return { token, userId, dashboardId, agentId };
}

function parseSseBody(text) {
  for (const line of (text || '').split('\n')) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch { /* skip */ }
    }
  }
  return null;
}

// ── GET /oauth/authorize ──────────────────────────────────────────────────────

describe('OAuth — GET /oauth/authorize', () => {
  beforeEach(resetDb);

  it('401 without a Cora session', async () => {
    const c = seedOAuthClient();
    const res = await request.get('/oauth/authorize')
      .query({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 'x' });
    assert.equal(res.status, 401);
  });

  it('400 for unsupported response_type', async () => {
    const { token } = await seedUserWithAgent();
    const c = seedOAuthClient();
    const res = await request.get('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .query({ response_type: 'token', client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'unsupported_response_type');
  });

  it('400 for unknown client_id', async () => {
    const { token } = await seedUserWithAgent();
    const res = await request.get('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .query({ response_type: 'code', client_id: 'unknown', redirect_uri: REDIRECT_URI, state: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_client');
  });

  it('400 for mismatched redirect_uri', async () => {
    const { token } = await seedUserWithAgent();
    const c = seedOAuthClient();
    const res = await request.get('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .query({ response_type: 'code', client_id: c.client_id, redirect_uri: 'https://evil.com/cb', state: 'x' });
    assert.equal(res.status, 400);
  });

  it('400 when state is missing', async () => {
    const { token } = await seedUserWithAgent();
    const c = seedOAuthClient();
    const res = await request.get('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .query({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT_URI });
    assert.equal(res.status, 400);
  });

  it('200 renders HTML agent-picker with valid params', async () => {
    const { token, agentId } = await seedUserWithAgent();
    const c = seedOAuthClient();
    const res = await request.get('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .query({ response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 'abc' });
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Authorize'));
    assert.ok(res.text.includes(agentId.slice(0, 8)));
  });
});

// ── POST /oauth/authorize ─────────────────────────────────────────────────────

describe('OAuth — POST /oauth/authorize', () => {
  beforeEach(resetDb);

  it('redirects with code + state on success', async () => {
    const { token, agentId } = await seedUserWithAgent();
    const c = seedOAuthClient();
    const res = await request.post('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 'st', api_key_id: agentId });
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.location);
    assert.equal(loc.origin + loc.pathname, REDIRECT_URI);
    assert.ok(loc.searchParams.get('code')?.startsWith('coauth_'));
    assert.equal(loc.searchParams.get('state'), 'st');
  });

  it('403 when agent belongs to a different user', async () => {
    const { token } = await seedUserWithAgent('a@cora.test');
    const { agentId: other } = await seedUserWithAgent('b@cora.test');
    const c = seedOAuthClient();
    const res = await request.post('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 's', api_key_id: other });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'access_denied');
  });

  it('400 for missing fields', async () => {
    const { token } = await seedUserWithAgent();
    const res = await request.post('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`).send({ client_id: 'x' });
    assert.equal(res.status, 400);
  });
});

// ── POST /oauth/token ─────────────────────────────────────────────────────────

describe('OAuth — POST /oauth/token', () => {
  beforeEach(resetDb);

  async function issueCode() {
    const { token, agentId } = await seedUserWithAgent();
    const client = seedOAuthClient();
    const res = await request.post('/oauth/authorize')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: client.client_id, redirect_uri: REDIRECT_URI, state: 's', api_key_id: agentId });
    return { code: new URL(res.headers.location).searchParams.get('code'), client, agentId };
  }

  it('returns access_token for a valid code exchange', async () => {
    const { code, client } = await issueCode();
    const res = await request.post('/oauth/token').send({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: client.client_id, client_secret: client.client_secret,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.access_token?.startsWith('cora_mcp_'));
    assert.equal(res.body.token_type, 'Bearer');
    assert.ok(typeof res.body.expires_in === 'number');
  });

  it('400 on code replay — single-use enforced', async () => {
    const { code, client } = await issueCode();
    const body = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: client.client_id, client_secret: client.client_secret };
    assert.equal((await request.post('/oauth/token').send(body)).status, 200);
    assert.equal((await request.post('/oauth/token').send(body)).body.error, 'invalid_grant');
  });

  it('400 for unsupported grant_type', async () => {
    const { client } = await issueCode();
    const res = await request.post('/oauth/token').send({ grant_type: 'client_credentials',
      client_id: client.client_id, client_secret: client.client_secret });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'unsupported_grant_type');
  });

  it('401 for wrong client_secret', async () => {
    const { code, client } = await issueCode();
    const res = await request.post('/oauth/token').send({ grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI, client_id: client.client_id, client_secret: 'wrong' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_client');
  });

  it('400 for mismatched redirect_uri at token exchange', async () => {
    const { code, client } = await issueCode();
    const res = await request.post('/oauth/token').send({ grant_type: 'authorization_code', code,
      redirect_uri: 'https://different.com/cb', client_id: client.client_id, client_secret: client.client_secret });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_grant');
  });
});

// ── GET /oauth/userinfo ───────────────────────────────────────────────────────

describe('OAuth — GET /oauth/userinfo', () => {
  beforeEach(resetDb);

  async function fullTokenFlow(email = 'info@cora.test') {
    const { token: sToken, agentId } = await seedUserWithAgent(email);
    const c = seedOAuthClient();
    const authRes = await request.post('/oauth/authorize').set('Authorization', `Bearer ${sToken}`)
      .send({ client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 's', api_key_id: agentId });
    const code = new URL(authRes.headers.location).searchParams.get('code');
    const { body } = await request.post('/oauth/token').send({ grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI, client_id: c.client_id, client_secret: c.client_secret });
    return { access_token: body.access_token, agentId };
  }

  it('returns user + agent info for a valid token', async () => {
    const { access_token, agentId } = await fullTokenFlow();
    const res = await request.get('/oauth/userinfo').set('Authorization', `Bearer ${access_token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'info@cora.test');
    assert.equal(res.body.agent_id, agentId);
  });

  it('401 for a missing token', async () => {
    assert.equal((await request.get('/oauth/userinfo')).status, 401);
  });

  it('401 for an unknown token', async () => {
    assert.equal((await request.get('/oauth/userinfo').set('Authorization', 'Bearer bogus')).status, 401);
  });
});

// ── Full flow: OAuth Bearer → MCP tool call ───────────────────────────────────

describe('OAuth → MCP integration', () => {
  beforeEach(resetDb);

  it('MCP accepts OAuth Bearer token and returns check_budget', async () => {
    const { token: sToken, agentId } = await seedUserWithAgent('mcp@cora.test');
    const c = seedOAuthClient();
    const authRes = await request.post('/oauth/authorize').set('Authorization', `Bearer ${sToken}`)
      .send({ client_id: c.client_id, redirect_uri: REDIRECT_URI, state: 'st', api_key_id: agentId });
    const code = new URL(authRes.headers.location).searchParams.get('code');
    const { body: { access_token } } = await request.post('/oauth/token').send({
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      client_id: c.client_id, client_secret: c.client_secret,
    });
    const mcpRes = await request.post('/mcp')
      .set('Authorization', `Bearer ${access_token}`)
      .set('Content-Type', 'application/json').set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'check_budget', arguments: {} } });
    assert.equal(mcpRes.status, 200);
    const frame = parseSseBody(mcpRes.text);
    assert.ok(JSON.parse(frame.result.content[0].text).budget);
  });

  it('MCP returns 401 for a bogus Bearer token', async () => {
    const res = await request.post('/mcp')
      .set('Authorization', 'Bearer cora_mcp_bogus')
      .set('Content-Type', 'application/json').set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_token');
  });
});

// ── Dashboard client management ───────────────────────────────────────────────

describe('OAuth — dashboard client management', () => {
  beforeEach(resetDb);

  async function dashSession(email = 'owner@cora.test') {
    const { token, userId } = createTestSession({ email });
    const dId = uuidv4();
    db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(dId, userId, 'T');
    return `Bearer ${token}`;
  }

  it('POST creates a client and returns the secret once', async () => {
    const auth = await dashSession();
    const res = await request.post('/dashboard/oauth/clients').set('Authorization', auth)
      .send({ name: 'My App', redirect_uri: 'https://example.com/cb' });
    assert.equal(res.status, 201);
    assert.ok(res.body.client_id?.startsWith('cora_oauth_'));
    assert.ok(res.body.client_secret?.startsWith('cora_secret_'));
    const row = db.prepare(`SELECT client_secret_hash FROM oauth_clients WHERE id = ?`).get(res.body.id);
    assert.ok(row.client_secret_hash && !row.client_secret_hash.includes(res.body.client_secret));
  });

  it('503 when OAUTH_ENABLED=false', async () => {
    const orig = process.env.OAUTH_ENABLED;
    process.env.OAUTH_ENABLED = 'false';
    try {
      const auth = await dashSession('b@cora.test');
      assert.equal((await request.post('/dashboard/oauth/clients').set('Authorization', auth)
        .send({ name: 'x', redirect_uri: 'https://x.com/cb' })).status, 503);
    } finally { process.env.OAUTH_ENABLED = orig; }
  });

  it('GET lists clients without secrets', async () => {
    const auth = await dashSession();
    await request.post('/dashboard/oauth/clients').set('Authorization', auth)
      .send({ name: 'A', redirect_uri: 'https://a.com/cb' });
    const res = await request.get('/dashboard/oauth/clients').set('Authorization', auth);
    assert.equal(res.status, 200);
    assert.equal(res.body.clients.length, 1);
    assert.ok(!res.body.clients[0].client_secret);
  });

  it('DELETE removes the client', async () => {
    const auth = await dashSession();
    const { body: { id } } = await request.post('/dashboard/oauth/clients').set('Authorization', auth)
      .send({ name: 'ToDelete', redirect_uri: 'https://d.com/cb' });
    assert.equal((await request.delete(`/dashboard/oauth/clients/${id}`).set('Authorization', auth)).status, 200);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM oauth_clients WHERE id = ?`).get(id).n, 0);
  });
});
