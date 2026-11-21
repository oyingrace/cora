// Unit tests for lib/wallet-vault — server-held agent wallet custody.
//
// The vault's defining property (vs lib/card-vault) is that it REFUSES
// to run without CORA_SECRET_BOX_KEY in every environment: wallet
// secrets are spending keys, so the dev/test plaintext fallback that
// secret-box allows for other fields must never apply here.

require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { Keypair, StrKey } = require('@stellar/stellar-sdk');

const db = require('../../src/db');
const {
  WalletVaultError,
  vaultReady,
  createServerWallet,
  getServerWallet,
  openWalletSecret,
} = require('../../src/lib/wallet-vault');

const GOOD_KEY = 'c'.repeat(64);

function seedApiKey({ walletPublicKey = null } = {}) {
  const id = uuidv4();
  db.prepare(
    `INSERT INTO api_keys (id, key_hash, label, wallet_public_key)
     VALUES (?, ?, 'wallet-test-agent', ?)`,
  ).run(id, `hash-${id}`, walletPublicKey);
  return id;
}

describe('wallet-vault', () => {
  let origKey;

  beforeEach(() => {
    origKey = process.env.CORA_SECRET_BOX_KEY;
    process.env.CORA_SECRET_BOX_KEY = GOOD_KEY;
    db.prepare(`DELETE FROM agent_wallets`).run();
    db.prepare(`DELETE FROM api_keys`).run();
  });

  afterEach(() => {
    if (origKey === undefined) delete process.env.CORA_SECRET_BOX_KEY;
    else process.env.CORA_SECRET_BOX_KEY = origKey;
  });

  it('creates a wallet: sealed secret at rest, public key mirrored onto api_keys', () => {
    const apiKeyId = seedApiKey();
    const wallet = createServerWallet(apiKeyId);

    assert.ok(StrKey.isValidEd25519PublicKey(wallet.publicKey), 'returns a valid G-address');
    assert.equal(wallet.network, 'testnet');

    const row = db.prepare(`SELECT * FROM agent_wallets WHERE api_key_id = ?`).get(apiKeyId);
    assert.ok(row, 'row persisted');
    assert.equal(row.public_key, wallet.publicKey);
    assert.ok(row.secret_sealed.startsWith('enc:'), 'secret is sealed, never plaintext');

    const mirrored = db
      .prepare(`SELECT wallet_public_key FROM api_keys WHERE id = ?`)
      .get(apiKeyId);
    assert.equal(mirrored.wallet_public_key, wallet.publicKey, 'mirror on api_keys');
  });

  it('round-trips: openWalletSecret returns the secret that derives the stored public key', () => {
    const apiKeyId = seedApiKey();
    const wallet = createServerWallet(apiKeyId);
    const secret = openWalletSecret(apiKeyId);
    assert.ok(StrKey.isValidEd25519SecretSeed(secret));
    assert.equal(Keypair.fromSecret(secret).publicKey(), wallet.publicKey);
  });

  it('refuses to create without CORA_SECRET_BOX_KEY — no dev/test plaintext fallback', () => {
    delete process.env.CORA_SECRET_BOX_KEY;
    assert.equal(vaultReady(), false);
    const apiKeyId = seedApiKey();
    assert.throws(
      () => createServerWallet(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'vault_key_missing',
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM agent_wallets`).get().n,
      0,
      'nothing persisted',
    );
  });

  it('refuses to open without CORA_SECRET_BOX_KEY', () => {
    const apiKeyId = seedApiKey();
    createServerWallet(apiKeyId);
    delete process.env.CORA_SECRET_BOX_KEY;
    assert.throws(
      () => openWalletSecret(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'vault_key_missing',
    );
  });

  it('rejects a second wallet for the same agent (wallet_exists)', () => {
    const apiKeyId = seedApiKey();
    createServerWallet(apiKeyId);
    assert.throws(
      () => createServerWallet(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'wallet_exists',
    );
  });

  it('rejects creation when the agent already has an external wallet address', () => {
    const external = Keypair.random().publicKey();
    const apiKeyId = seedApiKey({ walletPublicKey: external });
    assert.throws(
      () => createServerWallet(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'external_wallet_exists',
    );
  });

  it('rejects creation for a missing api_key (api_key_not_found)', () => {
    assert.throws(
      () => createServerWallet('no-such-key'),
      (err) => err instanceof WalletVaultError && err.code === 'api_key_not_found',
    );
  });

  it('openWalletSecret throws wallet_not_found when no wallet exists', () => {
    const apiKeyId = seedApiKey();
    assert.throws(
      () => openWalletSecret(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'wallet_not_found',
    );
  });

  it('treats a plaintext secret row as corruption, not legacy pass-through', () => {
    const apiKeyId = seedApiKey();
    const kp = Keypair.random();
    db.prepare(
      `INSERT INTO agent_wallets (id, api_key_id, public_key, secret_sealed, network)
       VALUES (?, ?, ?, ?, 'testnet')`,
    ).run(uuidv4(), apiKeyId, kp.publicKey(), kp.secret() /* plaintext! */);
    assert.throws(
      () => openWalletSecret(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'wallet_corrupt',
    );
  });

  it('detects a public-key mismatch after decryption (row tamper tripwire)', () => {
    const apiKeyId = seedApiKey();
    createServerWallet(apiKeyId);
    // Swap the stored public key for a different one — decrypted secret
    // no longer derives it.
    db.prepare(`UPDATE agent_wallets SET public_key = ? WHERE api_key_id = ?`).run(
      Keypair.random().publicKey(),
      apiKeyId,
    );
    assert.throws(
      () => openWalletSecret(apiKeyId),
      (err) => err instanceof WalletVaultError && err.code === 'wallet_corrupt',
    );
  });

  it('fails to open after a key rotation (GCM auth failure surfaces, not silent garbage)', () => {
    const apiKeyId = seedApiKey();
    createServerWallet(apiKeyId);
    process.env.CORA_SECRET_BOX_KEY = 'd'.repeat(64);
    assert.throws(() => openWalletSecret(apiKeyId));
  });

  it('getServerWallet returns public info only — no secret material', () => {
    const apiKeyId = seedApiKey();
    const created = createServerWallet(apiKeyId);
    const info = getServerWallet(apiKeyId);
    assert.equal(info.public_key, created.publicKey);
    assert.equal(info.network, 'testnet');
    assert.ok(info.created_at);
    assert.equal('secret_sealed' in info, false, 'sealed secret must not be exposed');
  });

  it('getServerWallet returns null for agents without a server wallet', () => {
    const apiKeyId = seedApiKey();
    assert.equal(getServerWallet(apiKeyId), null);
  });
});
