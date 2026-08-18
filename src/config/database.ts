/**
 * 数据库连接 URL 解析
 *
 * 集群统一约定：通过 DATABASE_PROVIDER 显式选择数据库连接模式，
 * 不做自动嗅探——显式配置是 source of truth，自动嗅探会掩盖部署配置错误。
 *
 * - postgres（默认）：从标准环境变量 DATABASE_URL 读取
 * - coze：从 Coze 平台注入的 PostgreSQL 环境变量组构建连接字符串
 *   （PGDATABASE_URL / PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE）
 *
 * 示例：
 * ```
 * # 通用 PostgreSQL
 * DATABASE_PROVIDER=postgres
 * DATABASE_URL=postgresql://user:pass@host:5432/db
 *
 * # Coze 平台数据库集成
 * DATABASE_PROVIDER=coze
 * PGDATABASE_URL=postgresql://postgres:...@...
 * ```
 */

/** 数据库连接模式 */
export type DatabaseProviderKind = "postgres" | "coze";

const SUPPORTED_PROVIDERS: DatabaseProviderKind[] = ["postgres", "coze"];

/** resolveDatabaseUrl 参数 */
export interface ResolveDatabaseUrlOptions {
  /** 显式指定 provider；默认读取 env.DATABASE_PROVIDER，未设置则回退 postgres（不自动嗅探） */
  provider?: DatabaseProviderKind;
  /** 环境变量来源（默认 process.env，可注入用于测试） */
  env?: Record<string, string | undefined>;
}

/**
 * 解析数据库连接 URL
 *
 * @throws Error DATABASE_URL 缺失（postgres 模式）、必需变量缺失（coze 模式）
 *              或 provider 不受支持时抛出，message 附带诊断快照
 */
export function resolveDatabaseUrl(options?: ResolveDatabaseUrlOptions): string {
  const env = options?.env ?? process.env;
  // 显式读取 DATABASE_PROVIDER，未设置则严格回退到 postgres（不自动嗅探）
  const provider =
    options?.provider ??
    ((env.DATABASE_PROVIDER || "postgres") as DatabaseProviderKind);

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(
      `[database/provider] Unknown provider: "${provider}". ` +
        `Supported: ${SUPPORTED_PROVIDERS.join(", ")}`
    );
  }

  if (provider === "postgres") {
    const url = env.DATABASE_URL;
    if (!url) {
      // 抛错时把诊断信息一并打出，便于部署排障
      // 注意：这里不"自动"选择 provider，只做"提示"，由用户/部署配置决定
      const providerValue = env.DATABASE_PROVIDER || "(unset)";
      const pgHost = env.PGHOST ? "***set***" : "(unset)";
      const pgDbUrl = env.PGDATABASE_URL ? "***set***" : "(unset)";
      const dbUrl = env.DATABASE_URL ? "***set***" : "(unset)";
      throw new Error(
        "[database/provider] DATABASE_URL is not set. " +
          "Diagnostic snapshot: " +
          `{ DATABASE_PROVIDER=${providerValue}, DATABASE_URL=${dbUrl}, ` +
          `PGHOST=${pgHost}, PGDATABASE_URL=${pgDbUrl} }. ` +
          "If you set DATABASE_PROVIDER=coze in deployment config " +
          "but still hit this error, the DB env export step likely failed " +
          "silently before build. Re-run it and verify the build working " +
          "directory env contains `DATABASE_PROVIDER=coze` before `next build`."
      );
    }
    return url;
  }

  // coze 模式：优先使用完整的连接字符串
  if (env.PGDATABASE_URL) {
    // 移除 pg 库不支持的 sslmode/channel_binding 等参数，SSL 通过 ssl 选项传递
    return env.PGDATABASE_URL.replace(/\?.*$/, "");
  }

  // 否则从各组件变量拼接
  const host = env.PGHOST;
  const port = env.PGPORT || "5432";
  const user = env.PGUSER;
  const password = env.PGPASSWORD;
  const database = env.PGDATABASE || "postgres";

  if (!host || !user || !password) {
    throw new Error(
      "[database/provider] Coze integration: missing required env vars (PGHOST, PGUSER, PGPASSWORD). " +
        "Ensure DATABASE_PROVIDER=coze is set and the DB env export step " +
        "completed before build."
    );
  }

  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}`;
}
