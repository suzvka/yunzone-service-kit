/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * ops/next 管理后台路由守卫 — 单元测试（v2.0 密码本协议）
 *
 * 重点覆盖：
 * 1. cookies 双形态——Next.js 15.3+/16 为 getter 属性（回归核心 bug：旧实现
 *    `request.cookies?.()?.get(...)` 在属性形态下抛 TypeError: cookies is not a
 *    function），旧版为方法（兼容回归）；
 * 2. 守卫数据源为 initAdminRuntime 进程缓存——测试通过预置 runtime（注入
 *    readFileImpl，不落真实磁盘）驱动启用/禁用态，禁用态含"未配置"与"加载失败"。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  createSignedAdminSession,
  initAdminRuntime,
  parseAdminKeybook,
  resetAdminRuntimeForTest,
} from "../src/ops";
import { requireAdminAuth } from "../src/ops/next";

// 固定测试密码本（内存生成，不落盘）
const { publicKey } = generateKeyPairSync("ed25519");
const KEYBOOK_JSON = JSON.stringify({
  version: 1,
  keys: [{ id: "ops-laptop", public_key: publicKey.export({ format: "jwk" }).x }],
});
const FINGERPRINT = parseAdminKeybook(KEYBOOK_JSON).fingerprint;

/** 预置运行时：注入读取源（启用态） */
async function seedRuntime(enabled: "ok" | "fail" | "unset") {
  resetAdminRuntimeForTest();
  if (enabled === "unset") {
    await initAdminRuntime({ env: {}, force: true });
    return;
  }
  await initAdminRuntime({
    env: { ADMIN_KEYBOOK: enabled === "ok" ? "kb.json" : "missing.json" },
    load: {
      readFileImpl: async () => {
        if (enabled === "fail") throw new Error("ENOENT");
        return KEYBOOK_JSON;
      },
    },
    force: true,
  });
}

afterEach(() => {
  resetAdminRuntimeForTest();
  delete process.env.ADMIN_KEYBOOK;
  delete process.env.ADMIN_SESSION_MAX_AGE;
  vi.restoreAllMocks();
});

/** 伪造 RequestCookies（仅暴露守卫依赖的 get） */
function fakeCookies(session?: string) {
  return {
    get: (name: string) =>
      session ? { name, value: session } : undefined,
  };
}

/** Next.js 16 形态：cookies 为 getter 属性 */
function propertyCookiesRequest(session?: string) {
  return { cookies: fakeCookies(session) };
}

/** 旧版形态：cookies 为方法 */
function methodCookiesRequest(session?: string) {
  return { cookies: () => fakeCookies(session) };
}

function validSession() {
  return createSignedAdminSession(FINGERPRINT, "ops-laptop");
}

/** 守卫可承载的 handler 形态（双参数：request + context） */
function makeHandler() {
  return vi.fn(
    async (_request: unknown, _context: unknown) => new Response("ok")
  );
}

describe("requireAdminAuth", () => {
  it("密码本未配置 → 503 ADMIN_DISABLED，不调用 handler", async () => {
    await seedRuntime("unset");
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(propertyCookiesRequest(validSession()), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: "ADMIN_DISABLED",
      message: expect.any(String),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("密码本加载失败 → 与未配置同语义（503，无回退）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedRuntime("fail");
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(propertyCookiesRequest(validSession()), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "ADMIN_DISABLED", message: expect.any(String) });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("无会话 cookie → 401 UNAUTHENTICATED，不调用 handler", async () => {
    await seedRuntime("ok");
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(propertyCookiesRequest(), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: expect.any(String),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("属性式 cookies + 有效会话 → 放行并透传 request/context（Next.js 16 形态）", async () => {
    await seedRuntime("ok");
    const context = { params: Promise.resolve({ id: "abc" }) };
    const handler = vi.fn(async (request: unknown, ctx: unknown) =>
      Response.json({ echoed: !!request && !!ctx })
    );
    const wrapped = requireAdminAuth(handler);

    const request = propertyCookiesRequest(validSession());
    const res = await wrapped(request, context);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echoed: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(request, context);
  });

  it("函数式 cookies + 有效会话 → 放行（旧版 Next.js 形态兼容）", async () => {
    await seedRuntime("ok");
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(methodCookiesRequest(validSession()), {
      params: Promise.resolve({})
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("无效会话 → 401 UNAUTHENTICATED，不调用 handler", async () => {
    await seedRuntime("ok");
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(
      propertyCookiesRequest("tampered.invalid-session"),
      { params: Promise.resolve({}) }
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: expect.any(String),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("换本（指纹变化）后旧会话失效 → 401", async () => {
    await seedRuntime("ok");
    const staleSession = createSignedAdminSession("a".repeat(64), "ops-laptop");
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(propertyCookiesRequest(staleSession), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
