/**
 * yunzone-service-kit/config — 运行时配置层
 */

export { EnvConfigError, defineEnv, loadEnv, envSnapshot } from "./env";
export type { LoadEnvOptions } from "./env";
export {
  EnvFileError,
  parseDotEnv,
  loadDotEnv,
  type ParseDotEnvOptions,
  type LoadDotEnvOptions,
} from "./dotenv";
export {
  resolveDatabaseUrl,
  type DatabaseProviderKind,
  type ResolveDatabaseUrlOptions,
} from "./database";
export {
  resolveStorageConfig,
  type StorageProviderKind,
  type ResolveStorageConfigOptions,
  type ResolvedStorageConfig,
} from "./storage";
export {
  resolveBaseUrl,
  resolveListenAddress,
  type ResolveBaseUrlOptions,
  type ResolveListenAddressOptions,
} from "./base-url";
export {
  deploymentAliases,
  normalizeDeployEnv,
  type DeployProviderKind,
  type NormalizeDeployEnvOptions,
} from "./deploy";
export {
  deploymentFacet,
  authCenterFacet,
  userCenterFacet,
  adminFacet,
  composeFacets,
  requiredFacet,
  facetKeys,
  type EnvFacet,
} from "./specs";
