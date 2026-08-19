/**
 * 管理后台公共逻辑（纯逻辑，零框架耦合）
 *
 * 集群统一语义：ADMIN_PASSWORD 未设置 = 管理后台禁用（503），禁止默认密码回退。
 *
 * v1.0 协议（Admin Session Protocol，见 docs/admin-session-protocol.md）：
 * - 会话格式为 HMAC-SHA256 签名，防伪造、无状态、多实例自动可用；
 * - secret 由密码哈希派生：`sha256hex("admin-session:" + sha256hex(ADMIN_PASSWORD))`，
 *   重启后仍可验证；密码轮换后全部旧会话失效；
 * - 校验顺序：分隔符 → 签名长度短路 + timingSafeEqual → 载荷 JSON 解析 → 过期检查；
 * - ADMIN_SESSION_MAX_AGE 控制会话有效期（秒），默认 86400（24h）。
 *
 * 函数清单：
 * - resolveAdminConfig：读取管理面配置（密码/路径/会话有效期），未设置密码时 enabled=false
 * - verifyAdminToken：常量时间密码比较（防时序攻击）
 * - hashAdminPassword / verifyAdminPasswordWithHash：登录密码哈希与常量时间比对（长度短路）
 * - createSignedAdminSession / validateSignedAdminSession：v1.0 HMAC 签名会话
 * - createAdminSession / validateAdminSession：legacy base64 明文会话（@deprecated，过渡后移除）
 */

import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** 管理后台会话 cookie 名（v1.0 协议统一） */
export const ADMIN_SESSION_COOKIE = "admin_session";

/** 会话默认有效期（秒）：24h */
export const ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/** 管理后台配置解析结果 */
export interface AdminConfig {
  /** 是否启用（ADMIN_PASSWORD 未设置时为 false） */
  enabled: boolean;
  /** 管理后台路径前缀（ADMIN_PATH，默认 "/admin"） */
  path: string;
  /** 管理密码（未设置时为 null） */
  password: string | null;
  /** 会话有效期（秒，ADMIN_SESSION_MAX_AGE，默认 86400） */
  sessionMaxAgeSeconds: number;
}

/**
 * 解析管理后台配置。
 *
 * 语义统一：ADMIN_PASSWORD 未设置 = 管理后台禁用（503）。
 */
export function resolveAdminConfig(
  env?: Record<string, string | undefined>
): AdminConfig {
  const e = env ?? process.env;
  const password = e.ADMIN_PASSWORD ?? null;

  const rawMaxAge = e.ADMIN_SESSION_MAX_AGE;
  const parsedMaxAge = rawMaxAge ? Number(rawMaxAge) : undefined;
  const sessionMaxAgeSeconds =
    parsedMaxAge !== undefined &&
    Number.isFinite(parsedMaxAge) &&
    parsedMaxAge > 0
      ? parsedMaxAge
      : ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS;

  return {
    enabled: password !== null,
    path: e.ADMIN_PATH || "/admin",
    password,
    sessionMaxAgeSeconds,
  };
}

/**
 * 校验管理 Token（常量时间比较，防时序攻击）。
 * 长度不等直接返回 false（不做比较）。
 */
export function verifyAdminToken(token: string, expected: string): boolean {
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * 计算管理密码的 SHA-256 十六进制哈希。
 * 供登录场景在模块加载时缓存，此后不持有明文（协议 2.5）。
 */
export function hashAdminPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

/**
 * 校验输入密码的哈希与缓存哈希是否一致（常量时间比较）。
 * 哈希后长度恒为 64，长度检查仅作 timingSafeEqual 的异常兜底（防不等长抛错）。
 */
export function verifyAdminPasswordWithHash(
  input: string,
  cachedPasswordHash: string
): boolean {
  const a = Buffer.from(hashAdminPassword(input));
  const b = Buffer.from(cachedPasswordHash);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/** 常量时间比较两个字符串（长度不等直接返回 false，防抛异常） */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** 会话载荷（协议 2.3：u=用户名，i=随机 nonce，t=签发时间秒） */
export interface SignedAdminSessionPayload {
  u: string;
  i: string;
  t: number;
}

/**
 * 从管理密码派生会话签名密钥（协议 2.3）。
 * 密码哈希参与派生 → 密码轮换后所有旧会话立即失效。
 */
export function deriveAdminSessionSecret(password: string): string {
  const passwordHash = hashAdminPassword(password);
  return createHash("sha256")
    .update(`admin-session:${passwordHash}`)
    .digest("hex");
}

/**
 * 创建 HMAC-SHA256 签名会话（协议 2.3）。
 * @param password 管理密码（仅在此用于派生 secret，不写入会话）
 * @param username 会话主体，默认 "admin"
 * @param now 当前时间（可注入用于测试）
 */
export function createSignedAdminSession(
  password: string,
  username: string = "admin",
  now: number = Date.now()
): string {
  const payload: SignedAdminSessionPayload = {
    u: username,
    i: randomBytes(8).toString("hex"),
    t: Math.floor(now / 1000),
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = deriveAdminSessionSecret(password);
  const signature = createHmac("sha256", secret)
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

/** validateSignedAdminSession 选项 */
export interface ValidateSignedAdminSessionOptions {
  /** 会话有效期（秒），默认 86400（24h） */
  maxAgeSeconds?: number;
  /** 当前时间（可注入用于测试），单位毫秒 */
  now?: number;
}

/**
 * 校验 HMAC 签名会话（协议 2.4），返回会话主体用户名或 null。
 *
 * 校验顺序：恰好 1 个 `.` 分隔符 → 签名长度短路 + 常量时间比较
 * → 载荷 JSON 解析与结构检查 → 过期检查。任一环节失败返回 null。
 */
export function validateSignedAdminSession(
  session: string | undefined | null,
  password: string,
  options: ValidateSignedAdminSessionOptions = {}
): string | null {
  if (!session) {
    return null;
  }

  const parts = session.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payloadStr, signature] = parts;

  const expectedSignature = createHmac(
    "sha256",
    deriveAdminSessionSecret(password)
  )
    .update(payloadStr)
    .digest("base64url");
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: SignedAdminSessionPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf8")
    ) as SignedAdminSessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.u !== "string" ||
    typeof payload.t !== "number"
  ) {
    return null;
  }

  const maxAgeSeconds =
    options.maxAgeSeconds ?? ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (now - payload.t > maxAgeSeconds) {
    return null;
  }

  return payload.u;
}

/**
 * @deprecated v1.0 起废弃（base64 明文会话内含明文密码，泄露即被永久伪造），
 * 过渡一个版本后移除；请改用 createSignedAdminSession。
 * 创建管理会话签名：`base64("admin:<password>:<timestamp>")`。
 */
export function createAdminSession(
  password: string,
  now: number = Date.now()
): string {
  return Buffer.from(`admin:${password}:${now}`).toString("base64");
}

/** validateAdminSession 选项 */
export interface ValidateAdminSessionOptions {
  /** 会话有效期（毫秒），默认 30 分钟 */
  maxAgeMs?: number;
  /** 当前时间（可注入用于测试），默认 Date.now() */
  now?: number;
}

/**
 * @deprecated v1.0 起废弃（base64 明文会话无法防伪造），
 * 过渡一个版本后移除；请改用 validateSignedAdminSession。
 * 校验管理会话：格式 → 密码匹配 → 过期检查。
 * 任一环节失败返回 false。
 */
export function validateAdminSession(
  session: string | undefined | null,
  password: string,
  options: ValidateAdminSessionOptions = {}
): boolean {
  if (!session) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(session, "base64").toString("utf8");
  } catch {
    return false;
  }

  const prefix = `admin:${password}:`;
  if (!decoded.startsWith(prefix)) {
    return false;
  }

  const timestamp = Number(decoded.slice(prefix.length));
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const maxAgeMs = options.maxAgeMs ?? 30 * 60 * 1000;
  const now = options.now ?? Date.now();
  return now - timestamp <= maxAgeMs;
}