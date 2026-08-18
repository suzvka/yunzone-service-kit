/**
 * 环境变量 Schema 解析
 *
 * 集群统一约定：每个服务用 zod 声明自己的环境变量契约，
 * 启动时/首次使用时懒解析；缺失或非法时抛出带诊断快照的 EnvConfigError。
 *
 * 诊断快照只输出相关变量的 set/unset 状态，**绝不回显变量值**（防密钥泄漏）。
 */

import type { ZodObject, ZodRawShape, output } from "zod";

/** 环境变量校验失败（message 附带诊断快照） */
export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

/**
 * 声明环境变量 schema（恒等函数，仅用于语义化与类型复用）
 *
 * ```ts
 * const envSchema = defineEnv(z.object({
 *   STORAGE_PROVIDER: z.string(),
 *   COZE_BUCKET_NAME: z.string().optional(),
 * }));
 * const env = loadEnv(envSchema);
 * ```
 */
export function defineEnv<S extends ZodObject<ZodRawShape>>(schema: S): S {
  return schema;
}

/**
 * 用 schema 解析 process.env。
 *
 * 失败时抛出 EnvConfigError，message 包含：
 * 1. 各校验问题的路径与描述
 * 2. 诊断快照（schema 顶层 key 的 set/unset 状态，不含变量值）
 */
export function loadEnv<S extends ZodObject<ZodRawShape>>(
  schema: S
): output<S> {
  const result = schema.safeParse(process.env);
  if (result.success) {
    return result.data;
  }

  const keys = Object.keys(schema.shape);
  const snapshot = keys
    .map((k) => `${k}=${process.env[k] !== undefined ? "***set***" : "(unset)"}`)
    .join(", ");
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

  throw new EnvConfigError(
    `[service-kit/config] Env validation failed: ${issues}. ` +
      `Diagnostic snapshot: { ${snapshot} }`
  );
}
