// @ts-check
// Server-side payment signing for server-held agent wallets.
//
// Thin bridge between lib/wallet-vault (sealed key custody) and the SDK's
// battle-tested Soroban payment path (@cora-agent/cora payViaContract —
// fee retry, send-and-retry with preserved sequence, Horizon fallback,
// double-pay protection). The backend deliberately does NOT reimplement
// any of that logic; it only supplies the decrypted secret for the
// duration of one call and drops the reference immediately after.
//
// Security contract:
//   - the secret never leaves this function's scope
//   - the secret is never logged, never attached to an error
//   - callers get back only the Soroban tx hash

const { Networks } = require('@stellar/stellar-sdk');
const { openWalletSecret } = require('../lib/wallet-vault');

function networkPassphrase() {
  return process.env.STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
}

/**
 * Pay a Cora order's receiver contract from an agent's server-held wallet.
 * Invokes the contract's pay_usdc / pay_xlm via the SDK and returns the
 * Soroban transaction hash.
 *
 * @param {string} apiKeyId  agent whose server-held wallet signs the payment
 * @param {{ contract_id: string, order_id: string,
 *           usdc: { amount: string }, xlm?: { amount: string } }} payment
 *        payment instructions from POST /v1/orders
 * @param {'usdc'|'xlm'} [paymentAsset]
 * @returns {Promise<string>} Soroban tx hash
 */
async function payOrderFromServerWallet(apiKeyId, payment, paymentAsset = 'usdc') {
  // Lazy-require so unit tests can patchCache('@cora-agent/cora') and so
  // backend boot does not pay the SDK's module-load cost on startup.
  const { payViaContract } = require('@cora-agent/cora');
  const walletSecret = openWalletSecret(apiKeyId);
  try {
    return await payViaContract({
      walletSecret,
      payment,
      paymentAsset,
      networkPassphrase: networkPassphrase(),
      sorobanRpcUrl: process.env.SOROBAN_RPC_URL || undefined,
    });
  } catch (err) {
    // Belt-and-braces: never let the secret ride along on an error that
    // may get logged or serialised upstream. The SDK does not attach it,
    // but strip any accidental appearance anyway.
    if (err instanceof Error && err.message.includes(walletSecret)) {
      err.message = err.message.split(walletSecret).join('[redacted-wallet-secret]');
    }
    throw err;
  }
}

module.exports = { payOrderFromServerWallet };
