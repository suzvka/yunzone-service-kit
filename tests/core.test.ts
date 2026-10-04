/** test-meta: tier=fast; risk=low; owner=platform; expires=2027-03-31 */
/**
 * core 模块 — 单元测试
 */

import { describe, expect, it } from "vitest";
import { KitError } from "../src/core";
import type { LifecycleAware } from "../src/core";

class SubError extends KitError {}

describe("KitError", () => {
  it("构造时 name / code 默认取类名", () => {
    const err = new KitError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("KitError");
    expect(err.code).toBe("KitError");
    expect(err.message).toBe("boom");
  });

  it("子类 name / code 自动取子类名", () => {
    const err = new SubError("sub boom");
    expect(err.name).toBe("SubError");
    expect(err.code).toBe("SubError");
    expect(err).toBeInstanceOf(KitError);
  });

  it("支持自定义 code 与 cause", () => {
    const root = new Error("root cause");
    const err = new KitError("wrapped", { code: "DB_DOWN", cause: root });
    expect(err.code).toBe("DB_DOWN");
    expect(err.cause).toBe(root);
  });

  it("toJSON 输出纯对象且序列化 cause 的 message", () => {
    const err = new KitError("wrapped", { cause: new Error("root") });
    expect(err.toJSON()).toEqual({
      name: "KitError",
      code: "KitError",
      message: "wrapped",
      cause: "root",
    });
  });

  it("toJSON 不携带 cause 时省略该字段", () => {
    const err = new KitError("plain");
    expect(err.toJSON()).toEqual({ name: "KitError", code: "KitError", message: "plain" });
  });
});

describe("LifecycleAware", () => {
  it("可选钩子的最优实现形态可通过类型呼吸验证", () => {
    const lifecycle: LifecycleAware = {
      init: async () => {},
      disconnect: async () => {},
    };
    expect(typeof lifecycle.init).toBe("function");
    expect(typeof lifecycle.disconnect).toBe("function");

    // 无资源实现：缺省即可
    const bare: LifecycleAware = {};
    expect(bare.init).toBeUndefined();
  });
});