#!/usr/bin/env node
/**
 * Mock VCC fulfillment service for local / testnet Cora.
 *
 * Implements the cora ↔ vcc HTTP contract from ARCHITECTURE.md so you
 * can run end-to-end purchases without the private vcc.ctx.com service.
 *
 * Flow:
 *   1. cora POST /api/register          → token
 *   2. cora POST /api/jobs/invoice      → job_id + web+stellar:pay URI
 *   3. cora pays that URI from treasury (destination defaults to treasury
 *      itself so XLM stays in the same account — only fees are spent)
 *   4. cora POST /api/jobs/:id/paid
 *   5. mock HMAC-callbacks cora /vcc-callback with a fake Visa card
 *
 * Usage:
 *   # from repo root — loads STELLAR_XLM_SECRET from backend/.env for destination
 *   node scripts/mock-vcc.mjs
 *
 *   # or explicit destination / ports
 *   MOCK_VCC_DESTINATION=G... MOCK_VCC_PORT=4100 node scripts/mock-vcc.mjs
 *
 * Then in backend/.env:
 *   VCC_API_BASE=http://127.0.0.1:4100
 *   CORA_BASE_URL=http://localhost:4000
 *
 * Restart the backend after changing VCC_API_BASE (captured at module load).
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BACKEND_ENV = path.join(ROOT, 'backend', '.env');

// ── Load backend/.env (optional) so destination can be derived ───────────────
function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(BACKEND_ENV);

const PORT = Number(process.env.MOCK_VCC_PORT || 4100);
const CALLBACK_DELAY_MS = Number(process.env.MOCK_VCC_CALLBACK_DELAY_MS || 400);
/** Invoice XLM the treasury will "pay CTX". Keep small on testnet. */
const INVOICE_XLM = process.env.MOCK_VCC_INVOICE_XLM || '0.5';

function resolveDestination() {
  if (process.env.MOCK_VCC_DESTINATION) return process.env.MOCK_VCC_DESTINATION;
  const secret = process.env.STELLAR_XLM_SECRET;
  if (!secret || !secret.startsWith('S')) {
    throw new Error(
      'Set MOCK_VCC_DESTINATION=G... or STELLAR_XLM_SECRET in backend/.env ' +
        '(mock pays the treasury itself so funds stay put).',
    );
  }
  const require = createRequire(import.meta.url);
  // Prefer backend's installed stellar-sdk; fall back to sdk workspace.
  let Keypair;
  try {
    ({ Keypair } = require(path.join(ROOT, 'backend/node_modules/@stellar/stellar-sdk')));
  } catch {
    ({ Keypair } = require(path.join(ROOT, 'node_modules/@stellar/stellar-sdk')));
  }
  return Keypair.fromSecret(secret).publicKey();
}

const DESTINATION = resolveDestination();

/** @type {Map<string, object>} */
const tokens = new Map(); // token → { label, createdAt }
/** @type {Map<string, object>} */
const jobs = new Map(); // job_id → job

function json(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({ raw: '', parsed: null });
      try {
        resolve({ raw, parsed: JSON.parse(raw) });
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/** Dev mock: accept any non-empty bearer; remember unknowns after restart. */
function requireToken(req) {
  const token = req.headers['x-vcc-token'];
  if (!token || typeof token !== 'string') return null;
  if (!tokens.has(token)) {
    tokens.set(token, { label: 'adopted', createdAt: new Date().toISOString() });
  }
  return token;
}

function memoForOrder(orderId) {
  // Stellar MEMO_TEXT max 28 bytes. Short, unique-ish, no dots for safety.
  const compact = String(orderId).replace(/-/g, '').slice(0, 20);
  return `m${compact}`.slice(0, 28);
}

function buildPaymentUrl(orderId) {
  const params = new URLSearchParams({
    destination: DESTINATION,
    amount: INVOICE_XLM,
    memo: memoForOrder(orderId),
  });
  return `web+stellar:pay?${params.toString()}`;
}

function signCallback({ secret, timestamp, orderId, nonce, rawBody }) {
  const payload = `${timestamp}.${orderId}.${nonce}.${rawBody}`;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Luhn check digit for a numeric string (no check digit yet). */
function luhnCheckDigit(partial) {
  let sum = 0;
  let alt = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let n = Number(partial[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return String((10 - (sum % 10)) % 10);
}

/**
 * Generate a Luhn-valid Visa test PAN that looks realistic (not 4111…).
 * Uses common Visa test BINs + random account digits.
 */
function generateVisaPan() {
  const bins = ['424242', '400005', '400000', '453201', '455673', '402400'];
  let body = bins[crypto.randomInt(bins.length)];
  while (body.length < 15) body += String(crypto.randomInt(10));
  return body + luhnCheckDigit(body);
}

function fakeCard(_amountUsdc) {
  const now = new Date();
  const expYear = (now.getFullYear() + 2 + crypto.randomInt(3)) % 100;
  const expMonth = String(1 + crypto.randomInt(12)).padStart(2, '0');
  return {
    number: generateVisaPan(),
    cvv: String(100 + crypto.randomInt(900)),
    expiry: `${expMonth}/${String(expYear).padStart(2, '0')}`,
    brand: 'Visa',
  };
}

async function deliverCard(job) {
  const payload = {
    order_id: job.order_id,
    status: 'fulfilled',
    card: fakeCard(job.amount_usdc),
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signCallback({
    secret: job.callback_secret,
    timestamp,
    orderId: job.order_id,
    nonce: job.callback_nonce,
    rawBody: body,
  });

  const headers = {
    'Content-Type': 'application/json',
    'X-VCC-Signature': `sha256=${signature}`,
    'X-VCC-Timestamp': timestamp,
    'X-VCC-Order-Id': job.order_id,
    'X-VCC-Nonce': job.callback_nonce,
  };

  console.log(`[mock-vcc] callback → ${job.callback_url} order=${job.order_id}`);
  try {
    const res = await fetch(job.callback_url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.error(`[mock-vcc] callback failed HTTP ${res.status}: ${text.slice(0, 200)}`);
      job.status = 'callback_failed';
      job.error = `callback HTTP ${res.status}`;
      return;
    }
    job.status = 'delivered';
    console.log(`[mock-vcc] delivered fake card for ${job.order_id}`);
  } catch (err) {
    job.status = 'callback_failed';
    job.error = err instanceof Error ? err.message : String(err);
    console.error(`[mock-vcc] callback error: ${job.error}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, destination: DESTINATION, jobs: jobs.size });
    }

    if (method === 'POST' && url.pathname === '/api/register') {
      const { parsed } = await readBody(req);
      const label = parsed?.label || 'cora-mock';
      const token = `mock_vcc_${crypto.randomBytes(16).toString('hex')}`;
      tokens.set(token, { label, createdAt: new Date().toISOString() });
      console.log(`[mock-vcc] registered tenant label=${label}`);
      return json(res, 200, { token });
    }

    if (method === 'POST' && url.pathname === '/api/jobs/invoice') {
      if (!requireToken(req)) return json(res, 401, { error: 'unauthorized' });

      const { parsed } = await readBody(req);
      const orderId = parsed?.order_id;
      const amountUsdc = parsed?.amount_usdc;
      const callbackUrl = parsed?.callback_url;
      const callbackSecret = parsed?.callback_secret;
      const callbackNonce = parsed?.callback_nonce;
      if (!orderId || !amountUsdc || !callbackUrl || !callbackSecret || !callbackNonce) {
        return json(res, 400, {
          error: 'missing_fields',
          message: 'order_id, amount_usdc, callback_url, callback_secret, callback_nonce required',
        });
      }

      for (const [jid, job] of jobs) {
        if (job.order_id === orderId) {
          return json(res, 200, {
            job_id: jid,
            ctx_order_id: job.ctx_order_id,
            payment_url: job.payment_url,
            note: 'already_exists',
          });
        }
      }

      const jobId = `mock_${crypto.randomBytes(8).toString('hex')}`;
      const paymentUrl = buildPaymentUrl(orderId);
      const job = {
        id: jobId,
        order_id: orderId,
        amount_usdc: String(amountUsdc),
        callback_url: callbackUrl,
        callback_secret: callbackSecret,
        callback_nonce: callbackNonce,
        ctx_order_id: `mock_ctx_${crypto.randomBytes(4).toString('hex')}`,
        payment_url: paymentUrl,
        status: 'invoice_issued',
      };
      jobs.set(jobId, job);
      console.log(
        `[mock-vcc] invoice order=${orderId} amount_usdc=${amountUsdc} xlm=${INVOICE_XLM} → ${DESTINATION.slice(0, 8)}…`,
      );
      return json(res, 201, {
        job_id: jobId,
        ctx_order_id: job.ctx_order_id,
        payment_url: paymentUrl,
      });
    }

    const paidMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/paid$/);
    if (method === 'POST' && paidMatch) {
      if (!requireToken(req)) return json(res, 401, { error: 'unauthorized' });
      const job = jobs.get(paidMatch[1]);
      if (!job) return json(res, 404, { error: 'not_found' });
      if (job.status === 'invoice_issued' || job.status === 'queued') {
        job.status = 'queued';
        setTimeout(() => {
          job.status = 'fulfilling';
          deliverCard(job).catch((err) => console.error('[mock-vcc] deliver error', err));
        }, CALLBACK_DELAY_MS);
      }
      console.log(`[mock-vcc] paid job=${job.id} order=${job.order_id}`);
      return json(res, 200, { ok: true });
    }

    const getMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      if (!requireToken(req)) return json(res, 401, { error: 'unauthorized' });
      const job = jobs.get(getMatch[1]);
      if (!job) return json(res, 404, { error: 'not_found' });
      return json(res, 200, {
        id: job.id,
        status: job.status,
        ctx_order_id: job.ctx_order_id,
        payment_url: job.payment_url,
        error: job.error || null,
      });
    }

    return json(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error('[mock-vcc] handler error', err);
    return json(res, 500, { error: 'internal_error' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-vcc] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-vcc] CTX pay destination (self): ${DESTINATION}`);
  console.log(`[mock-vcc] invoice XLM amount: ${INVOICE_XLM}`);
  console.log(`[mock-vcc] set backend VCC_API_BASE=http://127.0.0.1:${PORT} and restart backend`);
});
