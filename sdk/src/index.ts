export { CoraClient } from './client';
export type {
  OrderOptions,
  OrderResponse,
  OrderStatus,
  OrderListItem,
  OrderPhase,
  CardDetails,
  PaymentInstructions,
  Budget,
  UsageSummary,
} from './client';

export {
  createWallet,
  getBalance,
  addUsdcTrustline,
  payViaContract,
  purchaseCard,
  // Back-compat alias for payViaContract.
  payVCC,
} from './stellar';
export type { WalletInfo, PayOpts } from './stellar';

export {
  createOWSWallet,
  importStellarKey,
  getOWSPublicKey,
  getOWSBalance,
  addUsdcTrustlineOWS,
  checkSorobanTxLanded,
  payViaContractOWS,
  purchaseCardOWS,
  onboardAgent,
  // Back-compat alias.
  payVCCOWS,
} from './ows';
export type {
  TrustlineOpts,
  PayViaContractOwsOpts,
  PayVCCOwsOpts,
  PurchaseCardOwsOpts,
  OnboardAgentOpts,
  OnboardAgentResult,
} from './ows';

export {
  CoraError,
  SpendLimitError,
  RateLimitError,
  ServiceUnavailableError,
  PriceUnavailableError,
  InvalidAmountError,
  AuthError,
  OrderFailedError,
  WaitTimeoutError,
  ResumableError,
} from './errors';

export { InsufficientFeeError } from './soroban';

export { mppCharge } from './mpp';
export type { MppChargeOpts, MppChargeResult } from './mpp';

export { loadCoraConfig, saveCoraConfig, resolveCredentials } from './config';
export type { CoraConfig } from './config';
