/**
 * 泛型 Provider 注册中心 — 核心类型定义
 *
 * 设计目标：
 * - 定义集群内所有"插件式 Provider"模式的公共契约（验证码、风控、对象存储等）
 * - Provider 声明元信息与就绪状态，注册中心负责优先级调度与健康检查
 * - 领域注册中心（如 captcha / verification）通过继承 ProviderRegistry 复用调度逻辑
 */

/** Provider 元信息 */
export interface KitProviderMeta {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 优先级（数值越大越优先），默认 0 */
  priority?: number;
}

/**
 * Provider 基础接口
 *
 * 领域 Provider 在此基础上扩展能力方法（如 verify / sendCode）。
 */
export interface KitProvider {
  /** Provider 元信息 */
  readonly meta: KitProviderMeta;

  /**
   * 健康检查：判断当前环境是否具备运行条件
   * 例如：环境变量是否配置、外部服务是否可达等
   */
  isAvailable(): Promise<boolean> | boolean;
}

/** 单个 Provider 的状态摘要（getStatus 的 providers 条目基型） */
export interface KitProviderStatus {
  id: string;
  name: string;
  priority: number;
  available: boolean;
}

/** 注册中心状态快照 */
export interface KitRegistryStatus<
  P extends KitProviderStatus = KitProviderStatus,
> {
  /** 已注册的 Provider 数量 */
  registeredCount: number;
  /** 当前可用的 Provider 数量 */
  availableCount: number;
  /** 当前激活的 Provider（id），无可用则为 null */
  activeProvider: string | null;
  /** 所有已注册 Provider 的状态摘要 */
  providers: P[];
}
