/**
 * db 模块 — 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  MemoryDbAdapter,
  MemoryKeyValueStore,
  StorageConfigError,
  TransactionalMemoryDbAdapter,
  createDbAdapter,
  createKeyValueStore,
  isTransactional,
  resolveStorageBackend,
} from "../src/db";
import type { DbAdapter, Json } from "../src/db";

describe("resolveStorageBackend", () => {
  it("STORAGE_BACKEND 直读（唯一真理）", () => {
    expect(resolveStorageBackend({ STORAGE_BACKEND: "postgres" })).toBe("postgres");
    expect(resolveStorageBackend({ STORAGE_BACKEND: "file" })).toBe("file");
    expect(resolveStorageBackend({ STORAGE_BACKEND: "txt" })).toBe("txt");
    expect(resolveStorageBackend({ STORAGE_BACKEND: "memory" })).toBe("memory");
  });

  it("DATABASE_PROVIDER=postgres / coze 均映射到 postgres", () => {
    expect(resolveStorageBackend({ DATABASE_PROVIDER: "postgres" })).toBe("postgres");
    // coze 是 pg 连接的构建方式，不是独立 backend
    expect(resolveStorageBackend({ DATABASE_PROVIDER: "coze" })).toBe("postgres");
  });

  it("STORAGE_MODE / CONFIG_STORE 映射 db → postgres、file → file", () => {
    expect(resolveStorageBackend({ STORAGE_MODE: "db" })).toBe("postgres");
    expect(resolveStorageBackend({ STORAGE_MODE: "file" })).toBe("file");
    expect(resolveStorageBackend({ CONFIG_STORE: "db" })).toBe("postgres");
    expect(resolveStorageBackend({ CONFIG_STORE: "file" })).toBe("file");
  });

  it("STORAGE_BACKEND 优先于旧变量别名", () => {
    expect(
      resolveStorageBackend({ STORAGE_BACKEND: "memory", DATABASE_PROVIDER: "postgres" })
    ).toBe("memory");
  });

  it("均未设置时抛 StorageConfigError（禁止自动检测或隐式默认）", () => {
    expect(() => resolveStorageBackend({})).toThrowError(StorageConfigError);
    expect(() => resolveStorageBackend({})).toThrowError(/STORAGE_BACKEND 未设置/);
  });

  it("非法值抛 StorageConfigError 并列出支持项", () => {
    expect(() => resolveStorageBackend({ STORAGE_BACKEND: "mysql" })).toThrowError(
      /STORAGE_BACKEND 非法: "mysql".*支持: postgres, file, txt, memory/
    );
    expect(() => resolveStorageBackend({ DATABASE_PROVIDER: "sqlite" })).toThrowError(
      /无法映射到 StorageBackend/
    );
  });
});

describe("MemoryDbAdapter", () => {
  function seed(adapter: DbAdapter): Promise<void> {
    const rows: Array<{ model: string; data: Record<string, Json> }> = [
      { model: "user", data: { name: "alice", age: 30, group: "a" } },
      { model: "user", data: { name: "bob", age: 20, group: "b" } },
      { model: "user", data: { name: "carol", age: 40, group: "a" } },
    ];
    return Promise.all(rows.map((r) => adapter.create(r))).then(() => undefined);
  }

  it("create 自动生成 id，也可使用传入的 id", async () => {
    const adapter = new MemoryDbAdapter();
    const row = await adapter.create({ model: "user", data: { name: "alice" } });
    expect(row.id).toBe("1");
    const custom = await adapter.create({
      model: "user",
      data: { id: "u-100", name: "dan" },
    });
    expect(custom.id).toBe("u-100");
  });

  it("findOne 按 eq 命中 / 未命中", async () => {
    const adapter = new MemoryDbAdapter();
    await seed(adapter);
    const found = await adapter.findOne({
      model: "user",
      where: [{ field: "name", value: "bob" }],
    });
    expect(found?.age).toBe(20);
    const missing = await adapter.findOne({
      model: "user",
      where: [{ field: "name", value: "nobody" }],
    });
    expect(missing).toBeNull();
  });

  it("findMany 支持 where 组合 / 排序 / 分页", async () => {
    const adapter = new MemoryDbAdapter();
    await seed(adapter);

    const groupA = await adapter.findMany({
      model: "user",
      where: [{ field: "group", value: "a" }],
      orderBy: { field: "age", direction: "asc" },
    });
    expect(groupA.map((r) => r.name)).toEqual(["alice", "carol"]);

    const paged = await adapter.findMany({
      model: "user",
      orderBy: { field: "age", direction: "desc" },
      limit: 2,
      offset: 1,
    });
    expect(paged.map((r) => r.name)).toEqual(["alice", "bob"]);
  });

  it("count / updateMany / deleteMany 语义正确", async () => {
    const adapter = new MemoryDbAdapter();
    await seed(adapter);

    expect(await adapter.count({ model: "user" })).toBe(3);
    expect(await adapter.count({ model: "user", where: [{ field: "group", value: "a" }] })).toBe(2);

    const updated = await adapter.updateMany({
      model: "user",
      where: [{ field: "group", value: "a" }],
      update: { group: "x" },
    });
    expect(updated).toBe(2);
    expect(await adapter.count({ model: "user", where: [{ field: "group", value: "x" }] })).toBe(2);

    const deleted = await adapter.deleteMany({
      model: "user",
      where: [{ field: "group", value: "b" }],
    });
    expect(deleted).toBe(1);
    expect(await adapter.count({ model: "user" })).toBe(2);
  });

  it("fieldMode 声明为 camel_case，生命周期钩子可调用", async () => {
    const adapter = new MemoryDbAdapter();
    expect(adapter.fieldMode).toBe("camel_case");
    await adapter.init();
    await adapter.disconnect();
  });
});

describe("TransactionalMemoryDbAdapter", () => {
  it("transaction 正常返回即提交", async () => {
    const adapter = new TransactionalMemoryDbAdapter();
    await adapter.transaction(async (tx) => {
      await tx.create({ model: "user", data: { name: "alice" } });
    });
    expect(await adapter.count({ model: "user" })).toBe(1);
  });

  it("transaction 抛错即回滚（快照恢复），无残留写入", async () => {
    const adapter = new TransactionalMemoryDbAdapter();
    await adapter.create({ model: "user", data: { name: "keep" } });

    await expect(
      adapter.transaction(async (tx) => {
        await tx.create({ model: "user", data: { name: "temp-1" } });
        await tx.updateMany({
          model: "user",
          where: [{ field: "name", value: "keep" }],
          update: { name: "mutated" },
        });
        await tx.create({ model: "user", data: { name: "temp-2" } });
        throw new Error("boom");
      })
    ).rejects.toThrowError("boom");

    const rows = await adapter.findMany({ model: "user" });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("keep");
  });

  it("isTransactional 正确收窄两种接口", () => {
    const t = new TransactionalMemoryDbAdapter();
    const plain = new MemoryDbAdapter();
    expect(isTransactional(t)).toBe(true);
    expect(isTransactional(plain)).toBe(false);
  });
});

describe("MemoryKeyValueStore", () => {
  it("get / set / delete / list(prefix) 全链路", async () => {
    const store = new MemoryKeyValueStore();
    expect(await store.get("a")).toBeNull();

    await store.set("station:openai:key", "v1");
    await store.set("station:deepseek:key", "v2");
    await store.set("other:key", "v3");
    expect(await store.get("station:openai:key")).toBe("v1");

    const stationKeys = await store.list("station:");
    expect(stationKeys).toEqual([
      { key: "station:deepseek:key", value: "v2" },
      { key: "station:openai:key", value: "v1" },
    ]);

    await store.delete("station:openai:key");
    expect(await store.get("station:openai:key")).toBeNull();
    expect((await store.list("station:")).map((e) => e.key)).toEqual(["station:deepseek:key"]);
  });
});

describe("工厂", () => {
  it("createDbAdapter({ backend: 'memory' }) 返回事务实现", () => {
    const adapter = createDbAdapter({ backend: "memory" });
    expect(isTransactional(adapter)).toBe(true);
  });

  it("createDbAdapter 对非 memory backend 抛 StorageConfigError（适配器在消费侧）", () => {
    for (const backend of ["postgres", "file", "txt"] as const) {
      expect(() => createDbAdapter({ backend })).toThrowError(
        /适配器由消费侧提供，本阶段仅 "memory" 可实例化/
      );
    }
  });

  it("createKeyValueStore 同样仅 memory 可实例化", async () => {
    const store = createKeyValueStore({ backend: "memory" });
    await store.set("k", "v");
    expect(await store.get("k")).toBe("v");

    expect(() => createKeyValueStore({ backend: "file" })).toThrowError(StorageConfigError);
  });
});