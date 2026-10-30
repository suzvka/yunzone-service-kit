/**
 * 离线 SQL 引擎 — SqlDb 契约在内存引擎上的实现
 *
 * 语义对齐点（与 PgSqlDb 逐条一致，偏差均有注释）：
 * - query 返回行数组、execute 返回受影响行数
 * - withTransaction 真事务（BEGIN/COMMIT/ROLLBACK），禁止嵌套
 * - 错误归一化与 PgSqlDb 共用 normalizeDbError（23505 → UniqueViolationError）
 * - getPool() 提供 omni-auth 所需的结构化 PoolLike（query / connect / release）
 *
 * 与真 PG 的必然差异（引擎为单连接，故本层负责串行化）：
 * - 全部语句 FIFO 串行执行；withTransaction 与 connect() 持有独占权，
 *   期间其它语句排队而不是与事务交错（真 PG 靠多连接天然隔离）
 * - 不落盘、无并发隔离级别、只有 public schema
 */

import { normalizeDbError, StorageError } from "../errors";
import type { SqlDb } from "../types";
import type { OfflineDriver, OfflineQueryResult } from "./driver";

/** omni-auth 声明的最小池形状（结构化类型，与本层一致） */
export interface OfflinePgClient {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
  release(err?: Error | boolean): void;
}

export interface OfflinePgPool {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
  connect(): Promise<OfflinePgClient>;
}

/** 事务语句识别（仅用于连接释放时的兜底回滚，不做 SQL 解析） */
const BEGIN_PATTERN = /^\s*(BEGIN|START\s+TRANSACTION)/i;
const END_PATTERN = /^\s*(COMMIT|ROLLBACK|END)/i;

export class OfflineEngine implements SqlDb {
  private tail: Promise<unknown> = Promise.resolve();
  private txDepth = 0;
  private closed = false;

  constructor(private readonly driver: OfflineDriver) {}

  /** 独占执行（FIFO 串行；前序失败不影响后续） */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /** 单次执行原语：只做错误归一化，不做串行化（由调用方决定是否已独占） */
  private async raw<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<OfflineQueryResult<T>> {
    try {
      return await this.driver.query<T>(sql, params);
    } catch (err) {
      throw normalizeDbError(err);
    }
  }

  private static affected(result: OfflineQueryResult): number {
    return result.affectedRows ?? result.rowCount ?? 0;
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.exclusive(async () => (await this.raw<T>(sql, params)).rows);
  }

  execute(sql: string, params?: unknown[]): Promise<number> {
    return this.exclusive(async () => OfflineEngine.affected(await this.raw(sql, params)));
  }

  withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      if (this.txDepth > 0) {
        throw new StorageError(
          "[db/offline] 禁止嵌套 withTransaction（与 PgSqlDb 契约一致）",
          { code: "TRANSACTION_NESTED" }
        );
      }
      this.txDepth += 1;
      await this.raw("BEGIN");
      try {
        const result = await fn(this.transactionScope());
        await this.raw("COMMIT");
        return result;
      } catch (err) {
        try {
          await this.raw("ROLLBACK");
        } catch {
          // 连接已失效时不掩盖原始异常
        }
        throw err;
      } finally {
        this.txDepth -= 1;
      }
    });
  }

  /** 事务内执行器：外层已独占，不再抢串行锁（否则自锁死） */
  private transactionScope(): SqlDb {
    return {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
        (await this.raw<T>(sql, params)).rows,
      execute: async (sql: string, params?: unknown[]) =>
        OfflineEngine.affected(await this.raw(sql, params)),
      withTransaction: async () => {
        throw new StorageError(
          "[db/offline] 禁止嵌套 withTransaction（与 PgSqlDb 契约一致）",
          { code: "TRANSACTION_NESTED" }
        );
      },
    };
  }

  /** 结构化 PoolLike：omni-auth（及其它宿主库）经此注入连接 */
  getPool(): OfflinePgPool {
    return {
      query: (text, values) =>
        this.exclusive(async () => {
          const result = await this.raw(text, values);
          return { rows: result.rows, rowCount: result.affectedRows ?? result.rowCount ?? null };
        }),
      connect: () => this.acquire(),
    };
  }

  /**
   * 独占连接（omni-auth 的事务形态：connect → BEGIN → … → COMMIT → release）
   *
   * 手工把自身挂到串行链尾，直到 release 才放行下一个执行者——
   * 等价于从池里借走唯一一条连接。
   */
  private async acquire(): Promise<OfflinePgClient> {
    const previous = this.tail;
    let releaseHold!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    this.tail = previous.then(
      () => hold,
      () => hold
    );
    await previous.then(
      () => undefined,
      () => undefined
    );

    let released = false;
    let txOpen = false;
    return {
      query: async (text, values) => {
        if (BEGIN_PATTERN.test(text)) txOpen = true;
        const result = await this.raw(text, values);
        if (END_PATTERN.test(text)) txOpen = false;
        return { rows: result.rows, rowCount: result.affectedRows ?? result.rowCount ?? null };
      },
      release: () => {
        if (released) return;
        released = true;
        // 宿主忘记收尾时兜底回滚，避免单连接被悬挂事务毒化
        const cleanup = txOpen ? this.raw("ROLLBACK").catch(() => undefined) : Promise.resolve();
        void cleanup.then(releaseHold, releaseHold);
      },
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.exclusive(() => this.driver.close());
  }
}
