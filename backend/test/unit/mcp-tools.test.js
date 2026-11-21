// Unit tests for backend/src/mcp/tools.js
//
// Tests the four tool handler functions in isolation — no MCP SDK, no HTTP.
// All DB interactions use the in-memory test database; network calls are
// stubbed via global.fetch overrides (same pattern as the rest of the suite).

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { db, createTestKey, resetDb } = require('../helpers/app');

function freshTools() {
  delete require.cache[require.resolve('../../src/mcp/tools')];
  return require('../../src/mcp/tools');
}

function seedOrder({ apiKeyId, status = 'pending_payment', amountUsdc = '25.00',
  cardNumber = null, cardCvv = null, cardExpiry = null, cardBrand = null, error = null } = {}) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id,
                         card_number, card_cvv, card_expiry, card_brand, error)
     VALUES (?, ?, ?, 'usdc', ?, ?, ?, ?, ?, ?)`,
  ).run(id, status, amountUsdc, apiKeyId, cardNumber, cardCvv, cardExpiry, cardBrand, error);
  return id;
}

// ── mapStatusToPhase ──────────────────────────────────────────────────────────

describe('mcp-tools — mapStatusToPhase', () => {
  it('maps every known status to its phase', () => {
    const { mapStatusToPhase } = freshTools();
    assert.equal(mapStatusToPhase('awaiting_approval'), 'awaiting_approval');
    assert.equal(mapStatusToPhase('pending_payment'),   'awaiting_payment');
    assert.equal(mapStatusToPhase('ordering'),          'processing');
    assert.equal(mapStatusToPhase('refund_pending'),    'processing');
    assert.equal(mapStatusToPhase('delivered'),         'ready');
    assert.equal(mapStatusToPhase('failed'),            'failed');
    assert.equal(mapStatusToPhase('refunded'),          'refunded');
    assert.equal(mapStatusToPhase('rejected'),          'rejected');
    assert.equal(mapStatusToPhase('expired'),           'expired');
  });

  it('passes unknown statuses through unchanged', () => {
    const { mapStatusToPhase } = freshTools();
    assert.equal(mapStatusToPhase('something_new'), 'something_new');
  });
});

// ── check_budget ──────────────────────────────────────────────────────────────

describe('mcp-tools — handleCheckBudget', () => {
  beforeEach(resetDb);

  it('returns budget with no policy when amount_usdc is omitted', async () => {
    const { id } = await createTestKey({ spendLimit: '100.00' });
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const { handleCheckBudget } = freshTools();
    const result = handleCheckBudget(apiKey, {});
    assert.equal(result.isError, undefined);
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.budget.limit_usdc, '100.00');
    assert.equal(body.budget.spent_usdc, '0.00');
    assert.equal(body.policy, null);
  });

  it('includes policy dry-run when amount_usdc is provided', async () => {
    const { id } = await createTestKey({ spendLimit: '100.00' });
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const { handleCheckBudget } = freshTools();
    const body = JSON.parse(handleCheckBudget(apiKey, { amount_usdc: '25.00' }).content[0].text);
    assert.ok(['approved', 'blocked', 'pending_approval'].includes(body.policy.decision));
  });

  it('returns toolError for non-numeric amount_usdc', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const { handleCheckBudget } = freshTools();
    const result = handleCheckBudget(apiKey, { amount_usdc: 'free' });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('positive decimal'));
  });

  it('returns toolError for zero amount_usdc', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    assert.equal(freshTools().handleCheckBudget(apiKey, { amount_usdc: '0' }).isError, true);
  });
});

// ── check_order ───────────────────────────────────────────────────────────────

describe('mcp-tools — handleCheckOrder', () => {
  beforeEach(resetDb);

  it('returns toolError for empty order_id', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const result = freshTools().handleCheckOrder(apiKey, { order_id: '' });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('order_id is required'));
  });

  it('returns toolError for order belonging to another agent', async () => {
    const { id: myId } = await createTestKey({ label: 'me' });
    const { id: otherId } = await createTestKey({ label: 'other' });
    const myKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(myId);
    const orderId = seedOrder({ apiKeyId: otherId });
    const result = freshTools().handleCheckOrder(myKey, { order_id: orderId });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes('not found'));
  });

  it('returns phase=awaiting_payment for pending_payment order', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const orderId = seedOrder({ apiKeyId: id });
    const body = JSON.parse(freshTools().handleCheckOrder(apiKey, { order_id: orderId }).content[0].text);
    assert.equal(body.phase, 'awaiting_payment');
    assert.equal(body.card, undefined);
  });

  it('includes card fields when status is delivered', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const orderId = seedOrder({ apiKeyId: id, status: 'delivered',
      cardNumber: '4111111111111111', cardCvv: '123', cardExpiry: '12/28', cardBrand: 'Visa' });
    const body = JSON.parse(freshTools().handleCheckOrder(apiKey, { order_id: orderId }).content[0].text);
    assert.equal(body.phase, 'ready');
    assert.equal(body.card.number, '4111111111111111');
    assert.equal(body.card.cvv, '123');
  });

  it('includes error field when order has an error', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const orderId = seedOrder({ apiKeyId: id, status: 'failed', error: 'fulfillment_timeout' });
    const body = JSON.parse(freshTools().handleCheckOrder(apiKey, { order_id: orderId }).content[0].text);
    assert.equal(body.phase, 'failed');
    assert.equal(body.error, 'fulfillment_timeout');
  });
});

// ── wallet_balance ────────────────────────────────────────────────────────────

describe('mcp-tools — handleWalletBalance', () => {
  const PUB = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  beforeEach(resetDb);

  it('returns no-wallet message when wallet_public_key is null', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const body = JSON.parse((await freshTools().handleWalletBalance(apiKey)).content[0].text);
    assert.equal(body.wallet, null);
    assert.ok(body.message.toLowerCase().includes('wallet'));
  });

  it('returns toolError when Horizon is unreachable', async () => {
    const { id } = await createTestKey();
    db.prepare(`UPDATE api_keys SET wallet_public_key = ? WHERE id = ?`).run(PUB, id);
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const orig = global.fetch;
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    try {
      const r = await freshTools().handleWalletBalance(apiKey);
      assert.equal(r.isError, true);
      assert.ok(r.content[0].text.includes('Horizon'));
    } finally { global.fetch = orig; }
  });

  it('returns unfunded message on 404', async () => {
    const { id } = await createTestKey();
    db.prepare(`UPDATE api_keys SET wallet_public_key = ? WHERE id = ?`).run(PUB, id);
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const orig = global.fetch;
    global.fetch = async () => ({ ok: false, status: 404 });
    try {
      const body = JSON.parse((await freshTools().handleWalletBalance(apiKey)).content[0].text);
      assert.deepEqual(body.balances, []);
      assert.ok(body.message.includes('not yet funded'));
    } finally { global.fetch = orig; }
  });

  it('filters balances to XLM and USDC, dropping unknown assets', async () => {
    const { id } = await createTestKey();
    db.prepare(`UPDATE api_keys SET wallet_public_key = ? WHERE id = ?`).run(PUB, id);
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const issuer = process.env.STELLAR_USDC_ISSUER || 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
    const orig = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ balances: [
        { asset_type: 'native', balance: '10.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer, balance: '25.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'yXLM', asset_issuer: 'GOTHER', balance: '5.0' },
      ] }),
    });
    try {
      const body = JSON.parse((await freshTools().handleWalletBalance(apiKey)).content[0].text);
      assert.equal(body.balances.length, 2);
      assert.ok(body.balances.find((b) => b.asset === 'XLM'));
      assert.ok(body.balances.find((b) => b.asset === 'USDC'));
      assert.ok(!body.balances.find((b) => b.asset === 'yXLM'));
    } finally { global.fetch = orig; }
  });
});

// ── purchase_vcc — input validation (no payment attempted) ────────────────────

describe('mcp-tools — handlePurchaseVcc input validation', () => {
  beforeEach(resetDb);

  it('returns toolError for non-numeric amount', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const r = await freshTools().handlePurchaseVcc(apiKey, { amount_usdc: 'free' });
    assert.equal(r.isError, true);
    assert.ok(r.content[0].text.includes('positive decimal'));
  });

  it('returns toolError for zero amount', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    assert.equal((await freshTools().handlePurchaseVcc(apiKey, { amount_usdc: '0.00' })).isError, true);
  });

  it('returns toolError when no server wallet exists for the agent', async () => {
    const { id } = await createTestKey();
    const apiKey = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    const r = await freshTools().handlePurchaseVcc(apiKey, { amount_usdc: '25.00' });
    assert.equal(r.isError, true);
    assert.ok(r.content[0].text.toLowerCase().includes('wallet'));
  });
});
