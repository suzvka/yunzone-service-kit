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
import { normalizeDbError } from "./errors";
import type { SqlDb } from "./types";

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
 * 事务代理不实现本接口——其连接归 withTransaction 所有，不外借。
 */
export interface PoolProvider {
  getPool(): Pool;
}

/** 类型守卫：判定给定对象是否提供连接池能力（事务代理返回 false） */
export function isPoolProvider(db: unknown): db is SqlDb & PoolProvider {
  return (
    typeof db === "object" &&
    db !== null &&
    typeof (db as PoolProvider).getPool === "function"
  );
}

/** 错误归一化：底层 pg 错误 → kit 错误族（实现见 ./errors，两套适配器共用） */
const normalizeError = normalizeDbError;

/**
 * pg 查询能力最小面（连接池与事务连接均满足）。
 * 查询/写语句原语抽为模块级函数供两者共用——事务代理因此无需继承 PgSqlDb。
 */
type PgQueryable = Pick<PoolClient, "query">;

/** 查询原语：返回行数组，pg 错误经归一化后抛出 */
async function runQuery<T>(
  runner: PgQueryable,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  try {
    const { rows } = await runner.query(sql, params as never[]);
    return rows as T[];
  } catch (err) {
    throw normalizeError(err);
  }
}

/** 写语句原语：返回受影响行数，pg 错误经归一化后抛出 */
async function runExecute(
  runner: PgQueryable,
  sql: string,
  params?: unknown[]
): Promise<number> {
  try {
    const { rowCount } = await runner.query(sql, params as never[]);
    return rowCount ?? 0;
  } catch (err) {
    throw normalizeError(err);
  }
}

export class PgSqlDb implements SqlDb, PoolProvider {
  private readonly pool: Pool;

  constructor(connectionString: string, options?: PgSqlDbOptions) {
    this.pool = new Pool({
      connectionString,
      max: options?.max ?? 10,
      idleTimeoutMillis: options?.idleTimeoutMillis ?? 30000,
      ...(options?.ssl ? { ssl: options.ssl } : {}),
    });
  }

  /** 获取底层 pg 连接池引用（宿主注入场景：如将池传给 omni-auth 等外部库） */
  getPool(): Pool {
    return this.pool;
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return runQuery<T>(this.pool, sql, params);
  }

  execute(sql: string, params?: unknown[]): Promise<number> {
    return runExecute(this.pool, sql, params);
  }

  /**
   * 事务强承诺：回调内全部写入要么整体提交、要么整体回滚。
   *
   * 契约约束：回调内禁止调用 omni-auth 等外部库的认证/写 API——
   * 跨抽象事务互相不可见（外部库在池上另开连接），其写入会静默逃逸本事务。
   */
  async withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgSqlDbTransaction(client));
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
    await this.pool.end();
  }
}

/**
 * 事务代理：把 SQL 执行绑定到 withTransaction 取出的单条连接。
 *
 * 独立实现 SqlDb 而非继承 PgSqlDb——继承会迫使 super() 先创建一个随即被覆盖
 * 丢弃的 Pool（每次事务泄漏一个池对象）。连接所有权归 withTransaction（其
 * finally 负责 release），故本类不实现 PoolProvider、不提供 disconnect；
 * 嵌套事务 fail-fast（禁止静默回退）。
 */
class PgSqlDbTransaction implements SqlDb {
  constructor(private readonly client: PoolClient) {}

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return runQuery<T>(this.client, sql, params);
  }

  execute(sql: string, params?: unknown[]): Promise<number> {
    return runExecute(this.client, sql, params);
  }

  async withTransaction<T>(_fn: (db: SqlDb) => Promise<T>): Promise<T> {
    throw new Error("不支持嵌套事务");
  }
}
