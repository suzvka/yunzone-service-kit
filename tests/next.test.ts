/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * ops/next 管理后台路由守卫 — 单元测试
 *
 * 重点覆盖 cookies 双形态：Next.js 15.3+/16 为 getter 属性（回归核心 bug：
 * 旧实现 `request.cookies?.()?.get(...)` 在属性形态下抛
 * TypeError: cookies is not a function），旧版为方法（兼容回归）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignedAdminSession } from "../src/ops";
import { requireAdminAuth } from "../src/ops/next";

const PASSWORD = "test-admin-password";

afterEach(() => {
  delete process.env.ADMIN_PASSWORD;
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
  return createSignedAdminSession(PASSWORD, "admin");
}

/** 守卫可承载的 handler 形态（双参数：request + context） */
function makeHandler() {
  return vi.fn(
    async (_request: unknown, _context: unknown) => new Response("ok")
  );
}

describe("requireAdminAuth", () => {
  it("ADMIN_PASSWORD 未设置 → 503 ADMIN_DISABLED，不调用 handler", async () => {
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

  it("无会话 cookie → 401 UNAUTHENTICATED，不调用 handler", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
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
    process.env.ADMIN_PASSWORD = PASSWORD;
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
    process.env.ADMIN_PASSWORD = PASSWORD;
    const handler = makeHandler();
    const wrapped = requireAdminAuth(handler);

    const res = await wrapped(methodCookiesRequest(validSession()), {
      params: Promise.resolve({}),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("无效会话 → 401 UNAUTHENTICATED，不调用 handler", async () => {
    process.env.ADMIN_PASSWORD = PASSWORD;
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
});
