/**
 * yunzone-service-kit/config — 运行时配置层
 */

export { EnvConfigError, defineEnv, loadEnv, envSnapshot } from "./env";
export type { LoadEnvOptions } from "./env";
export {
  resolveDatabaseUrl,
  type DatabaseProviderKind,
  type ResolveDatabaseUrlOptions,
} from "./database";
export {
  resolveBaseUrl,
  resolveListenAddress,
  type ResolveBaseUrlOptions,
  type ResolveListenAddressOptions,
} from "./base-url";
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
