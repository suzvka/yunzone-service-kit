/**
 * 应用目录契约 — 目录聚合纯函数（Headless 数据层）
 *
 * 职责：把「子产品自述 manifest + 宿主编排覆盖」合并为消费方可直接渲染的
 * 标准卡片数据。纯同步、无副作用、幂等。
 *
 * 使用方式：
 * ```ts
 * import { resolveAppCatalog } from "yunzone-service-kit/app";
 *
 * const apps = resolveAppCatalog([
 *   { id: "wanyanai", manifest: wanyanaiManifest, order: 1 },
 *   { id: "rimlife", manifest: rimlifeManifest, order: 2, status: "coming_soon" },
 * ]);
 * ```
 */

import { AppManifestError } from "./errors";
import { parseAppManifest } from "./manifest";
import type {
  AppCatalogEntry,
  ResolvedApp,
  ResolveAppCatalogOptions,
} from "./types";

/**
 * 聚合应用目录
 *
 * 行为规范：
 * - 每个 entry 的 manifest 解析（JSON 字符串先 JSON.parse 再契约校验）
 * - 编排覆盖：name / status 非空即覆盖 manifest 声明
 * - 归一化：tagline 回退 description、tags 恒为数组、links 缺省字段为 undefined
 * - 排序：有 order 的按数值升序在前，无 order 的按 id localeCompare 稳定排后
 * - 重复 id 抛错（code `APP_CATALOG_DUPLICATE_ID`，防止编排配置错误）
 * - manifest 解析失败默认抛错（fail-fast，构建期友好）；
 *   `skipInvalid: true` 时 console.warn 并跳过该条目
 */
export function resolveAppCatalog(
  entries: AppCatalogEntry[],
  options: ResolveAppCatalogOptions = {}
): ResolvedApp[] {
  const { skipInvalid = false } = options;
  const seen = new Set<string>();
  const resolved: ResolvedApp[] = [];

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new AppManifestError(
        `duplicate app id "${entry.id}" in catalog`,
        { code: "APP_CATALOG_DUPLICATE_ID" }
      );
    }
    seen.add(entry.id);

    let manifest;
    try {
      const raw =
        typeof entry.manifest === "string"
          ? JSON.parse(entry.manifest)
          : entry.manifest;
      manifest = parseAppManifest(raw, entry.id);
    } catch (err) {
      if (skipInvalid) {
        console.warn(
          `[app-catalog] skip invalid manifest for "${entry.id}": ` +
            (err instanceof Error ? err.message : String(err))
        );
        continue;
      }
      throw err;
    }

    resolved.push({
      id: entry.id,
      name: entry.name ?? manifest.app.name,
      tagline: manifest.app.tagline ?? manifest.app.description,
      description: manifest.app.description,
      href: manifest.app.href,
      status: entry.status ?? manifest.app.status,
      assets: manifest.app.assets,
      tags: manifest.app.tags,
      links: {
        docs: manifest.app.links?.docs,
        source: manifest.app.links?.source,
        support: manifest.app.links?.support,
      },
      order: entry.order,
      hidden: entry.hidden ?? false,
    });
  }

  resolved.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    if (a.order !== undefined) {
      return -1;
    }
    if (b.order !== undefined) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });

  return resolved;
}
