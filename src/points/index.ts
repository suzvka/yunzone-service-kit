/**
 * 积分服务对接（契约 + 客户端执行层）
 *
 * - types：端点 / 请求 / 响应契约与幂等语义（账本本体由用户中心持有）
 * - client：官方通信实现（重试 / 补偿策略由消费方按业务时序决定）
 */
export * from "./types";
export * from "./client";
export * from "./errors";
