// Integration tests for the server-held wallet dashboard routes:
//
//   POST /dashboard/api-keys/:id/server-wallet  — create (201, address only)
//   GET  /dashboard/api-keys/:id/server-wallet  — read public info
//   PATCH /dashboard/api-keys/:id               — wallet_public_key edit
//                                                 blocked while server wallet
//
// Covers tenancy isolation (foreign agent → 404), the 409 conflict
// paths, the 503 vault-key-missing path, and — most importantly — that
// no response ever contains secret key material.

require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { StrKey, Keypair } = require('@stellar/stellar-sdk');
const { request, db, createTestSession, createTestKey, resetDb } = require('../helpers/app');

const GOOD_KEY = 'e'.repeat(64);

/** Create a user + session + dashboard, return auth header + dashboard id. */
function sessionWithDashboard(email = 'wallet-owner@cora.test') {
  const { token, userId } = createTestSession({ email });
  const dashboardId = uuidv4();
  db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(
    dashboardId,
    userId,
    'Wallet test dashboard',
  );
  return { auth: `Bearer ${token}`, dashboardId };
}

async function createAgentInDashboard(dashboardId) {
  const { id } = await createTestKey({ label: 'server-wallet-agent' });
  db.prepare(`UPDATE api_keys SET dashboard_id = ? WHERE id = ?`).run(dashboardId, id);
  return id;
}

describe('server-wallet dashboard routes', () => {
  let origBoxKey;

  beforeEach(() => {
    resetDb();
    origBoxKey = process.env.CORA_SECRET_BOX_KEY;
    process.env.CORA_SECRET_BOX_KEY = GOOD_KEY;
  });

  afterEach(() => {
    if (origBoxKey === undefined) delete process.env.CORA_SECRET_BOX_KEY;
    else process.env.CORA_SECRET_BOX_KEY = origBoxKey;
  });

  it('POST creates a wallet and returns only the public address', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);

    const res = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);

    assert.equal(res.status, 201);
    assert.equal(res.body.api_key_id, agentId);
    assert.equal(res.body.custody, 'server');
    assert.equal(res.body.network, 'testnet');
    assert.ok(StrKey.isValidEd25519PublicKey(res.body.public_key));

    // No secret material anywhere in the response.
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('secret'), 'response must not contain secret fields');
    assert.ok(!/\bS[A-Z2-7]{55}\b/.test(raw), 'response must not contain an S-key');

    // Mirrored onto api_keys for the funding UI.
    const row = db.prepare(`SELECT wallet_public_key FROM api_keys WHERE id = ?`).get(agentId);
    assert.equal(row.wallet_public_key, res.body.public_key);

    // Audit trail landed.
    const audit = db
      .prepare(`SELECT * FROM audit_log WHERE action = 'agent.server_wallet_create'`)
      .get();
    assert.ok(audit, 'audit row recorded');
  });

  it('GET returns public wallet info after creation, 404 before', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);

    const before = await request
      .get(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(before.status, 404);
    assert.equal(before.body.error, 'no_server_wallet');

    const created = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(created.status, 201);

    const after = await request
      .get(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(after.status, 200);
    assert.equal(after.body.public_key, created.body.public_key);
    assert.equal(after.body.custody, 'server');
    assert.ok(!JSON.stringify(after.body).includes('secret'));
  });

  it('POST twice → 409 wallet_exists', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);

    const first = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(first.status, 201);

    const second = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'wallet_exists');
  });

  it('POST on an agent with an external wallet → 409 external_wallet_exists', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);
    db.prepare(`UPDATE api_keys SET wallet_public_key = ? WHERE id = ?`).run(
      Keypair.random().publicKey(),
      agentId,
    );

    const res = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'external_wallet_exists');
  });

  it('POST without CORA_SECRET_BOX_KEY → 503 vault_key_missing, nothing persisted', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);
    delete process.env.CORA_SECRET_BOX_KEY;

    const res = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', auth);
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'vault_key_missing');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM agent_wallets`).get().n, 0);
  });

  it("another dashboard's agent reads as 404 (tenancy isolation)", async () => {
    const owner = sessionWithDashboard('owner-a@cora.test');
    const intruder = sessionWithDashboard('owner-b@cora.test');
    const agentId = await createAgentInDashboard(owner.dashboardId);

    const post = await request
      .post(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', intruder.auth);
    assert.equal(post.status, 404);

    const get = await request
      .get(`/dashboard/api-keys/${agentId}/server-wallet`)
      .set('Authorization', intruder.auth);
    assert.equal(get.status, 404);
  });

  it('PATCH wallet_public_key is blocked while a server wallet exists', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);

    await request.post(`/dashboard/api-keys/${agentId}/server-wallet`).set('Authorization', auth);

    const res = await request
      .patch(`/dashboard/api-keys/${agentId}`)
      .set('Authorization', auth)
      .send({ wallet_public_key: Keypair.random().publicKey() });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'server_wallet_managed');
  });

  it('agent deletion leaves the wallet row intact (funds recoverable)', async () => {
    const { auth, dashboardId } = sessionWithDashboard();
    const agentId = await createAgentInDashboard(dashboardId);
    await request.post(`/dashboard/api-keys/${agentId}/server-wallet`).set('Authorization', auth);

    const del = await request.delete(`/dashboard/api-keys/${agentId}`).set('Authorization', auth);
    assert.equal(del.status, 200);

    const wallet = db.prepare(`SELECT * FROM agent_wallets WHERE api_key_id = ?`).get(agentId);
    assert.ok(wallet, 'sealed wallet row survives agent deletion');
  });
});
