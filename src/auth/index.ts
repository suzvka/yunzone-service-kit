/**
 * 鉴权中心对接（契约 + 客户端执行层）
 *
 * - token-contract：端点 / 请求 / 响应 / 错误码契约（单一事实源 docs/token-contract.md）
 * - client：官方通信实现（消费方策略——探活节奏 / 降级 / 身份映射——由消费方实现）
 */
export * from "./token-contract";
export * from "./client";
export * from "./errors";
