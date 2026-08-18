/**
 * ops 管理后台公共逻辑 — 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  createAdminSession,
  resolveAdminConfig,
  validateAdminSession,
  verifyAdminToken,
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

describe("verifyAdminToken", () => {
  it("匹配时返回 true", () => {
    expect(verifyAdminToken("pass-123", "pass-123")).toBe(true);
  });

  it("不匹配时返回 false", () => {
    expect(verifyAdminToken("pass-123", "pass-124")).toBe(false);
  });

  it("长度不同直接返回 false（不做时序比较）", () => {
    expect(verifyAdminToken("short", "a-much-longer-password")).toBe(false);
  });
});

describe("createAdminSession / validateAdminSession", () => {
  it("会话格式与既有实现兼容（base64(admin:password:ts)）", () => {
    const session = createAdminSession("pw", 1234567890000);
    expect(Buffer.from(session, "base64").toString("utf8")).toBe(
      "admin:pw:1234567890000"
    );
  });

  it("有效会话通过校验", () => {
    const session = createAdminSession("pw", 1_000_000_000_000);
    expect(validateAdminSession(session, "pw", { now: 1_000_001_000_000 })).toBe(
      true
    );
  });

  it("过期会话被拒绝（默认 30 分钟）", () => {
    const session = createAdminSession("pw", 1_000_000_000_000);
    expect(validateAdminSession(session, "pw", { now: 1_000_001_900_000 })).toBe(
      false
    );
  });

  it("密码不匹配被拒绝", () => {
    const session = createAdminSession("pw", 1_000_000_000_000);
    expect(validateAdminSession(session, "wrong", { now: 1_000_010_000_000 })).toBe(
      false
    );
  });

  it("空/非法会话被拒绝", () => {
    expect(validateAdminSession(undefined, "pw")).toBe(false);
    expect(validateAdminSession("", "pw")).toBe(false);
    expect(validateAdminSession("!!!not-base64!!!", "pw")).toBe(false);
  });

  it("时间戳非法时被拒绝", () => {
    const session = Buffer.from("admin:pw:not-a-number").toString("base64");
    expect(validateAdminSession(session, "pw")).toBe(false);
  });

  it("maxAgeMs 可自定义", () => {
    const session = createAdminSession("pw", 1_000_000_000_000);
    expect(
      validateAdminSession(session, "pw", {
        maxAgeMs: 60 * 1000,
        now: 1_000_000_050_000,
      })
    ).toBe(true);
    expect(
      validateAdminSession(session, "pw", {
        maxAgeMs: 60 * 1000,
        now: 1_000_000_061_000,
      })
    ).toBe(false);
  });
});
