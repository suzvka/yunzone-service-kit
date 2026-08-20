/**
 * db 模块 — 单元测试（SqlDb 契约）
 */

import { describe, expect, it } from "vitest";
import {
  PgSqlDb,
  StorageConfigError,
  StorageError,
  UniqueViolationError,
  createSqlDb,
  resolveDatabaseChannel,
} from "../src/db";
import type { SqlDb } from "../src/db";

/**
 * 契约测试桩：验证抽象本身的行为（接口形状、参数传递、事务提交/回滚语义）。
 * 不解析 SQL 语义——真实 SQL 语义由渠道适配器保证（延后提供）。
 */
class StubSqlDb implements SqlDb {
  calls: Array<{ kind: "query" | "execute"; sql: string; params?: unknown[] }> = [];
  rows: Array<Record<string, unknown>> = [];
  affected = 0;
  initCalled = false;
  disconnectCalled = false;
  private state = new Map<string, string>();

  // ─── 测试辅助：直接读写状态（模拟写操作效果，绕过 SQL 解析）───
  _write(key: string, value: string): void {
    this.state.set(key, value);
  }
  _read(key: string): string | undefined {
    return this.state.get(key);
  }

  // ─── SqlDb 实现 ────────────────────────────────────────────────
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    this.calls.push({ kind: "query", sql, params });
    return this.rows as T[];
  }

  async execute(sql: string, params?: unknown[]): Promise<number> {
    this.calls.push({ kind: "execute", sql, params });
    return this.affected;
  }

  async withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.state);
    try {
      return await fn(this);
    } catch (err) {
      this.state = snapshot;
      throw err;
    }
  }

  async init(): Promise<void> {
    this.initCalled = true;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
  }
}

describe("resolveDatabaseChannel", () => {
  it("DATABASE_PROVIDER 直读两渠道", () => {
    expect(resolveDatabaseChannel({ DATABASE_PROVIDER: "postgres" })).toBe("postgres");
    expect(resolveDatabaseChannel({ DATABASE_PROVIDER: "coze" })).toBe("coze");
  });

  it("未设置时默认 postgres（与 resolveDatabaseUrl 一致，不自动嗅探）", () => {
    expect(resolveDatabaseChannel({})).toBe("postgres");
    expect(resolveDatabaseChannel({ DATABASE_PROVIDER: "" })).toBe("postgres");
  });

  it("非法值抛 StorageConfigError 并列出支持项", () => {
    expect(() => resolveDatabaseChannel({ DATABASE_PROVIDER: "mysql" })).toThrowError(
      StorageConfigError
    );
    expect(() => resolveDatabaseChannel({ DATABASE_PROVIDER: "mysql" })).toThrowError(
      /DATABASE_PROVIDER 非法: "mysql".*支持: postgres, coze/
    );
  });
});

describe("SqlDb 契约形状", () => {
  it("query 返回注入的行数组，SQL 与参数原样传递", async () => {
    const stub = new StubSqlDb();
    stub.rows = [{ id: 1, name: "alice" }];

    const rows = await stub.query<{ id: number; name: string }>(
      "SELECT id, name FROM users WHERE id = $1",
      [1]
    );
    expect(rows).toEqual([{ id: 1, name: "alice" }]);
    expect(stub.calls).toEqual([
      { kind: "query", sql: "SELECT id, name FROM users WHERE id = $1", params: [1] },
    ]);
  });

  it("execute 返回影响行数，无参数时 params 不传递", async () => {
    const stub = new StubSqlDb();
    stub.affected = 2;

    expect(await stub.execute("DELETE FROM users WHERE status = $1", ["inactive"])).toBe(2);
    expect(await stub.execute("DELETE FROM sessions")).toBe(2);

    expect(stub.calls).toEqual([
      { kind: "execute", sql: "DELETE FROM users WHERE status = $1", params: ["inactive"] },
      { kind: "execute", sql: "DELETE FROM sessions" },
    ]);
  });

  it("生命周期钩子可调用", async () => {
    const stub = new StubSqlDb();
    await stub.init();
    await stub.disconnect();
    expect(stub.initCalled).toBe(true);
    expect(stub.disconnectCalled).toBe(true);
  });
});

describe("SqlDb 事务语义（withTransaction 强承诺）", () => {
  it("回调正常返回即提交，写入保留", async () => {
    const stub = new StubSqlDb();
    await stub.withTransaction(async (db) => {
      (db as StubSqlDb)._write("keep", "1");
    });
    expect(stub._read("keep")).toBe("1");
  });

  it("回调抛错即整体回滚，无残留写入", async () => {
    const stub = new StubSqlDb();
    stub._write("before", "origin");

    await expect(
      stub.withTransaction(async (db) => {
        (db as StubSqlDb)._write("temp", "1");
        (db as StubSqlDb)._write("before", "mutated");
        throw new Error("boom");
      })
    ).rejects.toThrowError("boom");

    expect(stub._read("temp")).toBeUndefined();
    expect(stub._read("before")).toBe("origin");
  });
});

describe("错误归一化约定", () => {
  it("UniqueViolationError 可被按类捕获（实现归一化唯一键冲突）", async () => {
    const stub = new StubSqlDb();
    const throwing = {
      ...stub,
      async query(_sql: string, _params?: unknown[]): Promise<never> {
        throw new UniqueViolationError("duplicate key value violates unique constraint");
      },
    };

    await expect(throwing.query("INSERT INTO users (name) VALUES ($1)", ["alice"])).rejects.toBeInstanceOf(
      UniqueViolationError
    );
    await expect(throwing.query("SELECT 1")).rejects.toBeInstanceOf(StorageError);
  });
});

describe("工厂", () => {
  it("createSqlDb 按渠道分派凭证获取并返回 PgSqlDb 实例", () => {
    const pg = createSqlDb(
      { channel: "postgres" },
      { DATABASE_URL: "postgresql://test:test@localhost/test" }
    );
    expect(pg).toBeInstanceOf(PgSqlDb);

    const coze = createSqlDb(
      { channel: "coze" },
      { PGDATABASE_URL: "postgresql://test:test@localhost/test" }
    );
    expect(coze).toBeInstanceOf(PgSqlDb);
  });

  it("凭证缺失时抛错（fail-fast，禁止自动嗅探）", () => {
    expect(() => createSqlDb({ channel: "postgres" }, {})).toThrowError(
      /DATABASE_URL is not set/
    );
    expect(() => createSqlDb({ channel: "coze" }, {})).toThrowError(
      /missing required env vars/
    );
  });
});
