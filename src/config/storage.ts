/**
 * 对象存储连接凭证解析
 *
 * 集群统一约定：通过 STORAGE_PROVIDER 显式选择存储渠道（与数据库渠道同构），
 * 不做自动嗅探——显式配置是 source of truth，自动嗅探会掩盖部署配置错误。
 *
 * - s3（默认）：从标准环境变量 S3_ENDPOINT_URL / S3_BUCKET_NAME 读取
 *   （可选 S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY；缺省走 SDK 默认凭证链）
 * - coze：从 Coze 平台注入的对象存储环境变量组读取
 *   （COZE_BUCKET_ENDPOINT_URL / COZE_BUCKET_NAME / COZE_BUCKET_ACCESS_KEY_ID /
 *   COZE_BUCKET_SECRET_ACCESS_KEY；凭证可选，缺省走 SDK 默认凭证链）
 * - none：显式无存储声明；本函数不接受该渠道（由 createObjectStore 前置拦截），
 *   直接传入时按非法 provider 抛 ObjectStoreConfigError
 *
 * 示例：
 * ```
 * # 通用 S3 兼容存储
 * STORAGE_PROVIDER=s3
 * S3_ENDPOINT_URL=https://s3.example.com
 * S3_BUCKET_NAME=my-bucket
 *
 * # Coze 平台对象存储集成（平台注入变量组）
 * STORAGE_PROVIDER=coze
 * COZE_BUCKET_ENDPOINT_URL=https://...
 * COZE_BUCKET_NAME=my-bucket
 * ```
 */

import { ObjectStoreConfigError } from "../storage/errors";

/** 存储渠道（凭证解析面；none 由工厂前置拦截） */
export type StorageProviderKind = "s3" | "coze";

const SUPPORTED_PROVIDERS: StorageProviderKind[] = ["s3", "coze"];

/** resolveStorageConfig 参数 */
export interface ResolveStorageConfigOptions {
  /** 显式指定 provider；默认读取 env.STORAGE_PROVIDER，未设置则回退 s3（不自动嗅探） */
  provider?: StorageProviderKind;
  /** 环境变量来源（默认 process.env，可注入用于测试） */
  env?: Record<string, string | undefined>;
}

/** 解析后的存储连接配置（传给 S3ObjectStore 等适配器） */
export interface ResolvedStorageConfig {
  /** S3 兼容端点 URL */
  endpointUrl: string;
  /** 桶名 */
  bucket: string;
  /** 访问凭证（缺省 undefined 时走 SDK 默认凭证链） */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/**
 * 解析存储连接配置
 *
 * @throws ObjectStoreConfigError 必需变量缺失、凭证不完整或 provider 不受支持时抛出，
 *               message 附带诊断快照（set/unset 状态，不回显值）
 */
export function resolveStorageConfig(
  options?: ResolveStorageConfigOptions
): ResolvedStorageConfig {
  const env = options?.env ?? process.env;
  // 显式读取 STORAGE_PROVIDER，未设置则严格回退到 s3（不自动嗅探）
  const provider =
    options?.provider ??
    ((env.STORAGE_PROVIDER || "s3") as StorageProviderKind);

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new ObjectStoreConfigError(
      `[storage/provider] Unknown provider: "${provider}". ` +
        `Supported: ${SUPPORTED_PROVIDERS.join(", ")}`
    );
  }

  if (provider === "s3") {
    const endpointUrl = env.S3_ENDPOINT_URL;
    const bucket = env.S3_BUCKET_NAME;
    if (!endpointUrl || !bucket) {
      const snapshot = {
        STORAGE_PROVIDER: env.STORAGE_PROVIDER || "(unset)",
        S3_ENDPOINT_URL: endpointUrl ? "***set***" : "(unset)",
        S3_BUCKET_NAME: bucket ? "***set***" : "(unset)",
        COZE_BUCKET_ENDPOINT_URL: env.COZE_BUCKET_ENDPOINT_URL
          ? "***set***"
          : "(unset)",
      };
      throw new ObjectStoreConfigError(
        "[storage/provider] S3_ENDPOINT_URL and S3_BUCKET_NAME are not set. " +
          "Diagnostic snapshot: " +
          `{ ${Object.entries(snapshot)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")} }. ` +
          "If you set STORAGE_PROVIDER=coze in deployment config " +
          "but still hit this error, the storage env export step likely " +
          "failed silently before build. Re-run it and verify the build " +
          "working directory env contains `STORAGE_PROVIDER=coze` before `next build`."
      );
    }
    return {
      endpointUrl,
      bucket,
      credentials: extractCredentials(env, "S3"),
    };
  }

  // coze 模式：按平台注入变量组读取
  const endpointUrl = env.COZE_BUCKET_ENDPOINT_URL;
  const bucket = env.COZE_BUCKET_NAME;
  if (!endpointUrl || !bucket) {
    const snapshot = {
      STORAGE_PROVIDER: env.STORAGE_PROVIDER || "(unset)",
      COZE_BUCKET_ENDPOINT_URL: endpointUrl ? "***set***" : "(unset)",
      COZE_BUCKET_NAME: bucket ? "***set***" : "(unset)",
      S3_ENDPOINT_URL: env.S3_ENDPOINT_URL ? "***set***" : "(unset)",
    };
    throw new ObjectStoreConfigError(
      "[storage/provider] Coze integration: missing required env vars " +
        "(COZE_BUCKET_ENDPOINT_URL, COZE_BUCKET_NAME). " +
        "Diagnostic snapshot: " +
        `{ ${Object.entries(snapshot)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")} }. ` +
        "Ensure STORAGE_PROVIDER=coze is set and the storage env export " +
        "step completed before build."
    );
  }
  return {
    endpointUrl,
    bucket,
    credentials: extractCredentials(env, "COZE_BUCKET"),
  };
}

/**
 * 提取访问凭证（可选）：两者均未设置 → undefined（走默认凭证链）；
 * 只设置其一 → 抛错 fail-fast（配置不完整，禁止隐式降级）。
 */
function extractCredentials(
  env: Record<string, string | undefined>,
  prefix: string
): { accessKeyId: string; secretAccessKey: string } | undefined {
  const accessKeyId = env[`${prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${prefix}_SECRET_ACCESS_KEY`];

  if (!accessKeyId && !secretAccessKey) {
    return undefined;
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new ObjectStoreConfigError(
      `[storage/provider] Incomplete credentials: both ${prefix}_ACCESS_KEY_ID ` +
        `and ${prefix}_SECRET_ACCESS_KEY must be set together, ` +
        "or both unset to fall back to the SDK default credential chain."
    );
  }
  return { accessKeyId, secretAccessKey };
}
