/**
 * ops 错误族（纯逻辑，零框架耦合）
 *
 * 惯例对齐 /storage 与 /config：领域错误继承 KitError，携带机器可读 code；
 * message 只报来源标识与字段名，**绝不回显密码本 URL 的访问凭据**（URL 可能
 * 为预签名地址，来源标识一律脱敏为占位符）。
 */

import { KitError } from "../core";

/** 密码本缺失 / 下载失败 / 解析失败 / 校验失败 */
export class AdminKeybookError extends KitError {
  constructor(
    message: string,
    options?: { cause?: unknown; code?: string }
  ) {
    super(message, { code: "ADMIN_KEYBOOK_INVALID", ...options });
  }
}
