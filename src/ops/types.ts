/**
 * 运维数据接口 — 标准报告格式
 *
 * 纯数据定义（零框架耦合）：服务负责把 OpsReporter 的输出暴露为 HTTP 端点
 * （如 /ops、/healthz），库不提供路由/响应封装。
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

/** 标准运维报告 */
export interface OpsReport {
  service: OpsServiceInfo;
  deployment: OpsDeploymentInfo;
  /** 各注册中心状态快照（key 为 addRegistry 时指定的 id） */
  registries: Record<string, KitRegistryStatus>;
  /** env set/unset 指纹（**不含变量值**，防密钥泄漏） */
  envFingerprint: Record<string, "set" | "unset">;
}
