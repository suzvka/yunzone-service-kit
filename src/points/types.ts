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
 *
 * 幂等语义（扣款安全的核心）：
 * - requestId 为幂等键，用户中心侧以流水 UNIQUE(requestId) 约束保证
 *   同一 requestId 至多实扣一次；
 * - 重复请求返回 duplicate: true 且 ok: true（不视为失败）；
 * - 通信失败（超时 / 5xx）时调用方无法确知服务端是否已入账，
 *   **可用同一 requestId 安全重试**——重复入账由服务端幂等约束兜底，
 *   结果为 duplicate: true。
 */

// ─── 端点路径 ──────────────────────────────────────────────────────

export const POINTS_ENDPOINTS = {
  /** 查询账户可用积分余额 */
  balance: '/api/points/balance',
  /** 幂等实扣 */
  deduct: '/api/points/deduct',
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
