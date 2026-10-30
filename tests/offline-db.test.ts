/** test-meta: tier=integration; risk=high; owner=platform; expires=2027-03-31 */
/**
 * /db/offline — 离线渠道契约探针
 *
 * 本文件是 OFFLINE_DB_CONTRACT_VERSION=1 的**可执行契约**：
 * 下列每条 it 对应文档中的一条语义条款（编号即条款号）。
 * 宿主项目不需要复制本文件——引擎只有一份，探针跟着引擎走。
 *
 * 不覆盖业务 SQL（那是各项目自己的测试），只覆盖“替身是否可信”。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSqlDb } from "../src/db";
import { StorageError, UniqueViolationError } from "../src/db/errors";
import {
  OFFLINE_DB_CHANNEL,
  disposeOfflineDb,
  registerOfflineChannel,
  resetOfflineDb,
} from "../src/db/offline";
import type { OfflinePgPool } from "../src/db/offline";
import { unregisterDatabaseChannel } from "../src/db/registry";

/** 经渠道分派拿到执行器（业务代码的真实路径） */
function db() {
  return createSqlDb({ channel: OFFLINE_DB_CHANNEL });
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS probe (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     tag TEXT NOT NULL DEFAULT '',
     sku TEXT NOT NULL DEFAULT '',
     payload JSONB,
     expires_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS probe_slot ON probe (tag, sku)`,
];

beforeAll(() => {
  registerOfflineChannel();
});

beforeEach(async () => {
  // 只重建表，不重建引擎：引擎重建（WASM 初始化）约 1s，逐用例重建会让探针跑到 20s+
  const executor = db();
  await executor.execute(`DROP TABLE IF EXISTS probe`);
  for (const sql of DDL) await executor.execute(sql);
});

afterAll(async () => {
  await disposeOfflineDb();
  unregisterDatabaseChannel(OFFLINE_DB_CHANNEL);
});

describe("S1 单进程单库", () => {
  it("多次 createSqlDb 看到同一份数据", async () => {
    await db().execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s1"]);
    const other = createSqlDb({ channel: OFFLINE_DB_CHANNEL });
    const rows = await other.query<{ n: number }>(`SELECT count(*)::int AS n FROM probe`);
    expect(rows[0].n).toBe(1);
  });

  it("resetOfflineDb 清空数据但实例身份不变", async () => {
    const first = db();
    await resetOfflineDb();
    await first.execute(DDL[0]);
    const rows = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM probe`);
    expect(rows[0].n).toBe(0);
    expect(db()).toBe(first);
  });
});

describe("S2 参数化", () => {
  it("$n 占位符按序绑定", async () => {
    const rows = await db().query<{ a: string; b: string }>(
      `SELECT $1::text AS a, $2::text AS b`,
      ["x", "y"]
    );
    expect(rows[0]).toEqual({ a: "x", b: "y" });
  });

  it("未提供的占位符必须报错（不静默置空）", async () => {
    await expect(db().query(`SELECT $1::text AS a`)).rejects.toThrow();
  });
});

describe("S3 事务原子性", () => {
  it("回调抛错整体回滚", async () => {
    await expect(
      db().withTransaction(async (tx) => {
        await tx.execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s3"]);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const rows = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM probe`);
    expect(rows[0].n).toBe(0);
  });

  it("嵌套 withTransaction 抛错（与 PgSqlDb 契约一致）", async () => {
    await expect(
      db().withTransaction(async (tx) => tx.withTransaction(async () => undefined))
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("事务期间的其它语句排队，不读到未提交数据", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const writer = db().withTransaction(async (tx) => {
      await tx.execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s3q"]);
      await gate;
      return "done";
    });
    // 事务尚未提交时发起的读：必须排队到事务结束后才执行
    const reader = db().query<{ n: number }>(`SELECT count(*)::int AS n FROM probe`);
    release();
    await writer;
    const rows = await reader;
    expect(rows[0].n).toBe(1);
  });
});

describe("S4 唯一冲突归一化", () => {
  it("抛 UniqueViolationError（类判断）", async () => {
    await db().execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s4"]);
    await expect(
      db().execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s4"])
    ).rejects.toBeInstanceOf(UniqueViolationError);
  });
});

describe("S6 时钟统一", () => {
  it("同一事务内 now() 保持不变", async () => {
    const delta = await db().withTransaction(async (tx) => {
      const [first] = await tx.query<{ n: Date }>(`SELECT now() AS n`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const [second] = await tx.query<{ n: Date }>(`SELECT now() AS n`);
      return second.n.getTime() - first.n.getTime();
    });
    expect(delta).toBe(0);
  });
});

describe("S7 interval 算术", () => {
  it("make_interval 与 interval 字面量可用于计算与比较", async () => {
    const rows = await db().query<{ future: boolean }>(
      `SELECT now() + make_interval(secs => $1) > now() AS future`,
      [60]
    );
    expect(rows[0].future).toBe(true);
    const rows2 = await db().query<{ past: boolean }>(
      `SELECT now() - interval '1 day' < now() AS past`
    );
    expect(rows2[0].past).toBe(true);
  });
});

describe("S8 列默认值", () => {
  it("DEFAULT gen_random_uuid() 生成互不相同的 UUID", async () => {
    await db().execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s8a"]);
    await db().execute(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "s8b"]);
    const rows = await db().query<{ id: string }>(`SELECT id FROM probe`);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});

describe("S9 JSONB 往返", () => {
  it("$1::jsonb 写入后读出为对象", async () => {
    await db().execute(
      `INSERT INTO probe (tag, sku, payload) VALUES ($1, $2, $3::jsonb)`,
      ["a", "s9", JSON.stringify({ type: "client-credential", nested: { n: 1 } })]
    );
    const rows = await db().query<{ payload: { type: string; nested: { n: number } } }>(
      `SELECT payload FROM probe WHERE sku = $1`,
      ["s9"]
    );
    expect(typeof rows[0].payload).toBe("object");
    expect(rows[0].payload.type).toBe("client-credential");
    expect(rows[0].payload.nested.n).toBe(1);
  });
});

describe("S10 ON CONFLICT / RETURNING", () => {
  it("多列冲突目标 + DO UPDATE + RETURNING 返回写入后行", async () => {
    const insert = `INSERT INTO probe (tag, sku, payload) VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (tag, sku) DO UPDATE SET payload = EXCLUDED.payload RETURNING payload`;
    await db().query(insert, ["a", "s10", JSON.stringify({ v: 1 })]);
    const rows = await db().query<{ payload: { v: number } }>(
      insert,
      ["a", "s10", JSON.stringify({ v: 2 })]
    );
    expect(rows[0].payload.v).toBe(2);
  });
});

describe("S11 目录自省", () => {
  it("information_schema 反映已建表与列（omni-auth 增量补列依赖）", async () => {
    const cols = await db().query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      ["probe"]
    );
    expect(cols.map((c) => c.column_name)).toContain("payload");
    const tabs = await db().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    expect(tabs.map((t) => t.table_name)).toContain("probe");
  });
});

describe("S12 不静默", () => {
  it("语法错误必须抛出，而不是返回空结果", async () => {
    await expect(db().query(`SELEC 1`)).rejects.toThrow();
  });
});

describe("S13 返回值形状", () => {
  it("query 无命中返回空数组；execute 更新 0 行返回 0", async () => {
    const rows = await db().query(`SELECT * FROM probe WHERE sku = $1`, ["missing"]);
    expect(rows).toEqual([]);
    const affected = await db().execute(`UPDATE probe SET tag = tag WHERE sku = $1`, ["missing"]);
    expect(affected).toBe(0);
  });
});

describe("池兼容（omni-auth 形态）", () => {
  it("connect → BEGIN/COMMIT → release 后数据可见", async () => {
    const pool = (db() as unknown as { getPool(): OfflinePgPool }).getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "pool"]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const rows = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM probe WHERE sku = $1`,
      ["pool"]
    );
    expect(rows[0].n).toBe(1);
  });

  it("宿主忘记 COMMIT 就 release 时兜底回滚（不毒化共享连接）", async () => {
    const pool = (db() as unknown as { getPool(): OfflinePgPool }).getPool();
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "leak"]);
    client.release();
    const rows = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM probe WHERE sku = $1`,
      ["leak"]
    );
    expect(rows[0].n).toBe(0);
  });

  it("池 query 与 SqlDb query 共用同一份数据", async () => {
    const pool = (db() as unknown as { getPool(): OfflinePgPool }).getPool();
    await pool.query(`INSERT INTO probe (tag, sku) VALUES ($1, $2)`, ["a", "shared"]);
    const rows = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM probe WHERE sku = $1`,
      ["shared"]
    );
    expect(rows[0].n).toBe(1);
  });
});
