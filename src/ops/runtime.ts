/**
 * 管理后台运行时装配（启动一次性加载）
 *
 * v2.0 协议的"密码本仅在启动时加载一次"落点：initAdminRuntime 首次调用时
 * 解析 ADMIN_KEYBOOK 并加载密码本，结果缓存至进程生命周期结束——换本须重启。
 * 缓存挂载于 globalThis：CJS/ESM 双构建实例共享同一缓存（dual-package 安全，
 * 惯例对齐 /auth credential-file）。
 *
 * 失败语义（禁用的唯一形态，禁止任何回退）：
 * - ADMIN_KEYBOOK 未设置 → enabled: false（管理后台禁用，守卫返回 503）；
 * - 来源不可达 / 形态非法 → console.warn 后同样落为 enabled: false——
 *   "配置了但加载失败"与"未配置"同语义（禁用态下不得存在任何可签发、可验证的密钥）。
 */

import {
  resolveAdminConfig,
  loadAdminKeybook,
  type AdminConfig,
  type LoadedAdminKeybook,
  type LoadAdminKeybookOptions,
} from "./admin";

/** 管理后台运行时（守卫与登录端点的唯一消费入口） */
export interface AdminRuntime {
  /** 是否启用（密码本未配置或加载失败时为 false） */
  enabled: boolean;
  /** 管理后台路径前缀 */
  path: string;
  /** 会话有效期（秒） */
  sessionMaxAgeSeconds: number;
  /** 密码本来源（诊断展示用；URL 形态由消费方自行决定是否可输出） */
  source: string | null;
  /** 密码本指纹（会话/challenge secret 派生种子；禁用态为 null） */
  fingerprint: string | null;
  /** 已加载密码本（禁用态为 null） */
  keybook: LoadedAdminKeybook | null;
  /** 加载失败原因（仅诊断；成功或未配置为 null） */
  loadError: string | null;
}

/** globalThis 上的运行时缓存键名（跨模块实例共享） */
const ADMIN_RUNTIME_GLOBAL_KEY = "__yunzoneServiceKitAdminRuntime";

/** 缓存槽（promise 级缓存：并发首次调用只加载一次；settled 供同步取用） */
interface AdminRuntimeSlot {
  promise: Promise<AdminRuntime> | null;
  settled: AdminRuntime | null;
}

function runtimeSlot(): AdminRuntimeSlot {
  const store = globalThis as Record<string, unknown>;
  let slot = store[ADMIN_RUNTIME_GLOBAL_KEY] as AdminRuntimeSlot | undefined;
  if (!slot) {
    slot = { promise: null, settled: null };
    store[ADMIN_RUNTIME_GLOBAL_KEY] = slot;
  }
  return slot;
}

/** initAdminRuntime 选项 */
export interface InitAdminRuntimeOptions {
  /** 环境变量来源（默认 process.env，可注入用于测试） */
  env?: Record<string, string | undefined>;
  /** 密码本加载选项透传（fetchImpl / readFileImpl / timeoutMs） */
  load?: LoadAdminKeybookOptions;
  /**
   * 强制重新加载（默认命中缓存直接返回）。仅测试/显式运维刷新使用——
   * 生产语义下换本的生效方式是重启进程。
   */
  force?: boolean;
}

/**
 * 初始化（或获取已缓存的）管理后台运行时。
 *
 * 各服务在启动流程调用一次即可（守卫内部也经此取数，惰性自举）；
 * 永不抛错——加载失败落为禁用态并 console.warn。
 */
export async function initAdminRuntime(
  options: InitAdminRuntimeOptions = {}
): Promise<AdminRuntime> {
  const slot = runtimeSlot();
  if (slot.promise && !options.force) {
    return slot.promise;
  }
  const promise = buildAdminRuntime(options).then((runtime) => {
    // force 重载时旧 promise 的 settle 不得覆盖新槽位——以当前 promise 为锚
    if (runtimeSlot().promise === promise) {
      runtimeSlot().settled = runtime;
    }
    return runtime;
  });
  slot.promise = promise;
  slot.settled = null;
  return promise;
}

/** 实际装配（失败 → 禁用态） */
async function buildAdminRuntime(
  options: InitAdminRuntimeOptions
): Promise<AdminRuntime> {
  const config: AdminConfig = resolveAdminConfig(options.env);

  const base: AdminRuntime = {
    enabled: false,
    path: config.path,
    sessionMaxAgeSeconds: config.sessionMaxAgeSeconds,
    source: config.keybookSource,
    fingerprint: null,
    keybook: null,
    loadError: null,
  };

  if (!config.enabled || config.keybookSource === null) {
    return base; // 未配置 = 显式禁用
  }

  try {
    const keybook = await loadAdminKeybook(config.keybookSource, options.load);
    return {
      ...base,
      enabled: true,
      fingerprint: keybook.fingerprint,
      keybook,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // URL 形态的来源可能含访问凭据，依赖 loadAdminKeybook 内部脱敏；此处透传其消息
    console.warn(
      `[service-kit/ops] initAdminRuntime: 密码本加载失败，管理后台按禁用处理（换本或修复来源后重启生效）: ${message}`
    );
    return { ...base, loadError: message };
  }
}

/** 同步读取已缓存运行时（初始化尚未 settle 时返回 null；供不宜 await 的诊断场景） */
export function getAdminRuntimeCached(): AdminRuntime | null {
  return runtimeSlot().settled;
}

/** 测试专用：清空运行时缓存（同进程重复用例时保证隔离） */
export function resetAdminRuntimeForTest(): void {
  const slot = runtimeSlot();
  slot.promise = null;
  slot.settled = null;
}
