/**
 * 内存实现（kit 内置的唯一实现）
 *
 * 用途：
 * - 单测注入（确定性、无外部依赖）
 * - 本地开发 / 演示
 *
 * 注意：
 * - TransactionalMemoryDbAdapter 的事务为快照回滚模拟（非真原子），仅供契约测试
 * - memory 后端的数据随进程销毁，禁止用于任何持久化场景
 */

import type {
  Condition,
  DbAdapter,
  Json,
  KeyValueStore,
  OrderBy,
  TransactionalDbAdapter,
} from "./types";

/** MemoryDbAdapter 内部数据表：model → (id → row) */
type RowStore = Map<string, Record<string, Json>>;

/** 事务快照类型 */
interface MemorySnapshot {
  stores: Array<[string, Record<string, Json>[]]>;
  counters: Array<[string, number]>;
}

function compareValues(a: Json | undefined, b: Json | undefined): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const aStr = String(a);
  const bStr = String(b);
  return aStr < bStr ? -1 : 1;
}

/** 通用数据平面内存实现（CRUD 原语） */
export class MemoryDbAdapter implements DbAdapter {
  readonly fieldMode = "camel_case" as const;

  protected readonly stores = new Map<string, RowStore>();
  protected readonly counters = new Map<string, number>();

  async init(): Promise<void> {
    // 内存后端无可初始化资源
  }

  async disconnect(): Promise<void> {
    // 内存后端无可释放资源
  }

  private store(model: string): RowStore {
    let rows = this.stores.get(model);
    if (!rows) {
      rows = new Map();
      this.stores.set(model, rows);
    }
    return rows;
  }

  private nextId(model: string): string {
    const next = (this.counters.get(model) ?? 0) + 1;
    this.counters.set(model, next);
    return String(next);
  }

  private matches(row: Record<string, Json>, conditions: Condition[]): boolean {
    return conditions.every(({ field, value, operator = "eq" }) => {
      const actual = row[field];
      switch (operator) {
        case "eq":
          return actual === value;
        case "neq":
          return actual !== value;
        case "in":
          return Array.isArray(value) && value.includes(actual);
        case "lt":
          return (actual as number) < (value as number);
        case "gt":
          return (actual as number) > (value as number);
        case "lte":
          return (actual as number) <= (value as number);
        case "gte":
          return (actual as number) >= (value as number);
        default:
          return false;
      }
    });
  }

  private sortRows(rows: Record<string, Json>[], orderBy?: OrderBy): Record<string, Json>[] {
    if (!orderBy) return rows;
    const factor = orderBy.direction === "asc" ? 1 : -1;
    return [...rows].sort(
      (a, b) => factor * compareValues(a[orderBy.field], b[orderBy.field])
    );
  }

  async create(params: {
    model: string;
    data: Record<string, Json>;
  }): Promise<{ id: string } & Record<string, Json>> {
    const rows = this.store(params.model);
    const id =
      typeof params.data.id === "string" && params.data.id !== ""
        ? params.data.id
        : this.nextId(params.model);
    // 先展开 data 再覆盖 id，保证 id 必存在（索引签名不保证具体键）
    const row = { ...params.data, id } as { id: string } & Record<string, Json>;
    rows.set(id, row);
    return row;
  }

  async findOne(params: {
    model: string;
    where: Condition[];
  }): Promise<Record<string, Json> | null> {
    const rows = this.store(params.model);
    for (const row of rows.values()) {
      if (this.matches(row, params.where)) {
        return row;
      }
    }
    return null;
  }

  async findMany(params: {
    model: string;
    where?: Condition[];
    orderBy?: OrderBy;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, Json>[]> {
    const rows = this.store(params.model);
    const conditions = params.where ?? [];
    const filtered = [...rows.values()].filter((row) => this.matches(row, conditions));
    const sorted = this.sortRows(filtered, params.orderBy);
    const offset = params.offset ?? 0;
    const limited = params.limit !== undefined ? offset + params.limit : undefined;
    return sorted.slice(offset, limited);
  }

  async count(params: { model: string; where?: Condition[] }): Promise<number> {
    const rows = this.store(params.model);
    const conditions = params.where ?? [];
    let count = 0;
    for (const row of rows.values()) {
      if (this.matches(row, conditions)) count += 1;
    }
    return count;
  }

  async updateMany(params: {
    model: string;
    where: Condition[];
    update: Record<string, Json>;
  }): Promise<number> {
    const rows = this.store(params.model);
    let affected = 0;
    for (const row of rows.values()) {
      if (this.matches(row, params.where)) {
        for (const [field, value] of Object.entries(params.update)) {
          row[field] = value;
        }
        affected += 1;
      }
    }
    return affected;
  }

  async deleteMany(params: { model: string; where: Condition[] }): Promise<number> {
    const rows = this.store(params.model);
    let affected = 0;
    for (const [id, row] of [...rows.entries()]) {
      if (this.matches(row, params.where)) {
        rows.delete(id);
        affected += 1;
      }
    }
    return affected;
  }
}

/**
 * 事务强承诺面的内存实现
 *
 * 语义：fn 抛错时回滚全部写入（快照恢复）；fn 正常返回则提交。
 * 供契约测试与本地开发使用，非真原子（与 pg 语义的可比性由消费侧集成测试保证）。
 */
export class TransactionalMemoryDbAdapter
  extends MemoryDbAdapter
  implements TransactionalDbAdapter
{
  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): MemorySnapshot {
    return {
      stores: [...this.stores].map(
        ([model, rows]) =>
          [model, [...rows.values()].map((row) => structuredClone(row))] as [
            string,
            Record<string, Json>[],
          ]
      ),
      counters: [...this.counters],
    };
  }

  private restore(snapshot: MemorySnapshot): void {
    this.stores.clear();
    for (const [model, rowList] of snapshot.stores) {
      const rows = new Map<string, Record<string, Json>>();
      for (const row of rowList) {
        rows.set(String(row.id), row);
      }
      this.stores.set(model, rows);
    }
    this.counters.clear();
    for (const [model, count] of snapshot.counters) {
      this.counters.set(model, count);
    }
  }
}

/** 键值原语的内存实现 */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly data = new Map<string, string>();

  async init(): Promise<void> {
    // 无资源
  }

  async disconnect(): Promise<void> {
    // 无资源
  }

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(prefix: string): Promise<Array<{ key: string; value: string }>> {
    return [...this.data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value }));
  }
}