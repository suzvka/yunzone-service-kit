/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-10-13 */
/**
 * db 渠道开放注册表 — 单元测试（2026-10-13 开放化改造，与 /storage 注册表同构）
 * 业务注册自定义渠道经同一 resolveDatabaseChannel / createSqlDb 分派；内置渠道不可置换。
 */

import { describe, expect, it } from "vitest";
import {
  StorageConfigError,
  createSqlDb,
  isKnownDatabaseChannel,
  registerDatabaseChannel,
  resolveDatabaseChannel,
  unregisterDatabaseChannel,
} from "../src/db";
import type { SqlDb } from "../src/db";

/** 最小契约桩（仅覆盖分派面；事务强承诺语义由官方 PgSqlDb 及其专项测试保证） */
class StubSqlDb implements SqlDb {
  readonly envSeen: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) {
    this.envSeen = env;
  }
  async query<T = Record<string, unknown>>(
    _sql: string,
    _params?: unknown[]
  ): Promise<T[]> {
    return [];
  }
  async execute(_sql: string, _params?: unknown[]): Promise<number> {
    return 0;
  }
  async withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe("registerDatabaseChannel（开放注册）", () => {
  it("注册后 resolveDatabaseChannel 接受该渠道；createSqlDb 分派到注册工厂", () => {
    const db = new StubSqlDb({});
    registerDatabaseChannel("stub", () => db);
    try {
      expect(isKnownDatabaseChannel("stub")).toBe(true);
      expect(resolveDatabaseChannel({ DATABASE_PROVIDER: "stub" })).toBe("stub");
      expect(createSqlDb({ channel: "stub" })).toBe(db);
    } finally {
      unregisterDatabaseChannel("stub");
    }
  });

  it("工厂接收调用时环境快照（env 注入透传）", () => {
    let seen: Record<string, string | undefined> = {};
    registerDatabaseChannel("stub-env", ({ env }) => {
      seen = env;
      return new StubSqlDb(env);
    });
    try {
      createSqlDb({ channel: "stub-env" }, { STUB_DSN: "memory://" });
      expect(seen.STUB_DSN).toBe("memory://");
    } finally {
      unregisterDatabaseChannel("stub-env");
    }
  });

  it("同名重复注册 = 覆盖（组合根责任自负）", () => {
    const first = new StubSqlDb({});
    const second = new StubSqlDb({});
    registerDatabaseChannel("dup", () => first);
    registerDatabaseChannel("dup", () => second);
    try {
      expect(createSqlDb({ channel: "dup" })).toBe(second);
    } finally {
      unregisterDatabaseChannel("dup");
    }
  });

  it("内置渠道名（postgres/coze/none）禁止注册与注销（官方语义不可被业务置换）", () => {
    for (const builtin of ["postgres", "coze", "none"]) {
      expect(() =>
        registerDatabaseChannel(builtin, () => new StubSqlDb({}))
      ).toThrowError(StorageConfigError);
      expect(unregisterDatabaseChannel(builtin)).toBe(false);
    }
  });

  it("unregister 后渠道回到非法值域；none 仍 fail-fast（显式无库哨兵）", () => {
    registerDatabaseChannel("ghost", () => new StubSqlDb({}));
    unregisterDatabaseChannel("ghost");
    expect(() =>
      resolveDatabaseChannel({ DATABASE_PROVIDER: "ghost" })
    ).toThrowError(/DATABASE_PROVIDER 非法: "ghost"/);
    expect(() => createSqlDb({ channel: "none" })).toThrowError(StorageConfigError);
  });
});
