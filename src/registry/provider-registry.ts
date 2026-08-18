/**
 * 泛型 Provider 注册中心基座
 *
 * 职责：
 * 1. 管理 Provider 注册与生命周期（重复 id 忽略 + 优先级排序）
 * 2. 按优先级逐个健康检查，选出当前可用的最佳 Provider
 * 3. 单个 Provider 健康检查失败时 warn 并跳过（优雅降级）
 * 4. 输出统一的状态快照，供调试/监控端点聚合
 *
 * 使用方式：
 * ```ts
 * import { ProviderRegistry } from "yunzone-service-kit/registry";
 *
 * class MyRegistry extends ProviderRegistry<MyProvider> {
 *   constructor() {
 *     super({ name: "MyRegistry" });
 *   }
 * }
 *
 * const registry = new MyRegistry();
 * registry.register(myProvider);
 * const active = await registry.getActiveProvider();
 * ```
 */

import type {
  KitProvider,
  KitProviderStatus,
  KitRegistryStatus,
} from "./types";

/** ProviderRegistry 构造参数 */
export interface ProviderRegistryOptions {
  /** 日志前缀（不含方括号），如 "CaptchaRegistry" */
  name: string;
}

export class ProviderRegistry<
  T extends KitProvider,
  P extends KitProviderStatus = KitProviderStatus,
> {
  /** 日志前缀 */
  protected readonly registryName: string;

  private providers: T[] = [];

  constructor(options: ProviderRegistryOptions) {
    this.registryName = options.name;
  }

  /**
   * 注册一个 Provider
   * 重复注册相同 id 的 Provider 会被忽略
   */
  register(provider: T): this {
    const existing = this.providers.find((p) => p.meta.id === provider.meta.id);
    if (existing) {
      console.warn(
        `[${this.registryName}] Provider "${provider.meta.id}" already registered, skipping.`
      );
      return this;
    }

    this.providers.push(provider);
    this.providers.sort(
      (a, b) => (b.meta.priority ?? 0) - (a.meta.priority ?? 0)
    );
    console.log(
      `[${this.registryName}] Registered provider: ${provider.meta.id} (priority: ${provider.meta.priority ?? 0})`
    );
    return this;
  }

  /**
   * 批量注册 Provider
   */
  registerAll(providers: T[]): this {
    for (const p of providers) {
      this.register(p);
    }
    return this;
  }

  /**
   * 按 predicate 过滤后，返回优先级最高的可用 Provider。
   * providers 已按优先级排序；单个 Provider 健康检查失败时 warn 并跳过。
   *
   * 领域注册中心用此方法实现自己的路由规则（如渠道/区域匹配），
   * 无过滤需求时直接使用 getActiveProvider()。
   */
  protected async resolveWith(
    predicate: (provider: T) => boolean
  ): Promise<T | null> {
    for (const provider of this.providers) {
      if (!predicate(provider)) {
        continue;
      }

      try {
        const available = await provider.isAvailable();
        if (available) {
          return provider;
        }
      } catch {
        // 单个 Provider 健康检查失败不影响其他
        console.warn(
          `[${this.registryName}] Health check failed for "${provider.meta.id}", trying next...`
        );
      }
    }
    return null;
  }

  /**
   * 获取当前可用的最佳 Provider（按优先级排序后第一个可用的）
   */
  async getActiveProvider(): Promise<T | null> {
    return this.resolveWith(() => true);
  }

  /**
   * 描述单个 Provider 的状态条目。
   * 子类可覆盖以追加领域字段（如支持的渠道/区域），
   * 同时需将第二个泛型参数 P 指定为扩展后的状态类型。
   */
  protected describeProvider(provider: T, available: boolean): P {
    return {
      id: provider.meta.id,
      name: provider.meta.name,
      priority: provider.meta.priority ?? 0,
      available,
    } as P;
  }

  /**
   * 获取注册中心当前状态（用于调试/监控）
   */
  async getStatus(): Promise<KitRegistryStatus<P>> {
    const availableResults = await Promise.allSettled(
      this.providers.map(async (p) => {
        try {
          return await p.isAvailable();
        } catch {
          return false;
        }
      })
    );

    const providers = this.providers.map((p, i) => {
      const result = availableResults[i];
      const available =
        result.status === "fulfilled" ? result.value : false;
      return this.describeProvider(p, available);
    });

    const active = providers.find((p) => p.available);

    return {
      registeredCount: this.providers.length,
      availableCount: providers.filter((p) => p.available).length,
      activeProvider: active?.id ?? null,
      providers,
    };
  }
}
