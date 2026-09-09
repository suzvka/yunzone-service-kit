/**
 * Token Authority Service 契约（服务凭证 / 用户 Token 共享端点）
 *
 * 单一事实源：docs/token-contract.md（共识版 v1.8：登记表为纯 token 存储，
 * 业务用户 token 不做 accountId 账户锚定，无身份票据 / isPlatform 豁免；
 * accountId 不再承载扣款语义）。
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
  /** 服务健康探活（GET） */
  healthz: '/api/healthz',
} as const;

// ─── 错误 ──────────────────────────────────────────────────────────

/**
 * v1 token 端点返回的错误码值域（HTTP 映射与触发场景见 docs/token-contract.md §4）。
 *
 * 消费方据此区分「服务端业务拒绝」（命中值域 → 服务可达）与「通信层失败」
 * （未命中 → 网络/超时，可触发探活降级）。
 *
 * introspect / lookup 不参与错误码（防枚举，统一 200 + { active: false }），
 * 故校验不通过的具体原因（过期 / 已吊销 / 权限不符）不在本值域内。
 */
export const TOKEN_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'TOKEN_NOT_ACTIVE',
  'UNAUTHENTICATED',
  'PRODUCT_NOT_ALLOWED',
  'PRODUCT_NOT_FOUND',
  'TOKEN_NOT_FOUND',
  'TOKEN_CONFLICT',
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
  /**
   * 调用方自定义槽位标记（opaque）：登记表不解释语义，仅用作 replace 键位
   * （同一 (productId, tag, claims.type) 至多一个 active Token）。消费方以自身身份语义
   * 填充——用户中心填 userId，设备型产品填 deviceId；sku / client-credential 由服务端派生，调用方不传。
   */
  tag?: string;
  /** 凭证归属产品（业务侧唯一键，签发后不可变更） */
  productId: string;
  /** 权限域，默认空数组 */
  scope?: string[];
  /** 自定义声明；服务凭证模式（type='client-credential'）受扁平约束严格校验 */
  claims?: Record<string, unknown>;
  /** 有效秒数；不填 = 不设过期时间（永不过期，响应 expiresAt 为 null） */
  ttl?: number;
  /** 可公开的自定义声明（匿名 introspect 返回）；`accountId` 可自报于此，但仅属透传标识，不得作扣款/发放依据（v1.8） */
  publicClaims?: Record<string, unknown>;
  /** tag 是否可公开（默认 false = 最小暴露） */
  publicTag?: boolean;
  /** scope 是否可公开（默认 true，授权判断需要） */
  publicScope?: boolean;
}

export interface TokenIssueResponse {
  /** 凭证值（secret），仅本次签发响应返回一次 */
  token: string;
  /** 过期时间（ISO 8601）；签发时未传 ttl 则为 null（永不过期） */
  expiresAt: string | null;
  /** 槽位标记（opaque，回显签发时的 tag） */
  tag: string;
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
 * - 匿名 / 凭证产品不匹配 → 公开视图（含 productId；tag 仅在 publicTag=true 时出现）；
 * - 携带有效凭证且产品匹配 → 全量视图（含 tag）。
 */
export interface TokenIntrospectResponse {
  active: boolean;
  /** 凭证归属产品（公开视图亦返回） */
  productId?: string;
  scope?: string[];
  /** 过期时间（ISO 8601）；null = 永不过期 */
  expiresAt?: string | null;
  claims?: TokenPublicClaims;
  /** 槽位标记（opaque）；全量视图返回，公开视图仅在 publicTag=true 时返回 */
  tag?: string;
}

// ─── Refresh ───────────────────────────────────────────────────────

export interface TokenRefreshRequest {
  token: string;
  /** 有效秒数；不填 = 改为不设过期时间（永不过期，响应 expiresAt 为 null） */
  ttl?: number;
}

/**
 * 续期语义：令牌值不变，仅延长过期时间。
 * 无 TTL 硬上限（基建不评判调用方对过期时间的设置）。
 */
export interface TokenRefreshResponse {
  success: boolean;
  /** 新的过期时间（ISO 8601）；未传 ttl 则为 null（永不过期） */
  expiresAt: string | null;
}

// ─── Revoke ────────────────────────────────────────────────────────

export interface TokenRevokeRequest {
  /** 按 token 值吊销单个 */
  token?: string;
  /** 按 tag+productId 批量吊销该槽位下所有活跃业务用户 token */
  tag?: string;
  /** 按 token 吊销时可省略（服务端从记录推导归属产品）；批量吊销必填 */
  productId?: string;
}

/** 幂等语义：重复吊销已吊销凭证仍返回 success:true（对不存在的 token 返回 404） */
export interface TokenRevokeResponse {
  success: boolean;
}
