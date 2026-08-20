/**
 * PgSqlDb — postgres / coze 渠道适配器（kit 官方实现）
 *
 * 实现 SqlDb 契约：
 * - query / execute 直传参数化 SQL（$1 占位）到 pg 连接池
 * - withTransaction 真事务（BEGIN / COMMIT / ROLLBACK），事务代理禁止嵌套
 * - 错误归一化：唯一约束冲突（pg 23505）→ UniqueViolationError
 *
 * 渠道差异只体现在连接凭证获取方式（postgres → DATABASE_URL；
 * coze → 平台注入 PGDATABASE_URL / PG* 变量组），本类不感知渠道差异，
 * 凭证由调用方经 resolveDatabaseUrl 解析后传入。
 */

import { Pool } from "pg";
import type { PoolClient, PoolConfig } from "pg";
import { UniqueViolationError } from "./errors";
import type { SqlDb } from "./types";

/** pg 唯一约束冲突错误码 */
const PG_UNIQUE_VIOLATION = "23505";

/** PgSqlDb 构造选项（透传给 pg Pool） */
export interface PgSqlDbOptions {
  /** SSL 配置（如 Coze/云数据库连接）；默认不启用 */
  ssl?: PoolConfig["ssl"];
  /** 连接池上限（默认 10） */
  max?: number;
  /** 空闲连接回收毫秒（默认 30000） */
  idleTimeoutMillis?: number;
}

/**
 * 连接池提供能力（宿主注入场景：如将池传给 omni-auth 等外部库）。
 *
 * SqlDb 契约保持纯净（SQL 执行器心智），本能力接口单独声明，
 * 消费者用 isPoolProvider 类型守卫探测后调用，替代对具体类的类型断言。
 */
export interface PoolProvider {
  getPool(): Pool;
}

/**
 * 类型守卫：判定给定对象是否提供连接池能力。
 *
 * 注意：事务代理（PgSqlDbTransaction）的 getPool 会抛错 fail-fast
 * （"事务代理不暴露连接池"），守卫通过不代表调用一定成功。
 */
export function isPoolProvider(db: unknown): db is SqlDb & PoolProvider {
  return (
    typeof db === "object" &&
    db !== null &&
    typeof (db as PoolProvider).getPool === "function"
  );
}

/** 错误归一化：底层 pg 错误 → kit 错误族 */
function normalizeError(err: unknown): unknown {
  if (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  ) {
    return new UniqueViolationError((err as Error).message);
  }
  return err;
}

export class PgSqlDb implements SqlDb, PoolProvider {
  protected pool: Pool | PoolClient;

  constructor(connectionString: string, options?: PgSqlDbOptions) {
    this.pool = new Pool({
      connectionString,
      max: options?.max ?? 10,
      idleTimeoutMillis: options?.idleTimeoutMillis ?? 30000,
      ...(options?.ssl ? { ssl: options.ssl } : {}),
    });
  }

  /**
   * 获取底层 pg 连接池引用（宿主注入场景：如将池传给 omni-auth 等外部库）。
   * 仅非事务实例可用；事务代理已 override 此方法抛错。
   */
  getPool(): Pool {
    // 非事务实例的 pool 恒为 Pool（见构造函数）；事务代理持有 PoolClient 并 override
    return this.pool as Pool;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const { rows } = await this.pool.query(sql, params as never[]);
      return rows as T[];
    } catch (err) {
      throw normalizeError(err);
    }
  }

  async execute(sql: string, params?: unknown[]): Promise<number> {
    try {
      const { rowCount } = await this.pool.query(sql, params as never[]);
      return rowCount ?? 0;
    } catch (err) {
      throw normalizeError(err);
    }
  }

  /**
   * 事务强承诺：回调内全部写入要么整体提交、要么整体回滚。
   *
   * 契约约束：回调内禁止调用 omni-auth 等外部库的认证/写 API——
   * 跨抽象事务互相不可见（外部库在池上另开连接），其写入会静默逃逸本事务。
   */
  async withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T> {
    const client = await (this.pool as Pool).connect();
    try {
      await client.query("BEGIN");
      const txDb = new PgSqlDbTransaction(client);
      const result = await fn(txDb);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    // 事务代理持有 PoolClient，不在此释放（由 withTransaction 的 finally 释放）
    if (this.pool instanceof Pool) {
      await this.pool.end();
    }
  }
}

/**
 * 事务代理：将执行器绑定到事务连接（PoolClient）。
 * 事务内禁止嵌套事务（fail-fast，取代静默回退）。
 */
class PgSqlDbTransaction extends PgSqlDb {
  constructor(client: PoolClient) {
    // 跳过父类的 Pool 创建，直接注入事务连接
    super("__tx__");
    this.pool = client;
  }

  override async withTransaction<T>(_fn: (db: SqlDb) => Promise<T>): Promise<T> {
    throw new Error("不支持嵌套事务");
  }

  override getPool(): Pool {
    throw new Error("事务代理不暴露连接池");
  }
}
