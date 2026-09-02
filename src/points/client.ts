/**
 * 积分服务客户端执行层（kit 官方实现）
 *
 * 职责边界：
 * - 只封装通信协议：端点（POINTS_ENDPOINTS）、鉴权头、超时、错误归一化；
 * - 余额不足 / 幂等命中等业务结果按响应体正常返回，不抛错；
 * - 协议层失败统一抛 PointsServiceError——deduct 失败时服务端状态不可确知，
 *   调用方按契约以同一 requestId 安全重试（幂等由服务端兜底）。
 *
 * kit 不代持重试：是否重试、退避策略由消费方按业务时序决定
 * （如管线结算失败时的补偿语义）。
 */

import { PointsServiceError } from "./errors";
import { POINTS_ENDPOINTS } from "./types";
import type {
  PointsBalanceRequest,
  PointsBalanceResponse,
  PointsDeductRequest,
  PointsDeductResponse,
} from "./types";

/** 积分服务客户端配置（显式注入，kit 不读环境变量） */
export interface PointsClientConfig {
  /** 用户中心基础地址（尾部斜杠自动归一化） */
  baseUrl: string;
  /** B 端服务凭证（Bearer）；为空时不携带 Authorization 头 */
  apiKey?: string;
  /** 请求超时毫秒（默认 5000） */
  timeoutMs?: number;
}

/** 积分服务客户端（通信执行层） */
export interface PointsClient {
  /** 查询账户可用积分余额 */
  balance(request: PointsBalanceRequest): Promise<PointsBalanceResponse>;
  /**
   * 幂等实扣。
   * 业务结果（含 duplicate / ok:false）正常返回；协议层失败抛 PointsServiceError
   * （此时可用同一 requestId 安全重试，见模块契约说明）。
   */
  deduct(request: PointsDeductRequest): Promise<PointsDeductResponse>;
}

/** 创建积分服务客户端 */
export function createPointsClient(config: PointsClientConfig): PointsClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 5000;

  function authHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    };
  }

  async function post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new PointsServiceError(`积分服务响应异常：${path} 返回 ${res.status}`, {
          code: "POINTS_PROTOCOL_ERROR",
        });
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof PointsServiceError) throw err;
      throw new PointsServiceError(`积分服务请求失败：${path}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async balance(request: PointsBalanceRequest): Promise<PointsBalanceResponse> {
      return post<PointsBalanceResponse>(POINTS_ENDPOINTS.balance, request);
    },

    async deduct(request: PointsDeductRequest): Promise<PointsDeductResponse> {
      return post<PointsDeductResponse>(POINTS_ENDPOINTS.deduct, request);
    },
  };
}
