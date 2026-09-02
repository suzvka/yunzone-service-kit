/**
 * yunzone-service-kit/core — 共享原语
 *
 * 集群内两种并行抽象模式共用的基础形状：
 * - yunzone-service-kit/registry — 并存 Provider 模式（多个同类服务共存、按优先级路由）
 * - yunzone-service-kit/db       — SQL 数据库抽象（SQL 字符串直传、渠道三值域显式声明）
 *
 * 共享原语：错误基类（KitError）、生命周期钩子（LifecycleAware）。
 * 刻意不放 Meta/注册表——那是 registry 的领域契约，保持其导出面零变化。
 */

export { KitError, type KitErrorOptions } from "./errors";
export type { LifecycleAware } from "./lifecycle";