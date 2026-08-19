/**
 * SQL 数据库抽象 — 核心类型定义
 *
 * 集群统一数据库抽象形状（取代旧的"互斥后端"DbAdapter 通用 CRUD 原语）：
 * - SQL 字符串即真理：调用方直接书写参数化 SQL（$1、$2 占位），无字段映射层
 * - 渠道两模式：postgres（通用）/ coze（平台注入），渠道差异 = 连接凭证获取方式
 * - 事务强承诺：所有实现必须提供 withTransaction（pg 真事务；测试桩快照回滚模拟）
 * - 生命周期：init/disconnect 钩子由组合根统一调度
 */

import type { LifecycleAware } from "../core";

/** 数据库渠道（值域统一；SQL 语义一致，仅连接凭证获取方式不同） */
export type DatabaseChannel = "postgres" | "coze";

/** 渠道配置：channel 显式必填，禁止自动嗅探与隐式默认 */
export interface SqlDbConfig {
  channel: DatabaseChannel;
}

/**
 * SQL 执行器接口（db-core 契约）
 *
 * 领域真理 = SQL 字符串 + 参数化占位符（$1 等）：
 * - query 查询返回行数组（无命中返回空数组）；execute 写语句返回受影响行数
 * - 渠道实现私有细节：
 *   - postgres 模式实现需额外获取连接凭证（DATABASE_URL）
 *   - coze 模式实现按平台注入行为运行（PGDATABASE_URL / PG* 变量组），不做自定义拼接
 * - 错误归一化：唯一约束冲突由实现抛 UniqueViolationError，其余错误包装 StorageError
 */
export interface SqlDb extends LifecycleAware {
  /** 查询语句，返回行数组（无命中返回空数组） */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** 写语句（INSERT/UPDATE/DELETE/DDL），返回受影响行数 */
  execute(sql: string, params?: unknown[]): Promise<number>;

  /** 事务强承诺：回调内全部写入要么整体提交、要么整体回滚，禁止假回退 */
  withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T>;
}
