/**
 * 管理后台公共逻辑（纯逻辑，零框架耦合）
 *
 * 集群统一语义：ADMIN_PASSWORD 未设置 = 管理后台禁用（503），禁止默认密码回退。
 *
 * - resolveAdminConfig：读取管理面配置（密码/路径），未设置密码时 enabled=false
 * - verifyAdminToken：常量时间密码比较（防时序攻击）
 * - createAdminSession / validateAdminSession：会话签名与校验（含过期检查）
 *
 * 会话格式与 WanyanAI 既有实现兼容：`base64("admin:<password>:<timestamp>")`。
 */

import { timingSafeEqual } from "node:crypto";

/** 管理后台配置解析结果 */
export interface AdminConfig {
  /** 是否启用（ADMIN_PASSWORD 未设置时为 false） */
  enabled: boolean;
  /** 管理后台路径前缀（ADMIN_PATH，默认 "/admin"） */
  path: string;
  /** 管理密码（未设置时为 null） */
  password: string | null;
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
  return {
    enabled: password !== null,
    path: e.ADMIN_PATH || "/admin",
    password,
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
