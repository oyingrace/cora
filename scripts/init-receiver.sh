#!/usr/bin/env bash
# Initialise the Cora receiver contract using values from backend/.env.
#
# Usage (from repo root):
#   ./scripts/init-receiver.sh
#
# Requires: stellar CLI, node (for deriving the G... address), and a filled
# backend/.env with STELLAR_XLM_SECRET, RECEIVER_CONTRACT_ID, STELLAR_NETWORK.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/backend/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

: "${STELLAR_XLM_SECRET:?STELLAR_XLM_SECRET not set in $ENV_FILE}"
: "${RECEIVER_CONTRACT_ID:?RECEIVER_CONTRACT_ID not set in $ENV_FILE}"

NETWORK="${STELLAR_NETWORK:-mainnet}"
if [[ "$NETWORK" != "mainnet" && "$NETWORK" != "testnet" ]]; then
  echo "error: STELLAR_NETWORK must be mainnet or testnet (got: $NETWORK)" >&2
  exit 1
fi

# Warn if RPC URL disagrees with STELLAR_NETWORK (common local-dev footgun).
if [[ -n "${SOROBAN_RPC_URL:-}" ]]; then
  if [[ "$NETWORK" == "mainnet" && "$SOROBAN_RPC_URL" == *testnet* ]]; then
    echo "warning: STELLAR_NETWORK=mainnet but SOROBAN_RPC_URL looks like testnet ($SOROBAN_RPC_URL)" >&2
  elif [[ "$NETWORK" == "testnet" && "$SOROBAN_RPC_URL" == *mainnet* ]]; then
    echo "warning: STELLAR_NETWORK=testnet but SOROBAN_RPC_URL looks like mainnet ($SOROBAN_RPC_URL)" >&2
  fi
fi

# Derive G... from the treasury secret (admin == treasury for the default setup).
TREASURY="$(
  node -e "const {Keypair}=require('@stellar/stellar-sdk'); process.stdout.write(Keypair.fromSecret(process.env.STELLAR_XLM_SECRET).publicKey())"
)"
ADMIN="${ADMIN_PUBLIC_KEY:-$TREASURY}"

# Well-known SAC IDs (same as contract/README.md + Circle docs).
if [[ "$NETWORK" == "mainnet" ]]; then
  USDC_SAC="CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75"
  XLM_SAC="CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"
else
  USDC_SAC="CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"
  XLM_SAC="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
fi

echo "network:   $NETWORK"
echo "contract:  $RECEIVER_CONTRACT_ID"
echo "admin:     $ADMIN"
echo "treasury:  $TREASURY"
echo "usdc_sac:  $USDC_SAC"
echo "xlm_sac:   $XLM_SAC"
echo

stellar contract invoke \
  --id "$RECEIVER_CONTRACT_ID" \
  --source "$STELLAR_XLM_SECRET" \
  --network "$NETWORK" \
  -- \
  init \
  --admin "$ADMIN" \
  --treasury "$TREASURY" \
  --usdc_contract "$USDC_SAC" \
  --xlm_contract "$XLM_SAC"

echo
echo "done — receiver initialized on $NETWORK"
