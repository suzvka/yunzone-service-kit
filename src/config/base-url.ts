/**
 * 服务 baseUrl 解析
 *
 * 集群统一约定：服务对外 baseUrl 的解析链
 *
 *   BETTER_AUTH_URL →（DEV 环境回退）→ COZE_PROJECT_DOMAIN_DEFAULT → fallback
 *
 * - BETTER_AUTH_URL：显式指定的 baseUrl，优先级最高
 * - COZE_PROJECT_ENV=DEV：开发环境回退到 fallback（平台域名为空/无效）
 * - COZE_PROJECT_DOMAIN_DEFAULT：平台注入的默认域名
 */

/** resolveBaseUrl 参数 */
export interface ResolveBaseUrlOptions {
  /**
   * 是否启用 DEV 回退逻辑（COZE_PROJECT_ENV=DEV 时直接取 fallback），默认 true。
   * 关闭后 DEV 环境仍会尝试读取 COZE_PROJECT_DOMAIN_DEFAULT。
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
  const env = options?.env ?? process.env;
  const fallback = options?.fallback ?? "http://localhost:5000";
  const devFallback = options?.devFallback ?? true;

  if (env.BETTER_AUTH_URL) {
    return env.BETTER_AUTH_URL;
  }

  if (devFallback && env.COZE_PROJECT_ENV === "DEV") {
    return fallback;
  }

  return env.COZE_PROJECT_DOMAIN_DEFAULT || fallback;
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
 * - port：`DEPLOY_RUN_PORT`（Coze 平台注入）优先，其次 `PORT`，默认 `5000`
 */
export function resolveListenAddress(
  options?: ResolveListenAddressOptions
): { host: string; port: number } {
  const env = options?.env ?? process.env;
  const host = env.HOSTNAME || "0.0.0.0";
  const port = parseInt(env.DEPLOY_RUN_PORT || env.PORT || "5000", 10);
  return { host, port };
}
