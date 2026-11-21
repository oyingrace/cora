// @ts-check
// Server-held agent wallets — generation, sealed storage, and retrieval.
//
// Unlike lib/card-vault (which tolerates the dev/test plaintext fallback
// of lib/secret-box), wallet secrets are SPENDING KEYS: a plaintext row
// means anyone with a DB dump can drain the agent's funds. So this module
// refuses to operate without CORA_SECRET_BOX_KEY in EVERY environment —
// there is no dev fallback, and open() rejects any stored row that is not
// a sealed `enc:` blob (a plaintext secret that somehow landed in the
// table is treated as corruption, not as legacy data to pass through).
//
// Storage: agent_wallets (migration 30). One wallet per api_key, soft FK
// so the sealed secret outlives agent deletion (funds stay recoverable).

const { v4: uuidv4 } = require('uuid');
const { Keypair, StrKey } = require('@stellar/stellar-sdk');
/** @type {any} */
const db = require('../db');
const secretBox = require('./secret-box');

/**
 * Typed error so route handlers can map failure modes to HTTP statuses
 * without parsing message strings.
 */
class WalletVaultError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'WalletVaultError';
    this.code = code;
  }
}

/** True when the vault can seal/open (CORA_SECRET_BOX_KEY configured). */
function vaultReady() {
  return secretBox.hasKey();
}

function assertVaultKey() {
  if (!vaultReady()) {
    throw new WalletVaultError(
      'vault_key_missing',
      'wallet-vault: CORA_SECRET_BOX_KEY is required to hold server-side wallet keys. ' +
        'Generate one with `openssl rand -hex 32` and set it in the environment. ' +
        'There is no plaintext fallback for wallet secrets.',
    );
  }
}

/**
 * Create a server-held wallet for an agent. Generates a fresh Stellar
 * keypair, seals the secret, stores the row, and mirrors the public key
 * onto api_keys.wallet_public_key so the existing dashboard funding UI
 * and balance-polling job pick it up with zero changes.
 *
 * Refuses when:
 *   - CORA_SECRET_BOX_KEY is not configured   → vault_key_missing
 *   - the api_key does not exist              → api_key_not_found
 *   - the agent already has a server wallet   → wallet_exists
 *   - the agent already has an external wallet
 *     (CLI-held key set wallet_public_key)    → external_wallet_exists
 *
 * @param {string} apiKeyId
 * @returns {{ id: string, publicKey: string, network: string }}
 */
function createServerWallet(apiKeyId) {
  assertVaultKey();
  if (typeof apiKeyId !== 'string' || apiKeyId.length === 0) {
    throw new WalletVaultError(
      'api_key_not_found',
      'wallet-vault: apiKeyId must be a non-empty string',
    );
  }

  const key = /** @type {any} */ (
    db.prepare(`SELECT id, wallet_public_key FROM api_keys WHERE id = ?`).get(apiKeyId)
  );
  if (!key) {
    throw new WalletVaultError('api_key_not_found', `wallet-vault: no api_key with id ${apiKeyId}`);
  }
  const existing = db.prepare(`SELECT id FROM agent_wallets WHERE api_key_id = ?`).get(apiKeyId);
  if (existing) {
    throw new WalletVaultError(
      'wallet_exists',
      'wallet-vault: this agent already has a server-held wallet',
    );
  }
  if (key.wallet_public_key) {
    throw new WalletVaultError(
      'external_wallet_exists',
      'wallet-vault: this agent already has an external (agent-held) wallet address. ' +
        'Clear wallet_public_key first if you really want to switch custody.',
    );
  }

  const keypair = Keypair.random();
  const sealed = secretBox.seal(keypair.secret());
  // Defence in depth: hasKey() was checked above so seal() must have
  // produced a real blob — but if secret-box ever regresses to its
  // dev plaintext fallback, fail loudly rather than persist a raw
  // spending key.
  if (!sealed.startsWith('enc:')) {
    throw new WalletVaultError(
      'seal_failed',
      'wallet-vault: secret-box returned a non-sealed value — refusing to store a plaintext wallet secret',
    );
  }

  const id = uuidv4();
  const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  db.transaction(() => {
    db.prepare(
      `INSERT INTO agent_wallets (id, api_key_id, public_key, secret_sealed, network)
       VALUES (@id, @api_key_id, @public_key, @secret_sealed, @network)`,
    ).run({
      id,
      api_key_id: apiKeyId,
      public_key: keypair.publicKey(),
      secret_sealed: sealed,
      network,
    });
    db.prepare(`UPDATE api_keys SET wallet_public_key = ? WHERE id = ?`).run(
      keypair.publicKey(),
      apiKeyId,
    );
  })();

  return { id, publicKey: keypair.publicKey(), network };
}

/**
 * Public (non-secret) wallet info for an agent, or null if the agent has
 * no server-held wallet.
 * @param {string} apiKeyId
 * @returns {{ id: string, public_key: string, network: string, created_at: string } | null}
 */
function getServerWallet(apiKeyId) {
  const row = /** @type {any} */ (
    db
      .prepare(`SELECT id, public_key, network, created_at FROM agent_wallets WHERE api_key_id = ?`)
      .get(apiKeyId)
  );
  return row || null;
}

/**
 * Decrypt and return the wallet's Stellar secret key for signing.
 * Callers must treat the return value as radioactive: sign with it and
 * drop the reference — never log it, never put it in an error message,
 * never return it from an API route.
 *
 * Throws when:
 *   - the agent has no server wallet        → wallet_not_found
 *   - CORA_SECRET_BOX_KEY is missing        → vault_key_missing
 *   - the stored row is not a sealed blob   → wallet_corrupt
 *   - decryption yields a value that is not a valid S-key, or whose
 *     derived public key does not match the stored one → wallet_corrupt
 *
 * @param {string} apiKeyId
 * @returns {string} Stellar secret key (S...)
 */
function openWalletSecret(apiKeyId) {
  assertVaultKey();
  const row = /** @type {any} */ (
    db
      .prepare(`SELECT public_key, secret_sealed FROM agent_wallets WHERE api_key_id = ?`)
      .get(apiKeyId)
  );
  if (!row) {
    throw new WalletVaultError(
      'wallet_not_found',
      `wallet-vault: no server-held wallet for api_key ${apiKeyId}`,
    );
  }
  // No plaintext pass-through for spending keys: a row that isn't a
  // sealed blob is corruption (or a hostile write), not legacy data.
  if (typeof row.secret_sealed !== 'string' || !row.secret_sealed.startsWith('enc:')) {
    throw new WalletVaultError(
      'wallet_corrupt',
      `wallet-vault: stored secret for api_key ${apiKeyId} is not a sealed blob — refusing to use it`,
    );
  }
  const secret = secretBox.open(row.secret_sealed);
  if (!StrKey.isValidEd25519SecretSeed(secret)) {
    throw new WalletVaultError(
      'wallet_corrupt',
      `wallet-vault: decrypted secret for api_key ${apiKeyId} is not a valid Stellar secret key`,
    );
  }
  // Key-rotation / row-tamper tripwire: the decrypted secret must derive
  // the public key we recorded at creation time.
  if (Keypair.fromSecret(secret).publicKey() !== row.public_key) {
    throw new WalletVaultError(
      'wallet_corrupt',
      `wallet-vault: decrypted secret for api_key ${apiKeyId} does not match the stored public key`,
    );
  }
  return secret;
}

module.exports = {
  WalletVaultError,
  vaultReady,
  createServerWallet,
  getServerWallet,
  openWalletSecret,
};
