// Unit tests for payments/wallet-signer — the bridge between the
// wallet-vault (sealed custody) and the SDK's payViaContract.
//
// The SDK module is mocked via require.cache so no Soroban/Horizon
// network calls happen. What's pinned here:
//   - the decrypted secret reaches payViaContract and the resulting tx
//     hash is returned
//   - testnet passphrase selection (STELLAR_NETWORK=testnet in tests)
//   - an error that happens to contain the secret is redacted before
//     propagating (belt-and-braces logging safety)
//   - agents without a server wallet fail with wallet_not_found before
//     any payment code runs

require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { Networks, StrKey } = require('@stellar/stellar-sdk');

// ── Mock the SDK before wallet-signer loads it ───────────────────────────────
const sdkMock = {
  payViaContract: async () => 'mock_tx_hash',
};
const sdkPath = require.resolve('@cora-agent/cora');
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: { payViaContract: (...args) => sdkMock.payViaContract(...args) },
  children: [],
  paths: [],
};

const db = require('../../src/db');
const { createServerWallet, WalletVaultError } = require('../../src/lib/wallet-vault');
const { payOrderFromServerWallet } = require('../../src/payments/wallet-signer');

const GOOD_KEY = 'f'.repeat(64);

const PAYMENT = {
  contract_id: 'C' + 'A'.repeat(55),
  order_id: 'order-123',
  usdc: { amount: '25.00' },
  xlm: { amount: '100.00' },
};

function seedAgentWithWallet() {
  const id = uuidv4();
  db.prepare(`INSERT INTO api_keys (id, key_hash, label) VALUES (?, ?, 'signer-agent')`).run(
    id,
    `hash-${id}`,
  );
  const wallet = createServerWallet(id);
  return { apiKeyId: id, wallet };
}

describe('wallet-signer', () => {
  let origBoxKey;

  beforeEach(() => {
    origBoxKey = process.env.CORA_SECRET_BOX_KEY;
    process.env.CORA_SECRET_BOX_KEY = GOOD_KEY;
    db.prepare(`DELETE FROM agent_wallets`).run();
    db.prepare(`DELETE FROM api_keys`).run();
    sdkMock.payViaContract = async () => 'mock_tx_hash';
  });

  afterEach(() => {
    if (origBoxKey === undefined) delete process.env.CORA_SECRET_BOX_KEY;
    else process.env.CORA_SECRET_BOX_KEY = origBoxKey;
  });

  it('decrypts the wallet and pays via the SDK, returning the tx hash', async () => {
    const { apiKeyId, wallet } = seedAgentWithWallet();
    let seen = null;
    sdkMock.payViaContract = async (opts) => {
      seen = opts;
      return 'tx_abc';
    };

    const hash = await payOrderFromServerWallet(apiKeyId, PAYMENT, 'usdc');
    assert.equal(hash, 'tx_abc');
    assert.ok(seen, 'payViaContract called');
    assert.ok(StrKey.isValidEd25519SecretSeed(seen.walletSecret), 'real decrypted S-key passed');
    assert.equal(seen.payment, PAYMENT);
    assert.equal(seen.paymentAsset, 'usdc');
    assert.equal(seen.networkPassphrase, Networks.TESTNET, 'testnet passphrase in test env');
    // The secret passed must belong to this wallet.
    const { Keypair } = require('@stellar/stellar-sdk');
    assert.equal(Keypair.fromSecret(seen.walletSecret).publicKey(), wallet.publicKey);
  });

  it('defaults paymentAsset to usdc', async () => {
    const { apiKeyId } = seedAgentWithWallet();
    let seen = null;
    sdkMock.payViaContract = async (opts) => {
      seen = opts;
      return 'tx_x';
    };
    await payOrderFromServerWallet(apiKeyId, PAYMENT);
    assert.equal(seen.paymentAsset, 'usdc');
  });

  it('redacts the wallet secret from propagated error messages', async () => {
    const { apiKeyId } = seedAgentWithWallet();
    sdkMock.payViaContract = async (opts) => {
      throw new Error(`simulation blew up with key ${opts.walletSecret} in the message`);
    };

    await assert.rejects(
      () => payOrderFromServerWallet(apiKeyId, PAYMENT, 'xlm'),
      (err) => {
        assert.ok(err.message.includes('[redacted-wallet-secret]'), 'secret replaced');
        assert.ok(!/\bS[A-Z2-7]{55}\b/.test(err.message), 'no S-key survives in the message');
        return true;
      },
    );
  });

  it('fails with wallet_not_found before touching payment code when no wallet exists', async () => {
    const id = uuidv4();
    db.prepare(`INSERT INTO api_keys (id, key_hash, label) VALUES (?, ?, 'no-wallet')`).run(
      id,
      `hash-${id}`,
    );
    let called = false;
    sdkMock.payViaContract = async () => {
      called = true;
      return 'nope';
    };
    await assert.rejects(
      () => payOrderFromServerWallet(id, PAYMENT),
      (err) => err instanceof WalletVaultError && err.code === 'wallet_not_found',
    );
    assert.equal(called, false, 'payment path never invoked');
  });
});
