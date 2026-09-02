/**
 * 管理后台路由适配层（Next.js，v1.0 协议）
 *
 * 与 ops/admin.ts 的纯逻辑分离：本模块依赖 next/server 运行时响应，仅提供路由级
 * 守卫 `requireAdminAuth`，包装器范式：未登录 401，禁用态 503（协议 2.7/2.8）。
 * 单独入口（yunzone-service-kit/ops/next），不污染纯逻辑层。
 *
 * 类型解耦说明：Next.js 的 NextRequest/NextResponse 携带内部私有标记
 * （[INTERNALS] 等），不同 node_modules 物理副本间类型互不兼容。因此本模块
 * 不引入 NextRequest 作为参数类型：守卫内部按鸭子类型读取 `request.cookies`
 * （Next.js 15.3+/16 为 getter 属性，旧版为方法，两者兼容），外层用宽松泛型
 * `THandler` 原样透传服务侧 handler，避免任何跨副本类型比较。
 */

import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  resolveAdminConfig,
  validateSignedAdminSession,
} from "./admin";

/**
 * 宽松 handler 形态：不约束参数与返回类型，原样透传服务侧签名。
 * 收紧为具体形状会触发跨 node_modules 副本的 Next.js 私有标记类型比较。
 */
type AnyRouteHandler = (...args: any[]) => any;

/**
 * 包装一个管理后台路由处理函数。
 *
 * - `ADMIN_PASSWORD` 未设置（禁用态）→ `503 {code:"ADMIN_DISABLED"}`
 * - 未登录 / 会话无效 / 已过期 → `401 {code:"UNAUTHENTICATED"}`
 * - 通过 → 原样调用 handler
 *
 * 返回类型与原 handler 相同（服务侧保留自身 Next.js 副本的精确签名）。
 */
export function requireAdminAuth<THandler extends AnyRouteHandler>(
  handler: THandler
): THandler {
  const wrapped: AnyRouteHandler = async (request, context) => {
    const admin = resolveAdminConfig();
    if (!admin.enabled || !admin.password) {
      return NextResponse.json(
        { code: "ADMIN_DISABLED", message: "管理后台已禁用" },
        { status: 503 }
      );
    }

    // Next.js 15.3+/16 中 cookies 为 getter 属性，旧版为方法，按形态自适应读取
    const cookiesLike = request.cookies;
    const cookies =
      typeof cookiesLike === "function" ? cookiesLike() : cookiesLike;
    const session = cookies?.get(ADMIN_SESSION_COOKIE)?.value;
    const username = session
      ? validateSignedAdminSession(session, admin.password, {
          maxAgeSeconds: admin.sessionMaxAgeSeconds,
        })
      : null;
    if (username === null) {
      return NextResponse.json(
        { code: "UNAUTHENTICATED", message: "未登录，需要管理员权限" },
        { status: 401 }
      );
    }

    return handler(request, context);
  };
  return wrapped as unknown as THandler;
}