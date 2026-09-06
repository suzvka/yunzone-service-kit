/**
 * 积分服务契约（用户中心积分账本对接）
 *
 * 积分账本为平台统一账户（accountId 维度），本模块仅定义消费侧对接契约
 * 与官方通信实现；账本本体（余额 / 复式流水 / 幂等约束）由用户中心持有。
 *
 * 端点语义（与用户中心 B 端接口一致）：
 * - POST /api/points/balance  { accountId } → { success, balance }
 * - POST /api/points/deduct   { requestId, accountId, points, metadata? }
 *     → { ok, duplicate, balance?, reason? }（裸 JSON，无信封字段）
 * - POST /api/internal/points/deposit  { requestId, accountId, points, metadata? }
 *     → { ok, duplicate, orderNo?, balance?, reason? }（裸 JSON，平台内部端点）
 *
 * 幂等语义（扣款/存入安全的核心）：
 * - requestId 为幂等键，用户中心侧以流水 UNIQUE(requestId) 约束保证
 *   同一 requestId 至多实扣/存入一次；
 * - 重复请求返回 duplicate: true 且 ok: true（不视为失败）；
 * - 通信失败（超时 / 5xx）时调用方无法确知服务端是否已入账，
 *   **可用同一 requestId 安全重试**——重复入账由服务端幂等约束兜底，
 *   结果为 duplicate: true。
 *
 * deposit 与 deduct 的信任层级差异：
 * - deduct：B 端产品 API（任何持有凭证的产品可调），路径 /api/points/
 * - deposit：平台内部端点（仅基础设施可调，productId 白名单），路径 /api/internal/
 *   语义为“用户主动将 infer 内部台账汇总后存入”，非平台单向发放。
 */

// ─── 端点路径 ──────────────────────────────────────────────────────

export const POINTS_ENDPOINTS = {
  /** 查询账户可用积分余额 */
  balance: '/api/points/balance',
  /** 幂等实扣 */
  deduct: '/api/points/deduct',
  /** 算力报酬存入（平台内部端点，仅基础设施可调） */
  deposit: '/api/internal/points/deposit',
} as const;

// ─── 余额查询 ──────────────────────────────────────────────────────

export interface PointsBalanceRequest {
  /** 平台统一账户 id（扣款锚点） */
  accountId: string;
}

export interface PointsBalanceResponse {
  /** 服务端成功信封（用户中心响应助手展开顶层，恒 true；失败走非 2xx 错误通道） */
  success: boolean;
  /** 当前可用积分 */
  balance: number;
}

// ─── 幂等实扣 ──────────────────────────────────────────────────────

export interface PointsDeductRequest {
  /** 幂等键（服务端流水 UNIQUE 约束；同一 requestId 至多实扣一次） */
  requestId: string;
  /** 平台统一账户 id（扣款锚点） */
  accountId: string;
  /** 扣减积分数（正整数） */
  points: number;
  /** 结算元数据（写入流水，供对账） */
  metadata?: Record<string, unknown>;
}

export interface PointsDeductResponse {
  /** 是否成功扣减（重复 requestId 亦为 true，见 duplicate） */
  ok: boolean;
  /** 幂等命中：同一 requestId 已实扣过，本次跳过（不视为失败） */
  duplicate: boolean;
  /** 扣减后余额（服务端可选返回） */
  balance?: number;
  /** 失败原因（ok=false 时） */
  reason?: string;
}

// ─── 算力报酬存入（平台内部） ──────────────────────────────────────

export interface PointsDepositRequest {
  /** 幂等键（infer 侧推导，如存入请求 UUID 或 `${accountId}:${period}`） */
  requestId: string;
  /** 接收存入的平台账户（算力提供者） */
  accountId: string;
  /** 存入积分数（正整数，infer 内部台账汇总后的总额） */
  points: number;
  /** 存入元数据（任务周期、任务数、难度分布等，落订单 + 账本） */
  metadata?: Record<string, unknown>;
}

export interface PointsDepositResponse {
  /** 是否成功存入（重复 requestId 亦为 true，见 duplicate） */
  ok: boolean;
  /** 幂等命中：同一 requestId 已存入过，本次跳过（不视为失败） */
  duplicate: boolean;
  /** 存入订单号（作为存入凭证，与付费 topup 共享对账体系） */
  orderNo?: string;
  /** 存入后余额 */
  balance?: number;
  /** 失败原因（ok=false 时） */
  reason?: string;
}
