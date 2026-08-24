# 应用目录契约（AppManifest v1）

> 版本：v1.0（2026-08-24）
> 单一事实源：本文件 + [src/app/manifest.ts](../src/app/manifest.ts) zod schema 与类型定义。
> 适用范围：集群子产品（如 WanyanAI）自述"应用介绍"的契约；宿主（如用户中心）聚合后标准渲染、随意编排。
> 形态：**Headless 纯数据层**——只提供契约、解析器与聚合纯函数，不涉及任何渲染组件。

---

## 1. 设计动机

用户中心首页的服务卡片目前由宿主硬编码维护（名称、简介、头像均存于用户中心），子产品无法自述自身介绍。本契约将"展示信息的单一事实源"交还给子产品：

```
子产品（按契约声明 AppManifest）       宿主（消费 ResolvedApp）
┌─────────────────────────────┐      ┌──────────────────────────────┐
│ app-manifest.json           │      │ 编排条目 AppCatalogEntry[]    │
│  ├ 应用名 / 简介 / 链接     │ ───► │  ├ 展示哪些 / 顺序 / 覆盖     │
│  ├ 图标 / 封面 / 背景       │ 合并 │  └─► resolveAppCatalog()      │
│  └ 状态 / 标签 / 附加链接   │      │       ↓                       │
└─────────────────────────────┘      │  ResolvedApp[]（标准卡片数据）│
                                     └──────────────────────────────┘
```

新增子产品只需按契约实现，宿主即可标准渲染、随意编排，无需修改宿主代码。

---

## 2. 契约字段明细（AppManifest v1）

### 2.1 顶层

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `schemaVersion` | string | ✓ | 契约版本；当前仅支持 `"1.0"`，其余抛错（`APP_MANIFEST_VERSION_UNSUPPORTED`） |
| `app` | object | ✓ | 应用介绍主体（见 2.2） |

### 2.2 `app` 命名空间

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `id` | string | ✓ | 唯一标识（如 `"wanyanai"`）；应与宿主编排条目 `id` 一致 |
| `name` | string | ✓ | 应用名（非空） |
| `tagline` | string | - | 一句话简介（标准方块卡片用）；缺省回退 `description` |
| `description` | string | ✓ | 详细介绍（应用主页用，非空） |
| `href` | string | ✓ | 访问链接（非空） |
| `status` | enum | - | `live` / `beta` / `coming_soon` / `maintenance`；缺省 `"live"` |
| `assets` | object | ✓ | 视觉资产（见 2.3）；`icon` 必填 |
| `tags` | string[] | - | 标签；缺省 `[]` |
| `links` | object | - | 附加链接（见 2.4）；全部可选 |

### 2.3 `assets` 视觉资产

| 字段 | 类型 | 必填 | 语义 |
|---|---|---|---|
| `icon` | string | ✓ | 图标（标准方块按钮用，正方形） |
| `cover` | string | - | 封面图（应用主页用） |
| `banner` | string | - | 背景图（应用主页用） |

### 2.4 `links` 附加链接

| 字段 | 类型 | 语义 |
|---|---|---|
| `docs` | string | 文档链接 |
| `source` | string | 开源仓库链接 |
| `support` | string | 支持 / 反馈链接 |

---

## 3. 示例 manifest

```json
{
  "schemaVersion": "1.0",
  "app": {
    "id": "wanyanai",
    "name": "WanyanAI",
    "tagline": "AI 驱动的文本诊断专家",
    "description": "插件化智能文本分析平台，框架开源，功能插件支持按需定制。",
    "href": "https://wanyan.coze.site",
    "status": "live",
    "assets": {
      "icon": "/icons/wanyanai.png",
      "cover": "/covers/wanyanai.png",
      "banner": "/banners/wanyanai.png"
    },
    "tags": ["开源框架", "可定制"],
    "links": {
      "docs": "https://wanyan.coze.site/docs",
      "source": "https://github.com/suzvka/WanyanAI"
    }
  }
}
```

---

## 4. API 使用

### 4.1 解析（子产品侧自检 / 宿主侧导入）

```ts
import { parseAppManifest, appManifestSchema } from "yunzone-service-kit/app";

// JSON 或对象输入；解析失败抛 AppManifestError（code APP_MANIFEST_INVALID）
const manifest = parseAppManifest(rawJson, "wanyanai/manifest.json");

// 宿主侧可扩展 schema 附加私有字段
const extended = appManifestSchema.extend({ private: z.string().optional() });
```

解析归一化：`status` → `"live"`、`tags` → `[]`（缺省时）。

### 4.2 聚合（宿主侧编排）

```ts
import { resolveAppCatalog } from "yunzone-service-kit/app";

const apps = resolveAppCatalog([
  {
    id: "wanyanai",
    manifest: wanyanaiManifest,          // 已解析对象或 JSON 字符串
    order: 1,
    name: "万言 AI 文坛",                 // 可选：覆盖子产品自述名
  },
  {
    id: "rimlife",
    manifest: rimlifeManifest,
    order: 2,
    status: "coming_soon",               // 可选：覆盖状态
    hidden: false,
  },
]);
// → ResolvedApp[]：排序（order 升序在前，无 order 按 id 稳定排后）、
//   tagline 回退 description、links 缺省字段为 undefined
```

行为规范：

- **重复 `id`** 抛错（`APP_CATALOG_DUPLICATE_ID`，fail-fast，防止编排配置错误）
- **解析失败** 默认抛错（构建期友好）；`{ skipInvalid: true }` 时 `console.warn` 并跳过该条目
- 纯同步、无副作用、幂等

### 4.3 错误码

| code | 场景 |
|---|---|
| `APP_MANIFEST_INVALID` | manifest 解析失败（message 含 zod 字段路径诊断与可选 source 标注） |
| `APP_MANIFEST_VERSION_UNSUPPORTED` | `schemaVersion` 非当前支持版本 |
| `APP_CATALOG_DUPLICATE_ID` | 编排条目重复 `id` |

---

## 5. 标准端点约定

子产品在标准路径暴露 manifest，消费方（如用户中心）按该路径拉取：

```
https://<子产品域名>/.well-known/app-manifest.json
```

- **路径**：`/.well-known/app-manifest.json`（RFC 8615 well-known 前缀；常量 `APP_MANIFEST_WELL_KNOWN_PATH`）
- **托管方式二选一**：
  - **kit 托管**（推荐，一行接入）：`createAppManifestHandler`（`yunzone-service-kit/app/next`）——每次请求契约校验（非法 manifest 返回 500 `APP_MANIFEST_INVALID`）、统一响应头（`Cache-Control: public, max-age=300`）；支持函数式 manifest（运行时动态状态）
    ```ts
    // src/app/.well-known/app-manifest.json/route.ts
    import { createAppManifestHandler } from "yunzone-service-kit/app/next";
    import manifest from "@/manifest/app-manifest.json";
    export const GET = createAppManifestHandler({ manifest });
    ```
  - **静态文件**：manifest 完全静态时直接放置 `public/.well-known/app-manifest.json`（Next.js 静态托管，零代码）
- 消费方拉取示例：`https://wanyan.coze.site/.well-known/app-manifest.json`

---

## 6. 版本策略

- 契约版本经 `schemaVersion` 显式声明；当前仅支持 `"1.0"`。
- 新增字段只允许为可选字段，且不得改变既有字段的类型与语义（向前兼容，与 Token Authority 契约同规）。
- 宿主解析器对旧版本保持兼容；不支持的新版本由解析器显式抛错，禁止静默降级。
