/**
 * Token Authority Service 契约（服务凭证 / 用户 Token 共享端点）
 *
 * 单一事实源：docs/token-contract.md（共识版 v1.9：本文件与鉴权中心**实现**对齐）。
 * 去产品化后的三条硬事实（消费方必读）：
 * 1. 隔离键 = **签发者凭证 id**（不是 productId）；productId 仅是不透明透传数据，
 *    服务端不解释、不参与键位、不参与鉴权；
 * 2. 响应**无顶层 productId**——归属语义走 `claims`（签发侧自行写入，消费方自读）；
 * 3. 登记表不校验自报 `accountId`，其上无可信支付语义，不得作扣款/发放依据（v1.8）。
 * 消费方（用户中心 / WanyanAI / Zrond）按本模块类型对接鉴权中心
 * /api/v1/token/*，字段命名与鉴权中心实现一致（camelCase）。
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
 * 去产品化后 `PRODUCT_NOT_ALLOWED` / `PRODUCT_NOT_FOUND` 已不再是本服务错误码
 * （产品隔离由签发者命名空间取代）；`/api/v1/credentials/issue|revoke` 的
 * `CREDENTIAL_NOT_ALLOWED` / `CREDENTIAL_NOT_FOUND` 不属 token 端点，不入本值域。
 */
export const TOKEN_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'TOKEN_NOT_ACTIVE',
  'UNAUTHENTICATED',
  'TOKEN_NOT_FOUND',
  'TOKEN_NOT_OWNED',
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
   * （同一 **(签发者凭证 id, tag)** 至多一个 active Token）。消费方以自身身份语义
   * 填充——用户中心填 userId，设备型产品填 deviceId；不填 = 无槽位（参与唯一性）。
   */
  tag?: string;
  /**
   * 不透明透传字段（可选）：仅当 `claims.productId` 未显式提供时由服务端并入 `claims`
   * 存储；本服务不解释其语义、不参与隔离与键位（去产品化后归属语义完全归调用方）。
   */
  productId?: string;
  /** 权限域，默认空数组 */
  scope?: string[];
  /** 自定义声明（扁平约束：值不得为对象/数组，违反 → 400）；服务端不解释任何字段语义 */
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
  scope: string[];
}

// ─── Introspect / Lookup ───────────────────────────────────────────

export interface TokenIntrospectRequest {
  token: string;
  /** 需满足的权限子集（不满足时 active:false） */
  scope?: string[];
}

export interface TokenLookupRequest {
  /** 公开标识 = 该 token 的 `token_hash`（签发响应不返回它；需由持有方自行保存） */
  id: string;
}

/**
 * 公开 claims 形状（只读视图）：服务端**不解释不校验**其中任何字段——
 * 下列命名字段是历史上「服务凭证模式」（`claims.type='client-credential'`）的形态，
 * 该实体类型已随去产品化从鉴权中心退出（OAuth 客户端配置权威现归产品中心）；
 * 字段保留仅为消费方历史读取兼容，新接入方应按 `claims` 自报约定读。
 */
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
 * - 匿名，或携带凭证但**非该 token 的签发者** → 公开视图（tag 仅在 publicTag=true 时出现）；
 * - 携带有效凭证且为目标 token 的签发者 → 全量视图（含 tag，claims 为公开+私有合并）。
 * 无顶层 productId（去产品化：归属语义走 claims）。
 */
export interface TokenIntrospectResponse {
  active: boolean;
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
  /** 按 token 值吊销单个（须为本凭证签发；跨签发者 → 403 TOKEN_NOT_OWNED） */
  token?: string;
  /** 按槽位批量吊销：只清**调用方自己命名空间**内该 tag 的全部活跃 token（无 productId 维度） */
  tag?: string;
}

/**
 * 吊销 = 物理删除（无「已吊销」状态）：按 `tag` 批删对空槽位幂等（200）；
 * 按 `token` 单删对不存在的 token（含已删过）返回 404 `TOKEN_NOT_FOUND`。
 */
export interface TokenRevokeResponse {
  success: boolean;
}
