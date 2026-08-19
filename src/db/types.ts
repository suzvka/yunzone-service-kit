/**
 * 互斥后端抽象 — 核心类型定义
 *
 * 集群统一数据库抽象形状（与 registry 的"并存 Provider 模式"并列）：
 * - 互斥：一次只选一个存储后端（postgres / file / txt / memory）
 * - 显式：backend 必填声明，禁止自动嗅探与隐式默认
 * - 领域真理在接口：CRUD 字段一律 camelCase，物理列名是实现私有细节
 * - 事务诚实：一律强承诺（TransactionalDbAdapter）或一律无事务（DbAdapter）
 */

import type { LifecycleAware } from "../core";

/** 存储后端（值域统一；coze 不是 backend，只是 postgres 连接的构建方式） */
export type StorageBackend = "postgres" | "file" | "txt" | "memory";

/** 存储配置：backend 显式必填，缺失时由工厂抛 StorageConfigError */
export interface StorageConfig {
  backend: StorageBackend;
  /** backend 私有连接细节（判别联合，可选） */
  connection?: PgConnection | FileConnection | TxtConnection;
}

export interface PgConnection {
  kind: "pg";
  url: string;
}
export interface FileConnection {
  kind: "file";
  dirPath: string;
}
export interface TxtConnection {
  kind: "txt";
  dirPath: string;
}

/** 可跨 JSON 序列化的值（memory 实现可安全快照） */
export type Json = string | number | boolean | null | Record<string, unknown> | unknown[];

/** 查询条件（field 一律指领域字段名，物理列名由实现映射） */
export interface Condition {
  field: string;
  value: Json;
  operator?: "eq" | "neq" | "in" | "lt" | "gt" | "lte" | "gte";
}

/** 排序条件 */
export interface OrderBy {
  field: string;
  direction: "asc" | "desc";
}

/**
 * 通用数据平面原语（实现层共用工具；领域接口在此基础上组装业务方法）
 *
 * 生命周期钩子（init/disconnect）由组合根调度，实现不自管连接。
 */
export interface DbAdapter extends LifecycleAware {
  /** 创建单条记录，返回完整行（含生成的 id） */
  create(params: {
    model: string;
    data: Record<string, Json>;
  }): Promise<{ id: string } & Record<string, Json>>;

  /** 查询单条记录（where 为 AND 语义） */
  findOne(params: { model: string; where: Condition[] }): Promise<Record<string, Json> | null>;

  /** 查询多条记录（支持排序/分页） */
  findMany(params: {
    model: string;
    where?: Condition[];
    orderBy?: OrderBy;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, Json>[]>;

  /** 计数查询 */
  count(params: { model: string; where?: Condition[] }): Promise<number>;

  /** 批量更新，返回受影响行数 */
  updateMany(params: { model: string; where: Condition[]; update: Record<string, Json> }): Promise<number>;

  /** 批量删除，返回受影响行数 */
  deleteMany(params: { model: string; where: Condition[] }): Promise<number>;

  /** 物理列样式声明（诊断/工具用，不影响调用方） */
  readonly fieldMode: "snake_case" | "camel_case";
}

/** 事务强承诺面：存在 transaction 即保证原子性（非 PG 后端不实现此接口） */
export interface TransactionalDbAdapter extends DbAdapter {
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

/** 键值原语：与 DbAdapter 并列的第三种原语面（KV 语义不可用 CRUD 表达，不强行合并） */
export interface KeyValueStore extends LifecycleAware {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<Array<{ key: string; value: string }>>;
}