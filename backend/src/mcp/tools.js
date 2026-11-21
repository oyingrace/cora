// @ts-check
// MCP tool handler functions — pure business logic, no MCP SDK dependency.
// Keeping them separate from server.js makes unit testing straightforward:
// call the function, assert the returned { content } shape.
//
// Every handler receives the already-authenticated apiKey record and
// returns the MCP content array the server forwards to the client.
// Errors are returned as { isError: true, content } rather than thrown
// so the MCP framework surfaces them as tool errors (not server crashes).
//
// Tool inventory:
//   check_budget    — read-only: spend limit, settled, in-flight
//   check_order     — read-only: order status + card once delivered
//   wallet_balance  — read-only: on-chain XLM + USDC balance
//   purchase_vcc    — action: create order, pay from server wallet, return card

'use strict';

/** @type {any} */
const db = require('../db');
const { buildBudget, policyCheck } = require('../api/orders');
const { openCard } = require('../lib/card-vault');
const { event: bizEvent } = require('../lib/logger');

// ── check_budget ─────────────────────────────────────────────────────────────

/**
 * @param {any} apiKey
 * @param {{ amount_usdc?: string }} args
 */
function handleCheckBudget(apiKey, args) {
  const budget = buildBudget(apiKey);
  let policy = null;
  if (args.amount_usdc !== undefined) {
    const raw = String(args.amount_usdc || '');
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || parseFloat(raw) <= 0) {
      return toolError(`amount_usdc must be a positive decimal string, got: ${JSON.stringify(raw)}`);
    }
    policy = policyCheck(apiKey.id, parseFloat(raw));
  }
  return json({ budget, policy });
}

// ── check_order ───────────────────────────────────────────────────────────────

/**
 * @param {any} apiKey
 * @param {{ order_id: string }} args
 */
function handleCheckOrder(apiKey, args) {
  const orderId = String(args.order_id || '').trim();
  if (!orderId) return toolError('order_id is required');

  const row = /** @type {any} */ (
    db.prepare(
      `SELECT id, status, amount_usdc, payment_asset, stellar_txid,
              card_number, card_cvv, card_expiry, card_brand,
              created_at, updated_at, error
       FROM orders WHERE id = ? AND api_key_id = ?`,
    ).get(orderId, apiKey.id)
  );
  if (!row) return toolError(`Order ${orderId} not found (or belongs to a different agent)`);

  /** @type {Record<string, any>} */
  const result = {
    order_id: row.id,
    phase: mapStatusToPhase(row.status),
    status: row.status,
    amount_usdc: row.amount_usdc,
    payment_asset: row.payment_asset,
    stellar_txid: row.stellar_txid || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  if (row.status === 'delivered' && row.card_number) {
    try {
      result.card = openCard({
        card_number: row.card_number,
        card_cvv: row.card_cvv,
        card_expiry: row.card_expiry,
        card_brand: row.card_brand,
      });
    } catch (err) {
      result.card_error = err instanceof Error ? err.message : String(err);
    }
  }
  if (row.error) result.error = row.error;
  return json(result);
}

// ── wallet_balance ────────────────────────────────────────────────────────────

/** @param {any} apiKey */
async function handleWalletBalance(apiKey) {
  const walletKey = apiKey.wallet_public_key;
  if (!walletKey) {
    return json({ wallet: null, message: 'No wallet set. Create one via the dashboard.' });
  }
  const isMainnet = process.env.STELLAR_NETWORK === 'mainnet';
  const horizonBase = isMainnet
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

  let accountData = null;
  let horizonError = null;
  try {
    const resp = await fetch(`${horizonBase}/accounts/${walletKey}`);
    if (resp.ok) {
      accountData = await resp.json();
    } else if (resp.status === 404) {
      return json({
        wallet: { public_key: walletKey, network: isMainnet ? 'mainnet' : 'testnet' },
        balances: [],
        message: 'Account not yet funded (does not exist on-chain).',
      });
    } else {
      horizonError = `Horizon returned ${resp.status}`;
    }
  } catch (err) {
    horizonError = err instanceof Error ? err.message : String(err);
  }
  if (horizonError || !accountData) {
    return toolError(`Could not reach Stellar Horizon: ${horizonError}`);
  }

  const USDC_ISSUER =
    process.env.STELLAR_USDC_ISSUER || 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const balances = (accountData.balances || [])
    .filter(
      (/** @type {any} */ b) =>
        b.asset_type === 'native' ||
        (b.asset_type === 'credit_alphanum4' && b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER),
    )
    .map((/** @type {any} */ b) => ({ asset: b.asset_type === 'native' ? 'XLM' : 'USDC', balance: b.balance }));

  return json({ wallet: { public_key: walletKey, network: isMainnet ? 'mainnet' : 'testnet' }, balances });
}

// ── purchase_vcc ─────────────────────────────────────────────────────────────

/**
 * Create an order and pay from the agent's server-held wallet.
 * Returns the card when fulfilled, or order_id to poll if it takes longer.
 *
 * @param {any}    apiKey
 * @param {{ amount_usdc: string, payment_asset?: string, webhook_url?: string }} args
 * @param {string} [requestId]
 */
async function handlePurchaseVcc(apiKey, args, requestId) {
  const amountRaw = String(args.amount_usdc || '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || parseFloat(amountRaw) <= 0) {
    return toolError(`amount_usdc must be a positive decimal string, got: ${JSON.stringify(amountRaw)}`);
  }
  const paymentAsset =
    args.payment_asset === 'xlm' || args.payment_asset === 'usdc' ? args.payment_asset : 'usdc';

  const walletRow = /** @type {any} */ (
    db.prepare(`SELECT id FROM agent_wallets WHERE api_key_id = ?`).get(apiKey.id)
  );
  if (!walletRow) {
    return toolError(
      'No server-held wallet for this agent. Create one via the dashboard and fund it, then retry.',
    );
  }

  const { insertPendingPaymentOrder } = require('../orders/core');
  const { usdToXlm } = require('../payments/xlm-price');
  const { payOrderFromServerWallet } = require('../payments/wallet-signer');

  let xlmAmount = null;
  if (paymentAsset === 'xlm') {
    try {
      xlmAmount = await usdToXlm(amountRaw);
    } catch {
      return toolError('Could not fetch XLM/USD price. Retry with payment_asset="usdc".');
    }
  }

  const USDC_ISSUER =
    process.env.STELLAR_USDC_ISSUER || 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  let order;
  try {
    order = insertPendingPaymentOrder({
      apiKeyId: apiKey.id,
      amountUsdc: amountRaw,
      paymentAsset,
      xlmAmount,
      webhookUrl: args.webhook_url || apiKey.default_webhook_url || null,
      webhookSecret: apiKey.webhook_secret || null,
      usdcIssuer: USDC_ISSUER,
      requestId: requestId || null,
      metadata: null,
    });
  } catch (err) {
    return toolError(`Order could not be created: ${err instanceof Error ? err.message : String(err)}`);
  }

  bizEvent('mcp.purchase_vcc.order_created', {
    api_key_id: apiKey.id, order_id: order.id, amount_usdc: amountRaw, payment_asset: paymentAsset,
  });

  let txHash;
  try {
    txHash = await payOrderFromServerWallet(apiKey.id, order.payment, paymentAsset);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    bizEvent('mcp.purchase_vcc.payment_failed', { api_key_id: apiKey.id, order_id: order.id, error: msg });
    return toolError(`Payment failed for order ${order.id}: ${msg}. Use check_order to monitor it.`);
  }

  bizEvent('mcp.purchase_vcc.payment_sent', { api_key_id: apiKey.id, order_id: order.id, tx_hash: txHash });

  const waitMs = parseInt(process.env.MCP_PURCHASE_WAIT_MS || '90000', 10);
  const { waitForDelivery } = require('../mpp/wait-for-delivery');
  const delivery = await waitForDelivery({ orderId: order.id, timeoutMs: waitMs });

  if (delivery.state === 'delivered') {
    const row = delivery.order;
    let card = null;
    if (row.card_number) {
      try {
        card = openCard({ card_number: row.card_number, card_cvv: row.card_cvv, card_expiry: row.card_expiry, card_brand: row.card_brand });
      } catch { card = { number: row.card_number, cvv: row.card_cvv, expiry: row.card_expiry }; }
    }
    bizEvent('mcp.purchase_vcc.delivered', { api_key_id: apiKey.id, order_id: order.id });
    return json({ order_id: order.id, phase: 'ready', amount_usdc: amountRaw, tx_hash: txHash, card });
  }

  if (delivery.state === 'failed') {
    return toolError(`Order ${order.id} failed during fulfillment (tx: ${txHash}). A refund will be issued.`);
  }

  // Timed out — hand the order_id back so the model can poll with check_order.
  return json({
    order_id: order.id,
    phase: 'processing',
    amount_usdc: amountRaw,
    tx_hash: txHash,
    message: `Payment confirmed (tx: ${txHash}) but card is still being processed. Use check_order to retrieve it.`,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a JSON-serialisable value as a pretty-printed MCP text block. */
function json(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

/** Return an MCP tool error (shown to the model as a failed tool call). */
function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Map internal order statuses to the AGENTS.md phase vocabulary.
 * @param {string} status
 */
function mapStatusToPhase(status) {
  switch (status) {
    case 'awaiting_approval': return 'awaiting_approval';
    case 'pending_payment':   return 'awaiting_payment';
    case 'ordering':
    case 'refund_pending':    return 'processing';
    case 'delivered':         return 'ready';
    case 'failed':            return 'failed';
    case 'refunded':          return 'refunded';
    case 'rejected':          return 'rejected';
    case 'expired':           return 'expired';
    default:                  return status;
  }
}

module.exports = {
  handleCheckBudget,
  handleCheckOrder,
  handleWalletBalance,
  handlePurchaseVcc,
  // exported for tests
  mapStatusToPhase,
  _json: json,
  _toolError: toolError,
};
