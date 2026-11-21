// Integration tests for the MCP HTTP endpoint (POST /mcp).
//
// Full Express → auth → MCP SDK → tool handler stack with real in-memory DB.
// Network calls (Horizon, wallet-signer) are stubbed.

require('../helpers/env');
process.env.MCP_ENABLED = 'true';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');

// Re-require app AFTER setting MCP_ENABLED so the router mounts.
delete require.cache[require.resolve('../../src/app')];
const supertest = require('supertest');
const app = require('../../src/app');
const { db, createTestKey, resetDb } = require('../helpers/app');
const request = supertest(app);

// ── Helpers ───────────────────────────────────────────────────────────────────
// The StreamableHTTP transport always responds with Content-Type: text/event-stream.
// Each SSE frame is  "event: message\ndata: <json>\n\n".
// Parse all data lines and return the first JSON-RPC result object.

function parseSseBody(text) {
  const frames = [];
  for (const line of (text || '').split('\n')) {
    if (line.startsWith('data: ')) {
      try { frames.push(JSON.parse(line.slice(6))); } catch { /* skip malformed */ }
    }
  }
  // Return the frame whose id matches or just the first one.
  return frames[0] ?? null;
}

async function mcpCall(apiKey, body) {
  const res = await request
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .set('X-Api-Key', apiKey)
    .send(body);
  return { status: res.status, headers: res.headers, raw: res, frame: parseSseBody(res.text) };
}

const initMsg  = (id = 1) => ({ jsonrpc: '2.0', id, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
const listMsg  = (id = 2) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
const callMsg  = (name, args, id = 3) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('MCP — auth', () => {
  beforeEach(resetDb);

  it('401 when X-Api-Key is missing', async () => {
    const res = await request.post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send(initMsg());
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_api_key');
  });

  it('401 for a wrong key', async () => {
    const { status } = await mcpCall('cora_' + 'b'.repeat(48), initMsg());
    assert.equal(status, 401);
  });

  it('405 on GET /mcp', async () => {
    const res = await request.get('/mcp');
    assert.equal(res.status, 405);
  });
});

// ── Protocol ──────────────────────────────────────────────────────────────────

describe('MCP — protocol', () => {
  let key;
  beforeEach(async () => { resetDb(); ({ key } = await createTestKey({ label: 'proto' })); });

  it('responds to initialize with serverInfo.name=cora', async () => {
    const { status, frame } = await mcpCall(key, initMsg());
    assert.equal(status, 200);
    assert.equal(frame?.jsonrpc, '2.0');
    assert.equal(frame?.result?.serverInfo?.name, 'cora');
  });

  it('lists exactly four tools', async () => {
    const { status, frame } = await mcpCall(key, listMsg());
    assert.equal(status, 200);
    const names = (frame?.result?.tools ?? []).map((t) => t.name).sort();
    assert.deepEqual(names, ['check_budget', 'check_order', 'purchase_vcc', 'wallet_balance']);
  });

  it('purchase_vcc has destructiveHint=true', async () => {
    const { frame } = await mcpCall(key, listMsg());
    const tool = (frame?.result?.tools ?? []).find((t) => t.name === 'purchase_vcc');
    assert.ok(tool, 'purchase_vcc found');
    assert.equal(tool.annotations?.destructiveHint, true);
  });
});

// ── check_budget ──────────────────────────────────────────────────────────────

describe('MCP — check_budget tool', () => {
  let key;
  beforeEach(async () => { resetDb(); ({ key } = await createTestKey({ label: 'budget', spendLimit: '500.00' })); });

  it('returns budget fields', async () => {
    const { status, frame } = await mcpCall(key, callMsg('check_budget', {}));
    assert.equal(status, 200);
    const body = JSON.parse(frame.result.content[0].text);
    assert.equal(body.budget.limit_usdc, '500.00');
    assert.equal(body.budget.spent_usdc, '0.00');
    assert.equal(body.policy, null);
  });

  it('includes policy dry-run with amount_usdc', async () => {
    const { frame } = await mcpCall(key, callMsg('check_budget', { amount_usdc: '25.00' }));
    const body = JSON.parse(frame.result.content[0].text);
    assert.ok(['approved', 'blocked', 'pending_approval'].includes(body.policy?.decision));
  });
});

// ── check_order ───────────────────────────────────────────────────────────────

describe('MCP — check_order tool', () => {
  let key, keyId;
  beforeEach(async () => { resetDb(); const r = await createTestKey({ label: 'ord' }); key = r.key; keyId = r.id; });

  it('toolError for a missing order_id', async () => {
    const { frame } = await mcpCall(key, callMsg('check_order', { order_id: uuidv4() }));
    assert.equal(frame.result.isError, true);
    assert.ok(frame.result.content[0].text.includes('not found'));
  });

  it('returns order status for a known order', async () => {
    const orderId = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id)
       VALUES (?, 'pending_payment', '25.00', 'usdc', ?)`,
    ).run(orderId, keyId);
    const { frame } = await mcpCall(key, callMsg('check_order', { order_id: orderId }));
    const body = JSON.parse(frame.result.content[0].text);
    assert.equal(body.order_id, orderId);
    assert.equal(body.phase, 'awaiting_payment');
  });

  it('includes card fields for a delivered order', async () => {
    const orderId = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id,
                           card_number, card_cvv, card_expiry, card_brand)
       VALUES (?, 'delivered', '25.00', 'usdc', ?, '4111111111111111', '123', '12/28', 'Visa')`,
    ).run(orderId, keyId);
    const { frame } = await mcpCall(key, callMsg('check_order', { order_id: orderId }));
    const body = JSON.parse(frame.result.content[0].text);
    assert.equal(body.phase, 'ready');
    assert.equal(body.card.number, '4111111111111111');
  });
});

// ── purchase_vcc — input validation (no payment) ──────────────────────────────

describe('MCP — purchase_vcc input validation', () => {
  let key;
  beforeEach(async () => { resetDb(); ({ key } = await createTestKey({ label: 'purch' })); });

  it('toolError for a bad amount', async () => {
    const { frame } = await mcpCall(key, callMsg('purchase_vcc', { amount_usdc: 'oops' }));
    assert.equal(frame.result.isError, true);
    assert.ok(frame.result.content[0].text.includes('positive decimal'));
  });

  it('toolError when agent has no server wallet', async () => {
    const { frame } = await mcpCall(key, callMsg('purchase_vcc', { amount_usdc: '25.00' }));
    assert.equal(frame.result.isError, true);
    assert.ok(frame.result.content[0].text.toLowerCase().includes('wallet'));
  });
});
