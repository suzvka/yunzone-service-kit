/**
 * 应用目录契约 — AppManifest schema 与解析器
 *
 * 使用方式：
 * ```ts
 * import { parseAppManifest, appManifestSchema } from "yunzone-service-kit/app";
 *
 * // 子产品侧：声明应用介绍（JSON 或对象），解析失败抛 AppManifestError
 * const manifest = parseAppManifest(rawJson, "wanyanai");
 *
 * // 宿主侧：直接复用 schema 组合扩展校验（如附加私有字段）
 * const extended = appManifestSchema.extend({ private: z.string().optional() });
 * ```
 */

import { z } from "zod";
import { AppManifestError } from "./errors";
import { APP_MANIFEST_SCHEMA_VERSION } from "./types";

/**
 * AppManifest v1 契约 schema（zod）
 *
 * 解析后归一化：status → "live"、tags → []（缺省时 output 为必填形态）。
 */
export const appManifestSchema = z.object({
  schemaVersion: z.string(),
  app: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    tagline: z.string().min(1).optional(),
    description: z.string().min(1),
    href: z.string().min(1),
    status: z
      .enum(["live", "beta", "coming_soon", "maintenance"])
      .default("live"),
    assets: z.object({
      icon: z.string().min(1),
      cover: z.string().optional(),
      banner: z.string().optional(),
    }),
    tags: z.array(z.string()).default([]),
    links: z
      .object({
        docs: z.string().optional(),
        source: z.string().optional(),
        support: z.string().optional(),
      })
      .optional(),
  }),
});

/** 解析后的规范形态（status / tags 已归一化） */
export type ParsedAppManifest = z.output<typeof appManifestSchema>;

/**
 * 解析一个 AppManifest（校验 + 默认值 + 版本检查）
 *
 * - 失败抛 `AppManifestError`（code `APP_MANIFEST_INVALID`），
 *   message 含 zod 字段路径诊断；传入 `source`（如 URL / 文件名）时前置标注
 * - `schemaVersion` 非当前支持版本抛错（code `APP_MANIFEST_VERSION_UNSUPPORTED`）
 */
export function parseAppManifest(
  input: unknown,
  source?: string
): ParsedAppManifest {
  const prefix = source ? `[${source}] ` : "";
  const result = appManifestSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new AppManifestError(`${prefix}invalid app manifest: ${issues}`, {
      code: "APP_MANIFEST_INVALID",
      cause: result.error,
    });
  }

  if (result.data.schemaVersion !== APP_MANIFEST_SCHEMA_VERSION) {
    throw new AppManifestError(
      `${prefix}unsupported schemaVersion "${result.data.schemaVersion}" ` +
        `(supported: "${APP_MANIFEST_SCHEMA_VERSION}")`,
      { code: "APP_MANIFEST_VERSION_UNSUPPORTED" }
    );
  }

  return result.data;
}
