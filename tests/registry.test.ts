/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * ProviderRegistry 泛型基座 — 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  ProviderRegistry,
  type KitProvider,
  type KitProviderStatus,
} from "../src/registry";

interface StubProvider extends KitProvider {
  verify?(input: string): string;
}

function stub(
  id: string,
  available: boolean | (() => boolean),
  priority?: number
): StubProvider {
  return {
    meta: { id, name: `Provider ${id}`, priority },
    isAvailable: () => (typeof available === "function" ? available() : available),
  };
}

class StubRegistry extends ProviderRegistry<StubProvider> {
  constructor() {
    super({ name: "StubRegistry" });
  }

  /** 暴露给测试使用 */
  resolve(predicate: (p: StubProvider) => boolean) {
    return this.resolveWith(predicate);
  }
}

describe("ProviderRegistry.register", () => {
  it("注册后按优先级降序排列", async () => {
    const registry = new StubRegistry();
    registry.register(stub("low", true, 10));
    registry.register(stub("high", true, 100));
    registry.register(stub("mid", true, 50));

    const active = await registry.getActiveProvider();
    expect(active?.meta.id).toBe("high");
  });

  it("重复 id 注册被忽略（不重复计入）", async () => {
    const registry = new StubRegistry();
    registry.register(stub("a", true));
    registry.register(stub("a", false));

    const status = await registry.getStatus();
    expect(status.registeredCount).toBe(1);
    // 保留首次注册的实例
    expect(status.providers[0].available).toBe(true);
  });

  it("registerAll 等价于逐个 register", async () => {
    const registry = new StubRegistry();
    registry.registerAll([stub("a", true, 1), stub("b", true, 2)]);

    const status = await registry.getStatus();
    expect(status.registeredCount).toBe(2);
    expect(status.activeProvider).toBe("b");
  });
});

describe("ProviderRegistry.getActiveProvider", () => {
  it("跳过不可用的 Provider，返回优先级最高的可用者", async () => {
    const registry = new StubRegistry();
    registry.register(stub("high", false, 100));
    registry.register(stub("mid", true, 50));
    registry.register(stub("low", true, 10));

    const active = await registry.getActiveProvider();
    expect(active?.meta.id).toBe("mid");
  });

  it("健康检查抛错时跳过该 Provider 并继续降级", async () => {
    const registry = new StubRegistry();
    registry.register({
      meta: { id: "boom", name: "Boom", priority: 100 },
      isAvailable: () => {
        throw new Error("health check exploded");
      },
    });
    registry.register(stub("ok", true, 1));

    const active = await registry.getActiveProvider();
    expect(active?.meta.id).toBe("ok");
  });

  it("全部不可用时返回 null", async () => {
    const registry = new StubRegistry();
    registry.register(stub("a", false));
    registry.register(stub("b", false));

    expect(await registry.getActiveProvider()).toBeNull();
  });
});

describe("ProviderRegistry.getStatus", () => {
  it("输出注册数/可用数/激活者与逐条状态", async () => {
    const registry = new StubRegistry();
    registry.register(stub("ok", true, 100));
    registry.register({
      meta: { id: "boom", name: "Boom", priority: 50 },
      isAvailable: () => {
        throw new Error("nope");
      },
    });
    registry.register(stub("off", false, 10));

    const status = await registry.getStatus();
    expect(status.registeredCount).toBe(3);
    expect(status.availableCount).toBe(1);
    expect(status.activeProvider).toBe("ok");
    expect(status.providers).toEqual([
      { id: "ok", name: "Provider ok", priority: 100, available: true },
      { id: "boom", name: "Boom", priority: 50, available: false },
      { id: "off", name: "Provider off", priority: 10, available: false },
    ]);
  });

  it("子类 describeProvider 可追加领域字段", async () => {
    interface TaggedStatus extends KitProviderStatus {
      channels: string[];
    }

    interface TaggedProvider extends KitProvider {
      channels: string[];
    }

    class TaggedRegistry extends ProviderRegistry<TaggedProvider, TaggedStatus> {
      constructor() {
        super({ name: "TaggedRegistry" });
      }

      protected describeProvider(
        provider: TaggedProvider,
        available: boolean
      ): TaggedStatus {
        return {
          ...super.describeProvider(provider, available),
          channels: [...provider.channels],
        };
      }
    }

    const registry = new TaggedRegistry();
    registry.register({
      meta: { id: "email", name: "Email", priority: 100 },
      isAvailable: () => true,
      channels: ["email"],
    });

    const status = await registry.getStatus();
    expect(status.providers[0]).toEqual({
      id: "email",
      name: "Email",
      priority: 100,
      available: true,
      channels: ["email"],
    });
  });
});

describe("ProviderRegistry.resolveWith", () => {
  it("predicate 过滤先于健康检查生效", async () => {
    const registry = new StubRegistry();
    registry.register(stub("filtered-out", true, 100));
    registry.register(stub("match", true, 10));

    const resolved = await registry.resolve(
      (p) => p.meta.id !== "filtered-out"
    );
    expect(resolved?.meta.id).toBe("match");
  });

  it("无匹配时返回 null", async () => {
    const registry = new StubRegistry();
    registry.register(stub("a", true));

    expect(await registry.resolve(() => false)).toBeNull();
  });
});
