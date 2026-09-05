/**
 * 环境变量 Schema 解析
 *
 * 集群统一约定：每个服务用 zod 声明自己的环境变量契约，
 * 启动时/首次使用时懒解析；缺失或非法时抛出带诊断快照的 EnvConfigError。
 *
 * 诊断快照只输出相关变量的 set/unset 状态，**绝不回显变量值**（防密钥泄漏）。
 */

import { z } from "zod";
import { loadDotEnv, type LoadDotEnvOptions } from "./dotenv";
import { facetKeys } from "./specs";

/** 环境变量校验失败（message 附带诊断快照） */
export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigError";
  }
}

/** loadEnv 选项 */
export interface LoadEnvOptions {
  /**
   * legacy 别名映射：规范 key → 旧变量名列表（过渡兼容用）。
   * 仅当规范 key 未设置时回退读取旧名；诊断快照只列规范名。
   *
   * 部署面过渡（TICKET-001）直接用预构建的 deploymentAliases 常量：
   *
   * ```ts
   * loadEnv(deploymentFacet, { aliases: deploymentAliases });
   * ```
   */
  aliases?: Record<string, string[]>;
  /**
   * 先从本地 .env 文件加载并合并进 process.env（见 loadDotEnv），
   * 再执行 schema 校验。部署时只需拷贝一份 .env 到服务目录。
   *
   * - `true`：使用默认路径 `<cwd>/.env`
   * - `LoadDotEnvOptions`：自定义路径 / override / required
   */
  dotenv?: boolean | LoadDotEnvOptions;
}

/**
 * 生成 env 变量的 set/unset 指纹（**不含变量值**）。
 * 供 loadEnv 诊断快照与 /ops 运维报告复用。
 */
export function envSnapshot(
  env: Record<string, string | undefined>,
  keys: string[]
): Record<string, "set" | "unset"> {
  const snapshot: Record<string, "set" | "unset"> = {};
  for (const key of keys) {
    snapshot[key] = env[key] !== undefined ? "set" : "unset";
  }
  return snapshot;
}

/**
 * 用 schema 解析 process.env。
 *
 * - `dotenv`：先从本地 .env 文件加载并合并（见 LoadEnvOptions）
 * - `aliases`：规范 key 未设置时回退 legacy 别名（见 LoadEnvOptions）
 * - 失败时抛出 EnvConfigError，message 包含：
 *   1. 各校验问题的路径与描述
 *   2. 诊断快照（schema 顶层 key 的 set/unset 状态，不含变量值）
 */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  options?: LoadEnvOptions
): z.output<S> {
  if (options?.dotenv) {
    loadDotEnv(typeof options.dotenv === "boolean" ? undefined : options.dotenv);
  }

  const env = options?.aliases
    ? applyAliases(process.env, options.aliases)
    : process.env;

  const result = schema.safeParse(env);
  if (result.success) {
    return result.data;
  }

  const keys = facetKeys(schema);
  const snapshot = Object.entries(envSnapshot(env, keys))
    .map(([k, v]) => `${k}=${v === "set" ? "***set***" : "(unset)"}`)
    .join(", ");
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");

  throw new EnvConfigError(
    `[service-kit/config] Env validation failed: ${issues}. ` +
      `Diagnostic snapshot: { ${snapshot} }`
  );
}

/**
 * 应用 legacy 别名：构建 env 拷贝，规范 key 未设置时回退到别名值。
 * 不修改 process.env（避免全局副作用）。
 *
 * 内部共享：供部署适配层（./deploy）复用；不在公共 API 中导出。
 */
export function applyAliases(
  env: Record<string, string | undefined>,
  aliases: Record<string, string[]>
): Record<string, string | undefined> {
  const result = { ...env };
  for (const [canonical, legacyList] of Object.entries(aliases)) {
    if (result[canonical] === undefined) {
      for (const legacy of legacyList) {
        if (env[legacy] !== undefined) {
          result[canonical] = env[legacy];
          break;
        }
      }
    }
  }
  return result;
}
