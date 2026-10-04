/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * ops 管理后台公共逻辑 — 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS,
  createSignedAdminSession,
  deriveAdminSessionSecret,
  hashAdminPassword,
  resolveAdminConfig,
  validateSignedAdminSession,
  verifyAdminPasswordWithHash,
} from "../src/ops";

describe("resolveAdminConfig", () => {
  it("未设置 ADMIN_PASSWORD 时管理后台禁用", () => {
    const config = resolveAdminConfig({});
    expect(config.enabled).toBe(false);
    expect(config.password).toBeNull();
    expect(config.path).toBe("/admin");
  });

  it("设置 ADMIN_PASSWORD 后启用，ADMIN_PATH 可覆盖", () => {
    const config = resolveAdminConfig({
      ADMIN_PASSWORD: "s3cret",
      ADMIN_PATH: "/ops-console",
    });
    expect(config.enabled).toBe(true);
    expect(config.password).toBe("s3cret");
    expect(config.path).toBe("/ops-console");
  });
});

describe("resolveAdminConfig（v1.0：ADMIN_SESSION_MAX_AGE）", () => {
  it("未配置时默认 86400（24h）", () => {
    expect(resolveAdminConfig({}).sessionMaxAgeSeconds).toBe(86400);
    expect(resolveAdminConfig({ ADMIN_PASSWORD: "x" }).sessionMaxAgeSeconds).toBe(
      ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS
    );
  });

  it("合法数值被采纳", () => {
    const config = resolveAdminConfig({
      ADMIN_PASSWORD: "x",
      ADMIN_SESSION_MAX_AGE: "1800",
    });
    expect(config.sessionMaxAgeSeconds).toBe(1800);
  });

  it("非法/非正数值回退默认", () => {
    expect(
      resolveAdminConfig({ ADMIN_SESSION_MAX_AGE: "abc" }).sessionMaxAgeSeconds
    ).toBe(86400);
    expect(
      resolveAdminConfig({ ADMIN_SESSION_MAX_AGE: "-5" }).sessionMaxAgeSeconds
    ).toBe(86400);
    expect(
      resolveAdminConfig({ ADMIN_SESSION_MAX_AGE: "0" }).sessionMaxAgeSeconds
    ).toBe(86400);
  });
});

describe("hashAdminPassword / verifyAdminPasswordWithHash", () => {
  it("哈希为固定长度十六进制", () => {
    expect(hashAdminPassword("s3cret")).toHaveLength(64);
    expect(hashAdminPassword("s3cret")).not.toBe("s3cret");
  });

  it("正确密码通过，错误密码拒绝", () => {
    const cached = hashAdminPassword("s3cret");
    expect(verifyAdminPasswordWithHash("s3cret", cached)).toBe(true);
    expect(verifyAdminPasswordWithHash("wrong", cached)).toBe(false);
  });

  it("非法缓存哈希（长度异常）不抛异常直接拒绝", () => {
    expect(verifyAdminPasswordWithHash("s3cret", "short")).toBe(false);
  });
});

describe("createSignedAdminSession / validateSignedAdminSession（v1.0 HMAC）", () => {
  it("会话格式为 payload.signature 两段 base64url", () => {
    const session = createSignedAdminSession("pw", "admin", 1_000_000_000_000);
    const parts = session.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("有效会话返回用户名", () => {
    const session = createSignedAdminSession("pw", "ops", 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, "pw", { now: 1_000_001_000_000 })
    ).toBe("ops");
  });

  it("默认主体为 admin", () => {
    const session = createSignedAdminSession("pw"); // 当前时间签发，立即校验
    expect(validateSignedAdminSession(session, "pw")).toBe("admin");
  });

  it("长期有效（默认 24h 内通过）", () => {
    const session = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, "pw", { now: 1_000_080_000_000 })
    ).toBe("admin");
  });

  it("超过默认 24h 被拒", () => {
    const session = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, "pw", { now: 1_000_087_000_000 })
    ).toBeNull();
  });

  it("maxAgeSeconds 可自定义", () => {
    const session = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, "pw", {
        maxAgeSeconds: 60,
        now: 1_000_000_050_000,
      })
    ).toBe("admin");
    expect(
      validateSignedAdminSession(session, "pw", {
        maxAgeSeconds: 60,
        now: 1_000_000_061_000,
      })
    ).toBeNull();
  });

  it("篡改载荷任一字节 → 拒（签名不匹配）", () => {
    const session = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    const [, signature] = session.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ u: "admin", i: "00".repeat(8), t: 1_000_000_000_000 })
    ).toString("base64url");
    expect(
      validateSignedAdminSession(`${tamperedPayload}.${signature}`, "pw")
    ).toBeNull();
  });

  it("篡改签名 → 拒", () => {
    const session = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    const [payloadStr] = session.split(".");
    const t = payloadStr[0] === payloadStr[0].toLowerCase() ? "A" : "a";
    expect(
      validateSignedAdminSession(`${payloadStr}.${t}`, "pw")
    ).toBeNull();
  });

  it("密码不符 → 拒（secret 派生自密码）", () => {
    const session = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    expect(validateSignedAdminSession(session, "wrong")).toBeNull();
  });

  it("畸形会话不抛异常直接拒", () => {
    expect(validateSignedAdminSession(undefined, "pw")).toBeNull();
    expect(validateSignedAdminSession("", "pw")).toBeNull();
    expect(validateSignedAdminSession("no-dot", "pw")).toBeNull();
    expect(validateSignedAdminSession("a.b.c", "pw")).toBeNull();
    expect(validateSignedAdminSession("!!!.!!!", "pw")).toBeNull();
    const [payloadStr, signature] = createSignedAdminSession(
      "pw",
      undefined,
      1_000_000_000_000
    ).split(".");
    // 合法签名 + 不可解析载荷
    const badPayload = Buffer.from("{not-json").toString("base64url");
    expect(
      validateSignedAdminSession(`${badPayload}.${signature}`, "pw")
    ).toBeNull();
    // 合法签名 + 载荷结构非法
    const wrongShape = Buffer.from('{"x":1}').toString("base64url");
    expect(
      validateSignedAdminSession(`${wrongShape}.${signature}`, "pw")
    ).toBeNull();
    expect(payloadStr.length).toBeGreaterThan(0);
  });

  it("同密码同时间签发两个会话互不相同（i 随机注入）", () => {
    const a = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    const b = createSignedAdminSession("pw", undefined, 1_000_000_000_000);
    expect(a).not.toBe(b);
  });

  it("deriveAdminSessionSecret 与现状服务派生方式一致", () => {
    const secret = deriveAdminSessionSecret("pw");
    expect(
      require("node:crypto")
        .createHash("sha256")
        .update("admin-session:" + hashAdminPassword("pw"))
        .digest("hex")
    ).toBe(secret);
  });

  it("cookie 常量与协议一致", () => {
    expect(ADMIN_SESSION_COOKIE).toBe("admin_session");
  });
});
