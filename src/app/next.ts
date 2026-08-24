/**
 * 应用目录契约 — 标准端点托管（Next.js 路由适配层）
 *
 * 与 app/manifest.ts 的纯逻辑分离：本模块依赖 next/server 运行时响应，
 * 提供 `createAppManifestHandler`，把子产品 manifest 托管到标准路径
 * `/.well-known/app-manifest.json`（APP_MANIFEST_WELL_KNOWN_PATH）。
 *
 * 使用方式（子产品侧，一行接入）：
 * ```ts
 * // src/app/.well-known/app-manifest.json/route.ts
 * import { createAppManifestHandler } from "yunzone-service-kit/app/next";
 * import manifest from "@/manifest/app-manifest.json";
 *
 * export const GET = createAppManifestHandler({ manifest });
 * ```
 *
 * 与静态文件方式二选一：manifest 完全静态时可直接放置
 * `public/.well-known/app-manifest.json`；需要运行时动态（如状态实时变化）
 * 或统一响应头时使用本 handler。
 *
 * 类型解耦说明：对齐 ops/next.ts 的鸭子类型策略——不引入 NextRequest 参数
 * 类型（避免 Next.js 内部私有标记跨副本类型不兼容），handler 无参（manifest
 * 端点不依赖请求上下文），返回 `() => Promise<Response>` 供路由直接导出。
 */

import { NextResponse } from "next/server";
import { parseAppManifest } from "./manifest";
import type { AppManifest } from "./types";

/** createAppManifestHandler 参数 */
export interface AppManifestHandlerOptions {
  /**
   * manifest 数据源：
   * - 静态对象（契约校验通过后原样响应）
   * - 函数形态（每次请求求值，支持运行时状态，如动态 status）
   */
  manifest: AppManifest | (() => AppManifest | Promise<AppManifest>);
}

/** 标准端点路由处理函数（无参 GET，Next.js App Router 可直接导出） */
export type AppManifestRouteHandler = () => Promise<Response>;

/**
 * 创建标准端点 GET handler。
 *
 * 行为：
 * - 每次请求经 parseAppManifest 契约校验，非法 manifest 返回
 *   500 `{ code: "APP_MANIFEST_INVALID" }`（不输出非法契约、不泄漏诊断细节）
 * - 成功响应 `NextResponse.json(manifest)`，带
 *   `Cache-Control: public, max-age=300`（消费方构建/聚合可安全缓存）
 */
export function createAppManifestHandler(
  options: AppManifestHandlerOptions
): AppManifestRouteHandler {
  return async () => {
    try {
      const manifest =
        typeof options.manifest === "function"
          ? await options.manifest()
          : options.manifest;
      const parsed = parseAppManifest(manifest);
      return NextResponse.json(parsed, {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    } catch {
      return NextResponse.json(
        { code: "APP_MANIFEST_INVALID", message: "invalid app manifest" },
        { status: 500 }
      );
    }
  };
}
