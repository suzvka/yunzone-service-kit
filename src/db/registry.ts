/**
 * 数据库渠道开放注册表（2026-10-13 开放化改造，与 /storage 渠道注册表同构）
 *
 * kit 定位是集群辅助设施、不得约束业务（开发公约）：官方渠道（postgres / coze）之外，
 * 业务可为自有后端注册新渠道（如测试内存库、厂商专有连接），经同一 resolveDatabaseChannel /
 * createSqlDb 分派路径生效——业务侧零分支、零旁路，渠道选择决策统一收口在 kit 抽象层
 * （此前封闭 switch 迫使业务在 kit 之外重抄渠道分支，违背辅助定位，已废弃）。
 *
 * 注册语义：
 * - 同名重复注册 = 覆盖（组合根责任自负；listRegisteredDatabaseChannels 提供诊断面）；
 * - 内置渠道名（postgres / coze / none）禁止注册——官方适配器语义与 none 哨兵不被业务置换；
 * - 工厂接收调用时的环境快照 { env }（默认 process.env），凭证获取方式由渠道自管；
 *   内置渠道的凭证解析（resolveDatabaseUrl）仍归 /config 统一诊断。
 */

import { StorageConfigError } from "./errors";
import type { SqlDb } from "./types";

/** 环境快照形状（与解析面 / config 模块一致） */
export type DatabaseEnv = Record<string, string | undefined>;

/** 渠道工厂：按环境快照创建该渠道的 SqlDb 实现 */
export type DatabaseChannelFactory = (options: { env: DatabaseEnv }) => SqlDb;

const registry = new Map<string, DatabaseChannelFactory>();

/** 内置渠道名（官方适配器语义不可被业务置换；none 为显式无库哨兵值） */
export const BUILTIN_DATABASE_CHANNELS: readonly string[] = [
  "postgres",
  "coze",
  "none",
];

/**
 * 注册自定义数据库渠道（同名覆盖）
 *
 * @throws StorageConfigError 渠道名为内置渠道（postgres / coze / none）时抛出
 */
export function registerDatabaseChannel(
  channel: string,
  factory: DatabaseChannelFactory
): void {
  if (BUILTIN_DATABASE_CHANNELS.includes(channel)) {
    throw new StorageConfigError(
      `[db/registry] "${channel}" 为内置渠道（官方适配器语义），不可注册覆盖。`
    );
  }
  registry.set(channel, factory);
}

/** 注销自定义渠道（测试隔离用）；内置渠道不可注销（返回 false） */
export function unregisterDatabaseChannel(channel: string): boolean {
  if (BUILTIN_DATABASE_CHANNELS.includes(channel)) return false;
  return registry.delete(channel);
}

/** 渠道是否可解析（内置 ∪ 已注册） */
export function isKnownDatabaseChannel(channel: string): boolean {
  return BUILTIN_DATABASE_CHANNELS.includes(channel) || registry.has(channel);
}

/** 取自定义渠道工厂（未注册返回 undefined；内置渠道不经此表） */
export function getDatabaseChannelFactory(
  channel: string
): DatabaseChannelFactory | undefined {
  return registry.get(channel);
}

/** 已注册的自定义渠道名（诊断面；不含内置） */
export function listRegisteredDatabaseChannels(): string[] {
  return [...registry.keys()];
}
