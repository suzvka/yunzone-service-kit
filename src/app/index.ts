/**
 * yunzone-service-kit/app — 应用目录契约（AppManifest v1 + 目录聚合纯函数）
 *
 * Headless 纯数据层：子产品按契约自述应用介绍，宿主聚合后标准渲染、随意编排。
 */

export * from "./types";
export { AppManifestError } from "./errors";
export {
  appApiEntrySchema,
  appApiNoteSchema,
  appApiErrorSchema,
  appManifestSchema,
  parseAppManifest,
  type ParsedAppManifest,
} from "./manifest";
export { resolveAppCatalog } from "./catalog";
