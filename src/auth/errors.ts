import { KitError } from "../core/errors";

/**
 * 鉴权中心客户端通信错误
 *
 * 覆盖网络失败、超时、非 2xx 响应、响应体非法等协议层失败。
 * 业务层结果（无效 token 统一 200 + { active: false }）不属此类，
 * 由 introspect 正常返回，消费方按 active 字段判断。
 */
export class AuthCenterError extends KitError {}
