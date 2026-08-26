/**
 * Token Authority Service 契约（服务凭证 / 用户 Token 共享端点）
 *
 * 单一事实源：docs/token-contract.md（共识版 v1.4，含 accountId 账户锚定
 * 与身份票据 identityTicket / 链式证据 evidenceToken 契约）。
 * 消费方（用户中心 / WanyanAI）按本模块类型对接鉴权中心 /api/v1/token/*，
 * 字段命名与鉴权中心实现一致（camelCase）。
 */

// ─── 端点路径 ──────────────────────────────────────────────────────

export const TOKEN_ENDPOINTS = {
  issue: '/api/v1/token/issue',
  introspect: '/api/v1/token/introspect',
  lookup: '/api/v1/token/lookup',
  refresh: '/api/v1/token/refresh',
  revoke: '/api/v1/token/revoke',
} as const;

// ─── 错误 ──────────────────────────────────────────────────────────

export const TOKEN_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'UNAUTHENTICATED',
  'PRODUCT_NOT_ALLOWED',
  'PRODUCT_NOT_REGISTERED',
  'PRODUCT_DISABLED',
  'TOKEN_NOT_FOUND',
  'TOKEN_EXPIRED',
  'TOKEN_REVOKED',
  'TTL_LIMIT_EXCEEDED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type TokenErrorCode = (typeof TOKEN_ERROR_CODES)[number];

/** 统一错误响应体（requestId 为可选字段） */
export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
}

// ─── Issue ─────────────────────────────────────────────────────────

export interface TokenIssueRequest {
  /** 签发主体；服务凭证模式内部约定为 `client:{productId}`（与业务用户空间隔离） */
  userId: string;
  /** 凭证归属产品（业务侧唯一键，签发后不可变更） */
  productId: string;
  /** 权限域，默认空数组 */
  scope?: string[];
  /** 自定义声明；服务凭证模式（type='client-credential'）受扁平约束严格校验 */
  claims?: Record<string, unknown>;
  /** 有效秒数，默认 86400 */
  ttl?: number;
  /** 可公开的自定义声明（匿名 introspect 返回） */
  publicClaims?: Record<string, unknown>;
  /** userId 是否可公开（默认 false = 最小暴露；v1.4 起业务用户 token 的账户锚点走 publicClaims.accountId，不再依赖本开关） */
  publicUserId?: boolean;
  /** scope 是否可公开（默认 true，授权判断需要） */
  publicScope?: boolean;
  /**
   * v1.4 — 身份票据：第三方产品签发业务用户 token（claims 无 type 声明）时的账户锚定凭据。
   * 平台（user_center）签发，格式 `yzid1.<payload>.<sig>`，短时有效（默认 300s）。
   * 仅当调用方为第三方产品且签发业务用户 token 时必填（与 evidenceToken 二选一）。
   */
  identityTicket?: string;
  /**
   * v1.4 — 链式证据：同一产品现存有效业务用户 token（会员换发等续签场景）。
   * 鉴权中心校验其 active + 同 productId + 业务类型后，以其 accountId 为锚。
   * 与 identityTicket 二选一。
   */
  evidenceToken?: string;
}

export interface TokenIssueResponse {
  /** 凭证值（secret），仅本次签发响应返回一次 */
  token: string;
  expiresAt: string;
  userId: string;
  productId: string;
  scope: string[];
}

// ─── Introspect / Lookup ───────────────────────────────────────────

export interface TokenIntrospectRequest {
  token: string;
  /** 需满足的权限子集（不满足时 active:false） */
  scope?: string[];
}

export interface TokenLookupRequest {
  /** 凭证公开标识（= 签发时的 token_hash = publicClaims.clientId） */
  id: string;
}

/** 凭证公开 claims（只读视图，命名与鉴权中心实现一致） */
export interface TokenPublicClaims {
  /** 凭证唯一标识（服务端生成 = token_hash，与顶层 id 一致） */
  clientId: string;
  /** 凭证名称（非空字符串） */
  name: string;
  /** 是否机密凭证（决定 secret 是否允许暴露于非安全环境） */
  confidential: boolean;
  /** 授权回调地址白名单 */
  redirectUris?: string[];
  /** 凭证关联的站点地址 */
  clientUri?: string;
  /** 签发方 / 环境标识（ISSUER_ID env，默认 token-authority） */
  issuer?: string;
  [key: string]: unknown;
}

/**
 * 校验响应（introspect / lookup 共用）：
 * - 无效 token 统一 200 + { active: false }（防枚举）；
 * - 匿名 / 凭证产品不匹配 → 公开视图（含 productId）；
 * - 携带有效凭证且产品匹配 → 全量视图（含 userId）。
 */
export interface TokenIntrospectResponse {
  active: boolean;
  /** 凭证归属产品（公开视图亦返回） */
  productId?: string;
  scope?: string[];
  expiresAt?: string;
  claims?: TokenPublicClaims;
  /** 签发主体，仅凭证调用（产品匹配）时返回 */
  userId?: string;
}

// ─── Refresh ───────────────────────────────────────────────────────

export interface TokenRefreshRequest {
  token: string;
  /** 有效秒数，默认 86400 */
  ttl?: number;
}

/**
 * 续期语义：令牌不变，仅延长过期时间。
 * 受总有效期硬上限约束（超限返回 400 TTL_LIMIT_EXCEEDED）。
 */
export interface TokenRefreshResponse {
  success: boolean;
  expiresAt: string;
}

// ─── Revoke ────────────────────────────────────────────────────────

export interface TokenRevokeRequest {
  /** 按 token 值吊销单个 */
  token?: string;
  /** 按 userId+productId 批量吊销 */
  userId?: string;
  /** 按 token 吊销时可省略（服务端从记录推导归属产品）；批量吊销必填 */
  productId?: string;
}

/** 幂等语义：重复吊销已吊销凭证仍返回 success:true（对不存在的 token 返回 404） */
export interface TokenRevokeResponse {
  success: boolean;
}
