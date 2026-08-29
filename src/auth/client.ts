/**
 * Token Authority 客户端执行层（kit 官方实现）
 *
 * 职责边界：
 * - 只封装通信协议：端点（TOKEN_ENDPOINTS）、鉴权头、超时、错误归一化；
 * - 只透传契约语义：无效 token 统一 200 + { active: false }（防枚举）为
 *   服务端行为，客户端原样返回，消费方按 active 字段判断；
 * - 不承载消费方策略：探活节奏、降级回退、claims → 业务身份映射等
 *   由消费方自行实现（各产品差异点）。
 *
 * 错误归一化：网络失败 / 超时 / 非 2xx / 响应体非法统一抛 AuthCenterError
 * （服务端错误码可解析时保留至 error.code）。
 */

import { AuthCenterError } from "./errors";
import { TOKEN_ENDPOINTS } from "./token-contract";
import type {
  ApiErrorBody,
  TokenIntrospectRequest,
  TokenIntrospectResponse,
} from "./token-contract";

/** 鉴权中心客户端配置（显式注入，kit 不读环境变量） */
export interface AuthCenterClientConfig {
  /** 鉴权中心基础地址（尾部斜杠自动归一化） */
  baseUrl: string;
  /** 服务凭证（Bearer）；为空时不携带 Authorization 头（匿名 introspect → 公开视图） */
  apiKey?: string;
  /** 请求超时毫秒（默认 5000） */
  timeoutMs?: number;
}

/** 鉴权中心客户端（通信执行层） */
export interface AuthCenterClient {
  /**
   * 凭证校验（introspect）。
   * 无效 token 返回 { active: false }（不抛错）；协议层失败抛 AuthCenterError。
   */
  introspect(request: TokenIntrospectRequest): Promise<TokenIntrospectResponse>;
  /**
   * 服务健康探活。可用（2xx）返回 true；不可达 / 非 2xx 一律返回 false
   * （探活是轮询查询，不可用即 false，不抛错）。
   */
  healthz(): Promise<boolean>;
}

/** 创建鉴权中心客户端 */
export function createAuthCenterClient(config: AuthCenterClientConfig): AuthCenterClient {
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
        throw await protocolError(path, res.status, res);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof AuthCenterError) throw err;
      throw new AuthCenterError(`鉴权中心请求失败：${path}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  async function protocolError(path: string, status: number, res: Response): Promise<AuthCenterError> {
    let code = "AUTH_CENTER_PROTOCOL_ERROR";
    let detail = "";
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (typeof body?.code === "string") {
        code = body.code;
        detail = typeof body?.message === "string" ? `：${body.message}` : "";
      }
    } catch {
      // 响应体非 JSON，保留默认错误码
    }
    return new AuthCenterError(`鉴权中心响应异常：${path} 返回 ${status}${detail}`, {
      code,
    });
  }

  return {
    async introspect(request: TokenIntrospectRequest): Promise<TokenIntrospectResponse> {
      return post<TokenIntrospectResponse>(TOKEN_ENDPOINTS.introspect, request);
    },

    async healthz(): Promise<boolean> {
      try {
        const res = await fetch(`${baseUrl}${TOKEN_ENDPOINTS.healthz}`, {
          method: "GET",
          headers: authHeaders(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
