/**
 * 离线 SQL 驱动边界（可选依赖的唯一边界）
 *
 * kit 不静态依赖任何内存 SQL 引擎：驱动经本接口注入，默认实现为 PGlite
 * （WASM 版 PostgreSQL，方言与真 PG 一致）。
 *
 * 边界职责只有三件事：
 * - 把引擎的返回形状收敛为 { rows, affectedRows?, rowCount? }
 * - 把"未安装可选依赖"变成可诊断的 StorageConfigError（而非 ERR_MODULE_NOT_FOUND）
 * - 不在此层做事务/串行化/错误归一化——那是 engine.ts 的职责
 *
 * 生产路径永不触达本文件：只有 registerOfflineChannel() 被调用时才加载驱动。
 */

import { StorageConfigError } from "../errors";

/** 单次执行结果（各引擎形状的最大公约数） */
export interface OfflineQueryResult<T = Record<string, unknown>> {
  rows: T[];
  /** INSERT/UPDATE/DELETE/DDL 的受影响行数（PGlite 提供） */
  affectedRows?: number;
  /** node-postgres 风格的受影响行数（兜底） */
  rowCount?: number;
}

/** 离线驱动契约：只要求一个参数化 query 与 close */
export interface OfflineDriver {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<OfflineQueryResult<T>>;
  close(): Promise<void>;
}

/** 驱动工厂（可替换：换成 pg-mem 或其它引擎只需实现本接口） */
export interface OfflineDriverFactory {
  open(): Promise<OfflineDriver>;
}

/** PGlite 包内实际被使用的最小面（不引用其类型，避免可选依赖影响 d.ts） */
interface PgliteLike {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; affectedRows?: number; rowCount?: number }>;
  waitReady?: Promise<void>;
  close(): Promise<void>;
}

/**
 * 默认驱动：PGlite（内存模式，不落盘、进程结束即消失）
 *
 * @throws StorageConfigError 未安装 @electric-sql/pglite 时抛出（带安装指引）
 */
export const pgliteDriver: OfflineDriverFactory = {
  async open(): Promise<OfflineDriver> {
    let mod: unknown;
    try {
      mod = await import("@electric-sql/pglite");
    } catch (cause) {
      throw new StorageConfigError(
        "[db/offline] 未安装可选依赖 @electric-sql/pglite。" +
          "离线测试需将其加入宿主项目的 devDependencies：pnpm add -D @electric-sql/pglite",
        { cause }
      );
    }
    const Ctor = (mod as { PGlite?: new () => PgliteLike }).PGlite;
    if (typeof Ctor !== "function") {
      throw new StorageConfigError(
        "[db/offline] @electric-sql/pglite 未导出 PGlite 构造器（版本不匹配？）"
      );
    }
    const db = new Ctor();
    // 查询会自行排队到引擎就绪，waitReady 仅用于尽早暴露初始化失败
    await db.waitReady?.catch((cause: unknown) => {
      throw new StorageConfigError("[db/offline] PGlite 初始化失败", { cause });
    });
    return {
      query: (sql, params) => db.query(sql, params),
      close: () => db.close(),
    };
  },
};
