/**
 * SQL 数据库抽象 — 核心类型定义
 *
 * 集群统一数据库抽象形状：
 * - SQL 字符串即真理：调用方直接书写参数化 SQL（$1、$2 占位），无字段映射层
 * - 渠道值域开放（2026-10-13）：内置 postgres（通用）/ coze（平台注入）/ none（显式无库）
 *   之外，业务可经 registerDatabaseChannel 注册自有渠道（kit 辅助定位：不约束业务），
 *   渠道差异 = 连接凭证获取方式，全部经同一 createSqlDb 分派
 * - none 即显式无库声明：任何数据库操作（createSqlDb / resolveDatabaseUrl）对其 fail-fast 抛错，
 *   消费方应据此选择非库存储后端（如文件），不做降级或空实现
 * - 事务强承诺：所有实现必须提供 withTransaction（pg 真事务；测试桩快照回滚模拟）
 * - 生命周期：init/disconnect 钩子由组合根统一调度
 */

import type { LifecycleAware } from "../core";
import type { PgSqlDbOptions } from "./pg";

/**
 * 数据库渠道（值域统一；SQL 语义一致，仅连接凭证获取方式不同）。
 * 内置三值域 + 业务注册渠道（string 开放面；`string & {}` 保留内置名自动补全）。
 */
export type DatabaseChannel = "postgres" | "coze" | "none" | (string & {});

/** 渠道配置：channel 显式必填，禁止自动嗅探与隐式默认 */
export interface SqlDbConfig {
  channel: DatabaseChannel;
  /**
   * 连接池选项（仅 postgres / coze 渠道生效，透传给 PgSqlDb）
   *
   * 存在意义：消除“为了传 SSL 而直接 new PgSqlDb”的旁路——
   * 直连会绕过渠道分派，使自定义渠道（含 offline）在部分项目里永远不生效。
   */
  options?: PgSqlDbOptions;
}

/**
 * SQL 执行器契约
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

  /**
   * 事务强承诺：回调内全部写入要么整体提交、要么整体回滚，禁止假回退。
   *
   * 契约约束：回调内禁止调用 omni-auth 等外部库的认证/写 API——
   * 跨抽象事务互相不可见（外部库在池上另开连接），其写入会静默逃逸本事务。
   */
  withTransaction<T>(fn: (db: SqlDb) => Promise<T>): Promise<T>;
}
