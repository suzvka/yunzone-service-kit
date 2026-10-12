/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * ops 管理后台公共逻辑（v2.0 密码本协议）— 单元测试
 *
 * 覆盖：resolveAdminConfig（ADMIN_KEYBOOK）、challenge 签发/校验（窗口、
 * host 绑定、一次性消费）、HMAC 会话（指纹派生）。密码本解析/加载/验签
 * 见 tests/admin-keybook.test.ts。
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS,
  buildAdminLoginMessage,
  createAdminChallenge,
  createAdminChallengeSeenStore,
  createSignedAdminSession,
  deriveAdminChallengeSecret,
  deriveAdminSessionSecret,
  resolveAdminConfig,
  validateSignedAdminSession,
  verifyAdminChallenge,
} from "../src/ops";

/** 固定测试指纹（与真实密码本解耦，会话/challenge 只消费指纹字符串） */
const FP = "f".repeat(64);
const FP2 = "e".repeat(64);

describe("resolveAdminConfig", () => {
  it("未设置 ADMIN_KEYBOOK 时管理后台禁用", () => {
    const config = resolveAdminConfig({});
    expect(config.enabled).toBe(false);
    expect(config.keybookSource).toBeNull();
    expect(config.path).toBe("/admin");
  });

  it("空串/纯空白视为未设置（显式禁用，不允许半配置态）", () => {
    expect(resolveAdminConfig({ ADMIN_KEYBOOK: "" }).enabled).toBe(false);
    expect(resolveAdminConfig({ ADMIN_KEYBOOK: "   " }).enabled).toBe(false);
  });

  it("设置 ADMIN_KEYBOOK 后启用，来源两端空白被修剪，ADMIN_PATH 可覆盖", () => {
    const config = resolveAdminConfig({
      ADMIN_KEYBOOK: "  ./keybook.json ",
      ADMIN_PATH: "/ops-console",
    });
    expect(config.enabled).toBe(true);
    expect(config.keybookSource).toBe("./keybook.json");
    expect(config.path).toBe("/ops-console");
  });
});

describe("resolveAdminConfig（ADMIN_SESSION_MAX_AGE）", () => {
  it("未配置时默认 86400（24h）", () => {
    expect(resolveAdminConfig({}).sessionMaxAgeSeconds).toBe(86400);
    expect(
      resolveAdminConfig({ ADMIN_KEYBOOK: "x" }).sessionMaxAgeSeconds
    ).toBe(ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS);
  });

  it("合法数值被采纳", () => {
    const config = resolveAdminConfig({
      ADMIN_KEYBOOK: "x",
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

describe("createAdminChallenge / verifyAdminChallenge", () => {
  const NOW = 1_000_000_000_000; // ms
  const HOST = "core.example.com";

  it("令牌为三段 nonce.issuedAt.sig", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    const parts = challenge.token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(challenge.nonceB64);
    expect(parts[1]).toBe(String(Math.floor(NOW / 1000)));
    expect(challenge.issuedAt).toBe(Math.floor(NOW / 1000));
    expect(challenge.expiresIn).toBe(ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS);
  });

  it("窗口内校验通过并返回 nonce", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    const store = createAdminChallengeSeenStore();
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP,
        host: HOST,
        now: NOW + 30_000,
        seen: store,
      })
    ).toEqual({ nonceB64: challenge.nonceB64, issuedAt: Math.floor(NOW / 1000) });
  });

  it("超窗被拒（默认 120s，可自定义）", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP,
        host: HOST,
        now: NOW + (ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS + 1) * 1000,
        seen: createAdminChallengeSeenStore(),
      })
    ).toBeNull();
    const shortLived = createAdminChallenge(FP, HOST, {
      now: NOW,
      maxAgeSeconds: 60,
    });
    expect(
      verifyAdminChallenge(shortLived.token, {
        fingerprint: FP,
        host: HOST,
        maxAgeSeconds: 60,
        now: NOW + 61_000,
        seen: createAdminChallengeSeenStore(),
      })
    ).toBeNull();
  });

  it("host 通道绑定：跨服务重放被拒", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP,
        host: "auth.example.com",
        now: NOW + 1_000,
        seen: createAdminChallengeSeenStore(),
      })
    ).toBeNull();
  });

  it("指纹不符 → 拒（secret 派生自密码本指纹）", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP2,
        host: HOST,
        now: NOW + 1_000,
        seen: createAdminChallengeSeenStore(),
      })
    ).toBeNull();
  });

  it("nonce 一次性消费：第二次校验被拒（LRU），clear 后可复用", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    const store = createAdminChallengeSeenStore();
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP,
        host: HOST,
        now: NOW + 1_000,
        seen: store,
      })
    ).not.toBeNull();
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP,
        host: HOST,
        now: NOW + 2_000,
        seen: store,
      })
    ).toBeNull();
    store.clear();
    expect(
      verifyAdminChallenge(challenge.token, {
        fingerprint: FP,
        host: HOST,
        now: NOW + 3_000,
        seen: store,
      })
    ).not.toBeNull();
  });

  it("seen: null 跳过重放检查（无状态场景）", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    for (let i = 0; i < 2; i++) {
      expect(
        verifyAdminChallenge(challenge.token, {
          fingerprint: FP,
          host: HOST,
          now: NOW + 1_000,
          seen: null,
        })
      ).not.toBeNull();
    }
  });

  it("篡改签名/畸形令牌不抛异常直接拒", () => {
    const challenge = createAdminChallenge(FP, HOST, { now: NOW });
    const store = createAdminChallengeSeenStore();
    const base = { fingerprint: FP, host: HOST, now: NOW + 1_000, seen: store };
    const [nonce, issuedAt] = challenge.token.split(".");
    expect(verifyAdminChallenge(null, base)).toBeNull();
    expect(verifyAdminChallenge("", base)).toBeNull();
    expect(verifyAdminChallenge("a.b", base)).toBeNull();
    expect(verifyAdminChallenge("a.b.c.d", base)).toBeNull();
    expect(verifyAdminChallenge(`${nonce}.${issuedAt}.!!!`, base)).toBeNull();
    expect(verifyAdminChallenge(`${nonce}.not-a-number.x`, base)).toBeNull();
    expect(
      verifyAdminChallenge(`${nonce}.${issuedAt}.${issuedAt}`, base)
    ).toBeNull();
  });

  it("同 host 连续签发的 nonce 互不相同", () => {
    const a = createAdminChallenge(FP, HOST);
    const b = createAdminChallenge(FP, HOST);
    expect(a.nonceB64).not.toBe(b.nonceB64);
    expect(a.token).not.toBe(b.token);
  });

  it("deriveAdminChallengeSecret 域分隔独立于会话 secret", () => {
    expect(deriveAdminChallengeSecret(FP)).toBe(
      createHash("sha256").update(`admin-challenge:${FP}`).digest("hex")
    );
    expect(deriveAdminChallengeSecret(FP)).not.toBe(deriveAdminSessionSecret(FP));
  });
});

describe("buildAdminLoginMessage", () => {
  it("规范串逐字节固定：v2.{key_id}.{nonce}.{host}.{ts}", () => {
    expect(
      buildAdminLoginMessage({
        keyId: "ops-laptop",
        nonceB64: "abc-123",
        host: "core.example.com",
        ts: 1_000_000_000,
      })
    ).toBe("v2.ops-laptop.abc-123.core.example.com.1000000000");
  });
});

describe("createSignedAdminSession / validateSignedAdminSession（指纹派生会话）", () => {
  it("会话格式为 payload.signature 两段 base64url", () => {
    const session = createSignedAdminSession(FP, "ops-laptop", 1_000_000_000_000);
    const parts = session.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("有效会话返回 key_id 主体", () => {
    const session = createSignedAdminSession(FP, "ops-laptop", 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, FP, { now: 1_000_001_000_000 })
    ).toBe("ops-laptop");
  });

  it("默认主体为 admin", () => {
    const session = createSignedAdminSession(FP); // 当前时间签发，立即校验
    expect(validateSignedAdminSession(session, FP)).toBe("admin");
  });

  it("默认 24h 内通过、超时被拒", () => {
    const session = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, FP, { now: 1_000_080_000_000 })
    ).toBe("admin");
    expect(
      validateSignedAdminSession(session, FP, { now: 1_000_087_000_000 })
    ).toBeNull();
  });

  it("maxAgeSeconds 可自定义", () => {
    const session = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    expect(
      validateSignedAdminSession(session, FP, {
        maxAgeSeconds: 60,
        now: 1_000_000_050_000,
      })
    ).toBe("admin");
    expect(
      validateSignedAdminSession(session, FP, {
        maxAgeSeconds: 60,
        now: 1_000_000_061_000,
      })
    ).toBeNull();
  });

  it("篡改载荷任一字节 → 拒（签名不匹配）", () => {
    const session = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    const [, signature] = session.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ u: "attacker", i: "00".repeat(8), t: 1_000_000_000 })
    ).toString("base64url");
    expect(
      validateSignedAdminSession(`${tamperedPayload}.${signature}`, FP)
    ).toBeNull();
  });

  it("篡改签名 → 拒", () => {
    const session = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    const [payloadStr] = session.split(".");
    const t = payloadStr[0] === payloadStr[0].toLowerCase() ? "A" : "a";
    expect(validateSignedAdminSession(`${payloadStr}.${t}`, FP)).toBeNull();
  });

  it("指纹不符 → 拒（换本重启后旧会话全失效的机理）", () => {
    const session = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    expect(validateSignedAdminSession(session, FP2)).toBeNull();
  });

  it("畸形会话不抛异常直接拒", () => {
    expect(validateSignedAdminSession(undefined, FP)).toBeNull();
    expect(validateSignedAdminSession("", FP)).toBeNull();
    expect(validateSignedAdminSession("no-dot", FP)).toBeNull();
    expect(validateSignedAdminSession("a.b.c", FP)).toBeNull();
    expect(validateSignedAdminSession("!!!.!!!", FP)).toBeNull();
    const [, signature] = createSignedAdminSession(FP, undefined, 1_000_000_000_000).split(".");
    // 合法签名 + 不可解析载荷
    const badPayload = Buffer.from("{not-json").toString("base64url");
    expect(validateSignedAdminSession(`${badPayload}.${signature}`, FP)).toBeNull();
    // 合法签名 + 载荷结构非法——签名必然不匹配，直接拒
    const wrongShape = Buffer.from('{"x":1}').toString("base64url");
    expect(validateSignedAdminSession(`${wrongShape}.${signature}`, FP)).toBeNull();
  });

  it("同指纹同时间签发两个会话互不相同（i 随机注入）", () => {
    const a = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    const b = createSignedAdminSession(FP, undefined, 1_000_000_000_000);
    expect(a).not.toBe(b);
  });

  it("deriveAdminSessionSecret = sha256hex('admin-session:' + fingerprint)", () => {
    expect(deriveAdminSessionSecret(FP)).toBe(
      createHash("sha256").update(`admin-session:${FP}`).digest("hex")
    );
  });

  it("cookie 常量与协议一致", () => {
    expect(ADMIN_SESSION_COOKIE).toBe("admin_session");
  });
});
