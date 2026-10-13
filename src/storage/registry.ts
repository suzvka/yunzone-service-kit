/**
 * 存储渠道开放注册表（2026-10-13 开放化改造）
 *
 * kit 定位是集群辅助设施、不得约束业务（开发公约）：官方渠道（s3 / coze）之外，业务
 * 可为自有后端注册新渠道（如本地内存方案、厂商专有 SDK），经同一 resolveStorageChannel /
 * createObjectStore 分派路径生效——业务侧零分支、零旁路，渠道选择决策统一收口在 kit
 * 抽象层（此前封闭 switch 迫使业务在 kit 之外重抄渠道分支，违背辅助定位，已废弃）。
 *
 * 注册语义：
 * - 同名重复注册 = 覆盖（组合根责任自负；listRegisteredStorageChannels 提供诊断面）；
 * - 内置渠道名（s3 / coze / none）禁止注册——官方适配器语义与 none 哨兵不被业务置换；
 * - 工厂接收调用时的环境快照 { env }（默认 process.env），凭证获取方式由渠道自管；
 *   内置渠道的凭证解析（resolveStorageConfig）仍归 /config 统一诊断。
 */

import { ObjectStoreConfigError } from "./errors";
import type { ObjectStore } from "./types";

/** 环境快照形状（与解析面 / config 模块一致） */
export type StorageEnv = Record<string, string | undefined>;

/** 渠道工厂：按环境快照创建该渠道的 ObjectStore 实现 */
export type StorageChannelFactory = (options: { env: StorageEnv }) => ObjectStore;

const registry = new Map<string, StorageChannelFactory>();

/** 内置渠道名（官方适配器语义不可被业务置换；none 为显式无存储哨兵值） */
export const BUILTIN_STORAGE_CHANNELS: readonly string[] = ["s3", "coze", "none"];

/**
 * 注册自定义存储渠道（同名覆盖）
 *
 * @throws ObjectStoreConfigError 渠道名为内置渠道（s3 / coze / none）时抛出
 */
export function registerStorageChannel(
  channel: string,
  factory: StorageChannelFactory
): void {
  if (BUILTIN_STORAGE_CHANNELS.includes(channel)) {
    throw new ObjectStoreConfigError(
      `[storage/registry] "${channel}" 为内置渠道（官方适配器语义），不可注册覆盖。`
    );
  }
  registry.set(channel, factory);
}

/** 注销自定义渠道（测试隔离用）；内置渠道不可注销（返回 false） */
export function unregisterStorageChannel(channel: string): boolean {
  if (BUILTIN_STORAGE_CHANNELS.includes(channel)) return false;
  return registry.delete(channel);
}

/** 渠道是否可解析（内置 ∪ 已注册） */
export function isKnownStorageChannel(channel: string): boolean {
  return BUILTIN_STORAGE_CHANNELS.includes(channel) || registry.has(channel);
}

/** 取自定义渠道工厂（未注册返回 undefined；内置渠道不经此表） */
export function getStorageChannelFactory(
  channel: string
): StorageChannelFactory | undefined {
  return registry.get(channel);
}

/** 已注册的自定义渠道名（诊断面；不含内置） */
export function listRegisteredStorageChannels(): string[] {
  return [...registry.keys()];
}
