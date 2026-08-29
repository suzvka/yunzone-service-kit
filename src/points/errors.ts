import { KitError } from "../core/errors";

/**
 * 积分服务客户端通信错误
 *
 * 覆盖网络失败、超时、非 2xx 响应、响应体非法等协议层失败。
 * 业务层结果（余额不足 / duplicate 等）由 balance / deduct 正常返回，
 * 不属此类。
 *
 * 注意：deduct 抛出本错误时服务端状态不可确知（可能已入账），
 * 消费方应按契约以同一 requestId 安全重试（幂等由服务端兜底）。
 */
export class PointsServiceError extends KitError {}
