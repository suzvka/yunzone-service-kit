/**
 * 运维数据接口 — 标准报告格式
 *
 * 纯数据定义（零框架耦合）：服务负责把 OpsReporter 的输出暴露为 HTTP 端点
 * （如 /ops、/healthz），本入口不提供路由/响应封装；管理后台路由守卫属
 * 框架适配层，见独立入口 yunzone-service-kit/ops/next。
 */

import type { KitRegistryStatus } from "../registry";

/** 服务基础信息 */
export interface OpsServiceInfo {
  /** 服务名（创建 reporter 时传入） */
  name: string;
  /** 服务版本（创建 reporter 时传入） */
  version: string;
  /** 启动时间（ISO 8601） */
  startedAt: string;
  /** 运行时长（秒） */
  uptimeSeconds: number;
}

/** 部署信息 */
export interface OpsDeploymentInfo {
  /** DEPLOY_ENV（PROD/DEV/undefined；平台注入旧名经适配层映射） */
  env: string | undefined;
  /** 对外 baseUrl（复用 resolveBaseUrl 解析链） */
  baseUrl: string;
  /** 监听地址 */
  host: string;
  port: number;
}

/** 扩展段数据源（宿主自有运维数据，如 API 调用热度；同步或异步皆可） */
export type OpsSectionProvider = () => unknown | Promise<unknown>;

/**
 * 单个扩展段的聚合结果
 *
 * provider 抛错时降级为 `ok: false` + 错误消息（不含堆栈）：运维报告不因
 * 任一扩展段失效而整体不可用。数据形状由宿主自定义（kit 不解释语义），
 * 消费方按 `ok` 收窄后读取 `data`。
 */
export type OpsSectionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/** 标准运维报告 */
export interface OpsReport {
  service: OpsServiceInfo;
  deployment: OpsDeploymentInfo;
  /** 各注册中心状态快照（key 为 addRegistry 时指定的 id） */
  registries: Record<string, KitRegistryStatus>;
  /** 宿主扩展段快照（key 为 addSection 时指定的 id；provider 抛错即该段降级为 error） */
  sections: Record<string, OpsSectionResult>;
  /** env set/unset 指纹（**不含变量值**，防密钥泄漏） */
  envFingerprint: Record<string, "set" | "unset">;
}
