/**
 * 应用目录契约 — 核心类型定义
 *
 * 设计目标：
 * - 为集群子产品提供标准"应用介绍"自描述契约（AppManifest v1）：
 *   应用名 / 简介 / 访问链接 / 图标 / 封面图 / 背景图 / 状态 / 标签 / 链接
 * - 子产品按契约声明自身介绍，宿主（如用户中心）聚合后标准渲染、随意编排
 * - 子产品可另行自述"本应用提供哪些 API"（可选顶层 apis 命名空间），
 *   宿主按同一链路拉取聚合后标准渲染 API 展示版面；
 *   条目含可选"接入要点层"（鉴权 / 请求与响应要点 / 关键错误 / 文档链接，
 *   见 AppApiEntry），供给方渐进增强、消费方缺省退化
 * - Headless 纯数据层：契约 + 解析 + 聚合均为纯逻辑，零框架 / 零 React 依赖
 *
 * 编排心智：
 * - 子产品自述（manifest）是展示信息的单一事实源
 * - 宿主侧编排（AppCatalogEntry）只声明"展示什么 / 以什么顺序 / 是否覆盖"
 * - 两者经 resolveAppCatalog 合并为 ResolvedApp（消费方可直接渲染）
 */

/** 当前支持的契约版本（schemaVersion 仅接受该值，其余抛错） */
export const APP_MANIFEST_SCHEMA_VERSION = "1.0" as const;

/**
 * 标准端点路径约定（RFC 8615 well-known 前缀）
 *
 * 子产品在此路径暴露 manifest（kit 托管或静态文件二选一），
 * 消费方（如用户中心）按该路径拉取；URL 约定随契约稳定演进。
 */
export const APP_MANIFEST_WELL_KNOWN_PATH = "/.well-known/app-manifest.json";

/** 应用状态：驱动宿主卡片按钮文案与可交互性 */
export type AppManifestStatus =
  | "live"
  | "beta"
  | "coming_soon"
  | "maintenance";

/** API 条目 HTTP 方法（展示用标识）；缺省 "GET" */
export type AppApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * API 接入要点条目 — 请求 / 响应字段或参数（最小三元素）
 *
 * 无类型、无示例、无嵌套：只描述"怎么调 / 拿到什么"的最小要素，
 * 机器契约细节经条目 `docs` 链接指向。
 */
export interface AppApiNote {
  /** 名称（字段名 / 参数名，人可读） */
  name: string;
  /** 是否必填；缺省 false */
  required?: boolean;
  /** 一行说明 */
  note?: string;
}

/** API 关键错误条目 — 只登记条目级差异错误（全站共性错误收敛到约定文档） */
export interface AppApiError {
  /** HTTP 状态码（整数） */
  status: number;
  /** 一行说明 */
  note: string;
}

/**
 * API 条目 — 子产品自述"本应用提供一个 API"
 *
 * 双层形态：
 * - **标识层**（必填）：名称 / 描述 / 方法 / 路径 / 标签——人可读的标识信息；
 * - **接入要点层**（可选，v1 兼容扩展）：鉴权 / 请求与响应要点 / 关键错误 /
 *   文档链接——描述"怎么调、拿到什么"的最小要素，仍为展示形态；
 *   完整机器契约（schema / 示例 / 全量错误）经 `docs` 链接指向，不在此承载。
 */
export interface AppApiEntry {
  /** 应用内唯一标识（版面锚点与程序化引用；重复抛错，见 APP_MANIFEST_API_DUPLICATE_ID） */
  id: string;
  /** API 名称（人可读，非空） */
  name: string;
  /** 一句话描述（非空） */
  summary: string;
  /** HTTP 方法；缺省 "GET" */
  method?: AppApiMethod;
  /** 路径（相对应用 origin，如 "/api/v1/text/diagnose"） */
  path: string;
  /** 分组标签；缺省 [] */
  tags?: string[];
  /** 鉴权声明（人读短标签，如 "公开" / "登录会话" / "签名回调"） */
  auth?: string;
  /** 请求要点（字段 / 参数）；缺省 [] */
  request?: AppApiNote[];
  /** 响应要点（同构 request）；缺省 [] */
  response?: AppApiNote[];
  /** 条目级差异错误；缺省 [] */
  errors?: AppApiError[];
  /** 条目级文档链接（绝对 URL，全量契约与示例的详情入口） */
  docs?: string;
}

/** 应用视觉资产 */
export interface AppManifestAssets {
  /** 图标（标准方块按钮用，正方形） */
  icon: string;
  /** 封面图（应用主页用） */
  cover?: string;
  /** 背景图（应用主页用） */
  banner?: string;
}

/** 应用附加链接 */
export interface AppManifestLinks {
  /** 文档链接 */
  docs?: string;
  /** 开源仓库链接 */
  source?: string;
  /** 支持 / 反馈链接 */
  support?: string;
}

/**
 * AppManifest — 子产品自述契约（声明形态）
 *
 * 子产品以 JSON 形式声明自身介绍，宿主编排后经 resolveAppCatalog
 * 合并为 ResolvedApp（消费方可直接渲染）。
 */
export interface AppManifest {
  /** 契约版本（当前仅支持 "1.0"） */
  schemaVersion: string;
  /**
   * API 清单（可选，缺省 []）：子产品自述"本应用提供哪些 API"，
   * 供宿主 API 展示版面消费；条目 id 应用内唯一，重复抛错
   */
  apis?: AppApiEntry[];
  app: {
    /** 唯一标识（如 "wanyanai"），应与编排 entry.id 一致 */
    id: string;
    /** 应用名 */
    name: string;
    /** 一句话简介（卡片用）；缺省回退 description */
    tagline?: string;
    /** 详细介绍（应用主页用） */
    description: string;
    /** 访问链接 */
    href: string;
    /** 状态；缺省 "live" */
    status?: AppManifestStatus;
    /** 视觉资产；icon 必填 */
    assets: AppManifestAssets;
    /** 标签；缺省 [] */
    tags?: string[];
    /** 附加链接 */
    links?: AppManifestLinks;
  };
}

/**
 * 编排条目 — 宿主侧声明"如何展示一个子产品"
 *
 * manifest 为子产品自述（已解析对象或 JSON 字符串）；
 * name / status 为非空时覆盖 manifest 声明（如宿主以品牌名
 * "万言 AI 文坛"覆盖子产品自述 "WanyanAI"）。
 */
export interface AppCatalogEntry {
  /** 唯一标识（编排与去重的权威键） */
  id: string;
  /** 子产品自述 manifest（已解析对象或 JSON 字符串） */
  manifest: AppManifest | string;
  /** 编排覆盖显示名 */
  name?: string;
  /** 编排覆盖状态 */
  status?: AppManifestStatus;
  /** 编排顺序（数值升序在前；未设置按 id 稳定排后） */
  order?: number;
  /** 编排隐藏（默认 false；仍返回，由消费方过滤） */
  hidden?: boolean;
}

/**
 * API 接入要点条目（解析后形态）：required 经归一化后恒存在。
 */
export interface ResolvedAppApiNote extends AppApiNote {
  /** 是否必填（恒为 boolean；缺省归一化为 false） */
  required: boolean;
}

/**
 * API 条目（解析后形态）：method / tags / request / response / errors
 * 经归一化后恒存在（消费方无需判 undefined）。
 */
export interface ResolvedAppApiEntry extends AppApiEntry {
  /** HTTP 方法（恒存在，缺省归一化为 "GET"） */
  method: AppApiMethod;
  /** 分组标签（恒为数组） */
  tags: string[];
  /** 请求要点（恒为数组，缺省 []） */
  request: ResolvedAppApiNote[];
  /** 响应要点（恒为数组，缺省 []） */
  response: ResolvedAppApiNote[];
  /** 条目级差异错误（恒为数组，缺省 []） */
  errors: AppApiError[];
}

/**
 * 解析后的标准卡片数据 — 消费方直接渲染形态
 *
 * 归一化保证：tagline 回退 description、tags 恒为数组、
 * links 缺省字段恒为 undefined、status 恒为合法枚举、
 * apis 恒为数组（条目 method 缺省 GET、tags / request / response / errors
 * 缺省 []、required 缺省 false、auth / docs 缺省 undefined）。
 */
export interface ResolvedApp {
  /** 唯一标识 */
  id: string;
  /** 应用名（编排覆盖优先） */
  name: string;
  /** 一句话简介（tagline 缺省回退 description） */
  tagline: string;
  /** 详细介绍 */
  description: string;
  /** 访问链接 */
  href: string;
  /** 状态（编排覆盖优先） */
  status: AppManifestStatus;
  /** 视觉资产 */
  assets: AppManifestAssets;
  /** 标签（恒为数组） */
  tags: string[];
  /** API 清单（恒为数组，缺省 []；条目为解析后归一化形态） */
  apis: ResolvedAppApiEntry[];
  /** 附加链接（缺省字段为 undefined） */
  links: AppManifestLinks;
  /** 编排顺序（未设置为 undefined） */
  order: number | undefined;
  /** 编排隐藏标志（默认 false） */
  hidden: boolean;
}

/** resolveAppCatalog 选项 */
export interface ResolveAppCatalogOptions {
  /**
   * manifest 解析失败时的行为：
   * true = console.warn 并跳过该条目；false = 抛错（默认，fail-fast，构建期友好）
   */
  skipInvalid?: boolean;
}
