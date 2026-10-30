/**
 * yunzone-service-kit/db/offline — 离线 SQL 渠道（内存 PostgreSQL）
 *
 * 定位：`/db` 契约的第四个官方渠道（postgres / coze / none 之外），
 * 经同一 registerDatabaseChannel → createSqlDb 分派路径生效——
 * 业务侧零分支、零旁路，与 kit 注册表的既定设计一致。
 *
 * 依赖边界：本入口**不**静态依赖任何内存引擎。PGlite 是可选 peer，
 * 仅在 registerOfflineChannel() 被调用后按需动态加载；生产构建与生产安装都不触达。
 *
 * 单例语义：同一进程内任意次数 createSqlDb({ channel: "offline" }) 返回同一实例、
 * 同一个库（这是与真 PG 对齐的必要条件：多模块、多单例必须看见同一份数据）。
 *
 * 生命周期由组合根调度：测试收尾调 disposeOfflineDb()，用例之间调 resetOfflineDb()。
 */

import { StorageConfigError } from "../errors";
import { registerDatabaseChannel } from "../registry";
import type { SqlDb } from "../types";
import { pgliteDriver } from "./driver";
import type { OfflineDriverFactory } from "./driver";
import { OfflineEngine } from "./engine";
import type { OfflinePgPool } from "./engine";

/** 契约版本：语义条款变更时递增（宿主据此判断是否需要重跑探针） */
export const OFFLINE_DB_CONTRACT_VERSION = "1";

/** 渠道名（DATABASE_PROVIDER 取值） */
export const OFFLINE_DB_CHANNEL = "offline";

/** 注册选项 */
export interface OfflineDbOptions {
  /** 驱动工厂（默认 PGlite；替换引擎时实现 OfflineDriverFactory 即可） */
  driver?: OfflineDriverFactory;
}

/** 模块级状态：单引擎、单工厂、单实例 */
let driverFactory: OfflineDriverFactory = pgliteDriver;
let enginePromise: Promise<OfflineEngine> | null = null;
let registered = false;

async function engine(): Promise<OfflineEngine> {
  enginePromise ??= driverFactory.open().then((driver) => new OfflineEngine(driver));
  return enginePromise;
}

/**
 * 离线 SqlDb 实例（惰性：未首次使用前不加载 WASM）
 *
 * 身份稳定：模块加载即创建，跨 createSqlDb 调用共享，
 * 因此多个领域单例拿到的是同一个库。
 */
const offlineDb: SqlDb & { getPool(): OfflinePgPool } = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
    engine().then((db) => db.query<T>(sql, params)),
  execute: (sql: string, params?: unknown[]) => engine().then((db) => db.execute(sql, params)),
  withTransaction: <T>(fn: (db: SqlDb) => Promise<T>) =>
    engine().then((db) => db.withTransaction(fn)),
  getPool: (): OfflinePgPool => {
    const lazyQuery: OfflinePgPool["query"] = async (text, values) => {
      const db = await engine();
      return db.getPool().query(text, values);
    };
    return {
      query: lazyQuery,
      connect: async () => (await engine()).getPool().connect(),
    };
  },
};

/**
 * 注册离线渠道（幂等）
 *
 * 调用后 `DATABASE_PROVIDER=offline` 即经 resolveDatabaseChannel 合法解析，
 * 现有代码里的 createSqlDb({ channel: resolveDatabaseChannel() }) 自动落到本引擎。
 *
 * 典型接线（测试 setup 或 instrumentation，一处即可）：
 * ```ts
 * registerOfflineChannel();
 * process.env.DATABASE_PROVIDER = "offline";
 * ```
 *
 * @throws StorageConfigError 驱动工厂非法时抛出
 */
export function registerOfflineChannel(options: OfflineDbOptions = {}): void {
  if (options.driver) driverFactory = options.driver;
  registerDatabaseChannel(OFFLINE_DB_CHANNEL, () => offlineDb);
  registered = true;
}

/** 取离线 SqlDb 实例（不依赖注册表；需要显式注入时使用） */
export function getOfflineDb(): SqlDb & { getPool(): OfflinePgPool } {
  return offlineDb;
}

/** 渠道是否已注册（配置自检用） */
export function isOfflineChannelRegistered(): boolean {
  return registered;
}

/** 引擎是否已实际打开（"我真的在跑内存库"的运行时证据） */
export function isOfflineDbActive(): boolean {
  return enginePromise !== null;
}

/**
 * 清空数据（用例之间）
 *
 * 丢弃并关闭底层引擎，下次使用时以全新内存库重建：
 * 实例身份不变，库内容归零。未初始化时为空操作。
 */
export async function resetOfflineDb(): Promise<void> {
  const pending = enginePromise;
  enginePromise = null;
  if (!pending) return;
  try {
    await (await pending).close();
  } catch {
    // 关闭失败不阻塞下一次使用（旧实例已不可达）
  }
}

/** 释放资源（测试进程 / 组合根收尾）；与 reset 的区别：不保证可再次使用（可，但会重建） */
export async function disposeOfflineDb(): Promise<void> {
  await resetOfflineDb();
}

export { pgliteDriver } from "./driver";
export type { OfflineDriver, OfflineDriverFactory, OfflineQueryResult } from "./driver";
export { OfflineEngine } from "./engine";
export type { OfflinePgClient, OfflinePgPool } from "./engine";
