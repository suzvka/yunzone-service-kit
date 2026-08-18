/**
 * 本地 .env 文件加载
 *
 * 集群部署约定：服务目录放置 .env 文件，启动时 loadDotEnv() 一次灌入
 * process.env，无需运维逐行设置环境变量。之后照常使用 loadEnv 做 schema 校验。
 *
 * 支持的语法子集（与 dotenv 惯例对齐，刻意保持精简）：
 * - `KEY=VALUE`（key 允许首尾空白，值去除首尾空白）
 * - 引号值：`'...'` 字面量（不解析转义）、`"..."`（解析 `\n` `\r` `\t` `\\` `\"`）
 * - `#` 整行注释、空行、可选 `export` 前缀、UTF-8 BOM
 * - 不支持：行尾内联注释（避免破坏含 `#` 的密码/URL）、多行值
 *
 * 合并语义：默认**不覆盖** process.env 已有变量（平台注入优先），
 * `override: true` 显式覆盖。
 *
 * 安全：错误信息只报行号与格式问题，**不回显变量值或行内容**（防密钥泄漏）。
 */

import { readFileSync } from "node:fs";

/** .env 文件解析/加载失败（message 不带变量值） */
export class EnvFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvFileError";
  }
}

/** parseDotEnv 选项 */
export interface ParseDotEnvOptions {
  /**
   * 遇到非法行（无 `=`）时是否抛 EnvFileError，默认 true。
   * 关闭后非法行静默跳过（兼容宽松的现有 env 文件）。
   */
  strict?: boolean;
}

/**
 * 解析 .env 文件内容为 key→value 映射（纯函数，无副作用）。
 *
 * 非法行在 strict 模式下抛 EnvFileError（带行号，不回显行内容）。
 */
export function parseDotEnv(
  content: string,
  options?: ParseDotEnvOptions
): Record<string, string> {
  const strict = options?.strict ?? true;
  const result: Record<string, string> = {};
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // 空行 / 整行注释
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    // 可选 export 前缀
    const body = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;
    const eq = body.indexOf("=");
    if (eq === -1) {
      if (strict) {
        throw new EnvFileError(
          `[service-kit/config] parseDotEnv: line ${i + 1} is not a ` +
            `"KEY=VALUE" assignment`
        );
      }
      continue;
    }
    const key = body.slice(0, eq).trim();
    if (key === "") {
      if (strict) {
        throw new EnvFileError(
          `[service-kit/config] parseDotEnv: line ${i + 1} has an empty key`
        );
      }
      continue;
    }
    result[key] = parseValue(body.slice(eq + 1).trim(), i + 1);
  }
  return result;
}

/** 解析单个值：引号包裹时取引号内内容，否则按字面量（保留内部空白） */
function parseValue(value: string, line: number): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === "'" || first === '"') {
      if (last !== first) {
        throw new EnvFileError(
          `[service-kit/config] parseDotEnv: line ${line} has an ` +
            `unclosed ${first} quote`
        );
      }
      const inner = value.slice(1, -1);
      return first === '"' ? unescapeDoubleQuoted(inner) : inner;
    }
  }
  return value;
}

/** 双引号值内转义：\n \r \t \\ \"（其余 \x 保留原字符） */
function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\(.)/g, (_, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return ch;
    }
  });
}

/** loadDotEnv 选项 */
export interface LoadDotEnvOptions {
  /** .env 文件路径，默认 `"<cwd>/.env"` */
  path?: string;
  /** 是否覆盖 process.env 已有变量，默认 false（平台注入优先） */
  override?: boolean;
  /**
   * 文件不存在时报错，默认 false（静默跳过——开发环境无 .env 可启动，
   * 生产环境由平台注入或 schema 校验兜底）。
   */
  required?: boolean;
}

/**
 * 读取本地 .env 文件并合并进 process.env。
 *
 * - 默认不覆盖已有变量；`override: true` 覆盖
 * - 文件不存在默认静默跳过；`required: true` 抛 EnvFileError
 * - 返回本次实际写入的变量（未覆盖的 key 不包含在内）
 */
export function loadDotEnv(options?: LoadDotEnvOptions): Record<string, string> {
  const filePath = options?.path ?? ".env";
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (options?.required) {
        throw new EnvFileError(
          `[service-kit/config] loadDotEnv: env file not found: ${filePath}`
        );
      }
      return {};
    }
    throw err;
  }

  const parsed = parseDotEnv(content);
  const loaded: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (options?.override || process.env[key] === undefined) {
      process.env[key] = value;
      loaded[key] = value;
    }
  }
  return loaded;
}
