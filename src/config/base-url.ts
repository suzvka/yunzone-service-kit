/**
 * 服务 baseUrl 解析
 *
 * 集群统一约定：服务对外 baseUrl 的解析链（TICKET-001 中立键）
 *
 *   PUBLIC_BASE_URL → BETTER_AUTH_URL →（DEV 环境回退）→ PROJECT_DOMAIN_DEFAULT → fallback
 *
 * - PUBLIC_BASE_URL：服务对外 baseUrl 中立显式项，优先级最高（新增，规范推荐）
 * - BETTER_AUTH_URL：历史遗留兼容键（better-auth 库名遗留，omni-auth 外部 npm 包契约；
 *   不迁移、不降级，但新代码应使用 PUBLIC_BASE_URL）
 * - DEPLOY_ENV=DEV：开发环境回退到 fallback（平台域名为空/无效）
 * - PROJECT_DOMAIN_DEFAULT：项目默认域名（平台注入旧名 COZE_PROJECT_DOMAIN_DEFAULT
 *   经适配层 normalizeDeployEnv 回退映射）
 */

import { normalizeDeployEnv } from "./deploy";

/** resolveBaseUrl 参数 */
export interface ResolveBaseUrlOptions {
  /**
   * 是否启用 DEV 回退逻辑（DEPLOY_ENV=DEV 时直接取 fallback），默认 true。
   * 关闭后 DEV 环境仍会尝试读取 PROJECT_DOMAIN_DEFAULT。
   */
  devFallback?: boolean;
  /** 最终回退值，默认 "http://localhost:5000" */
  fallback?: string;
  /** 环境变量来源（默认 process.env，可注入用于测试） */
  env?: Record<string, string | undefined>;
}

/**
 * 解析服务 baseUrl
 */
export function resolveBaseUrl(options?: ResolveBaseUrlOptions): string {
  const env = normalizeDeployEnv(options?.env ?? process.env);
  const fallback = options?.fallback ?? "http://localhost:5000";
  const devFallback = options?.devFallback ?? true;

  if (env.PUBLIC_BASE_URL) {
    return env.PUBLIC_BASE_URL;
  }

  if (env.BETTER_AUTH_URL) {
    return env.BETTER_AUTH_URL;
  }

  if (devFallback && env.DEPLOY_ENV === "DEV") {
    return fallback;
  }

  return env.PROJECT_DOMAIN_DEFAULT || fallback;
}

/** resolveListenAddress 参数 */
export interface ResolveListenAddressOptions {
  /** 环境变量来源（默认 process.env，可注入用于测试） */
  env?: Record<string, string | undefined>;
}

/**
 * 解析服务监听地址（host + port）
 *
 * 集群统一约定：
 * - host：`HOSTNAME`，默认 `0.0.0.0`
 * - port：`PORT`（业界标准；平台注入旧名 DEPLOY_RUN_PORT 经适配层回退映射），默认 `5000`
 */
export function resolveListenAddress(
  options?: ResolveListenAddressOptions
): { host: string; port: number } {
  const env = normalizeDeployEnv(options?.env ?? process.env);
  const host = env.HOSTNAME || "0.0.0.0";
  const port = parseInt(env.PORT || "5000", 10);
  return { host, port };
}
