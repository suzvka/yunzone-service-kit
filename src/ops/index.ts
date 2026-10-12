/**
 * yunzone-service-kit/ops — 运维数据接口（纯逻辑层）
 */

export * from "./types";
export { createOpsReporter, type OpsReporter, type OpsReporterOptions } from "./report";
export { AdminKeybookError } from "./errors";
export {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS,
  ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS,
  ADMIN_KEYBOOK_VERSION,
  resolveAdminConfig,
  parseAdminKeybook,
  loadedFromDocument,
  loadAdminKeybook,
  computeKeybookFingerprint,
  canonicalKeybookSerialize,
  isAdminKeyRevoked,
  deriveAdminChallengeSecret,
  createAdminChallenge,
  verifyAdminChallenge,
  createAdminChallengeSeenStore,
  defaultAdminChallengeSeenStore,
  buildAdminLoginMessage,
  verifyKeybookSignature,
  deriveAdminSessionSecret,
  createSignedAdminSession,
  validateSignedAdminSession,
  type AdminConfig,
  type AdminKeybookKey,
  type LoadedAdminKeybook,
  type LoadAdminKeybookOptions,
  type AdminChallenge,
  type CreateAdminChallengeOptions,
  type VerifyAdminChallengeOptions,
  type AdminChallengeSeenStore,
  type BuildAdminLoginMessageParams,
  type SignedAdminSessionPayload,
  type ValidateSignedAdminSessionOptions,
} from "./admin";
export {
  initAdminRuntime,
  getAdminRuntimeCached,
  resetAdminRuntimeForTest,
  type AdminRuntime,
  type InitAdminRuntimeOptions,
} from "./runtime";
