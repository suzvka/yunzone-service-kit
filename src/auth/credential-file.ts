/**
 * 产品凭证文件加载（单渠道交付物装配器）
 *
 * 集群约定：产品凭证文件是产品接入集群的**唯一配置交付物**——注册/轮换时由
 * 签发方（产品中心）一次性下发（明文 apiKey 仅存在于签发/轮换响应，服务端只存
 * hash，事后无任何补发路径），放置到服务目录后由本模块装配——等效于"自动填好
 * 环境变量"：kit 只做形态校验与结构化装配，**不消费、不解释任何段的内容语义**，
 * 各消费方按需取用自己关心的段。环境变量渠道（AUTH_CENTER_* 三要素）已随
 * authCenterFacet 退役，不再受支持。
 *
 * 来源模型（0.30：单渠道不变，来源可换）：凭证是**静态内容**，来源显式二选一——
 * 本地文件（默认；AUTH_CENTER_CREDENTIAL_FILE 指示路径）或远端 URL
 * （AUTH_CENTER_CREDENTIAL_URL；与文件键互斥，同时设置即抛错）。两种来源统一走
 * **进程内缓存快照**：首次读取或 refreshAuthCenterCredential() 把来源内容装入缓存，
 * 此后加载一律走缓存；更新生效点 = 进程重启或显式刷新。远端取件失败与「缺失」同
 * 语义（读侧走 ENOENT 分支，不新增错误族）；URL 含访问凭据，任何消息不回显。
 * 缓存挂载于 globalThis：CJS/ESM 双构建实例共享同一缓存（dual-package 安全）。
 *
 * 文件形态（v2，0.32 起强切；单一命名源 = OAuth 2.0 协议术语，RFC 6749）：
 * 文件命名沿用合一时代的历史名（auth-center.credential.json），段 = 各签发方的语义域：
 * - 鉴权段（顶层 authCenterUrl + authCenterApiKey，成对可选）：yunzone_auth 服务凭证
 *   （sk-auth-<id>.<key> 自编码，凭证 id 即签发者身份，DESIGN.md §4.2）；
 *   匿名 introspect 消费方（只需公开视图：active / productId 均为契约公开字段，
 *   token-contract §3.1）可整段省略——无鉴权段形态为合法交付物（如产品中心
 *   自助台首签未开 issueAuthCredential 的产品凭证）；只设其一即校验失败
 *   （齐套惯例，对齐 /config storage credentials）；
 * - OAuth 客户端段（顶层 clientId + clientSecret + clientName）：客户端身份与密钥，
 *   字段名与协议参数 client_id / client_secret 同词源——文档与消费方无需"X 即 Y"翻译；
 *   管理员凭证无 clientSecret（clientRole 标记角色）；
 * - 产品段（product，可选）：产品在产品中心的权威指代（product.id 轮换不变），
 *   消费方据此自指（如 claims.productId、归属校验）；管理员凭证等非产品交付物无此段；
 * - 产品中心段（productCenter，可选）：产品中心服务地址（baseUrl）；调产品中心
 *   v1 的 Bearer 复用 clientSecret——同一枚产品凭证的两个角色，不再单独命名字段。
 *
 * 形态迁移（v1 → v2 强切）：v1 字段（顶层 apiKey / client.id / productCenter.apiKey）
 * 不再受支持；遇到 v1 形态即校验失败，消息附迁移指引（字段重排脚本或重新签发）。
 *
 * 安全约定（与 /config 的 dotenv、envSnapshot 同哲学）：
 * - 文件含明文 apiKey，必须加入 .gitignore；本模块加载时做启发式检查并提示（非保证）；
 * - 错误信息只报文件路径与字段名，**绝不回显凭证值**；
 * - 文件内 expiresAt 仅为签发时快照，仅供展示，
 *   运行时有效性一律以 introspect 结果为准（去产品化后新签发凭证恒无过期）。
 *
 * 未知字段一律忽略（向前兼容）：未来新增字段只允许可选，不改变既有字段语义。
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";

/** 凭证文件缺失 / 解析失败 / 校验失败（message 不带凭证值） */
export class CredentialFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialFileError";
  }
}

/** 默认凭证文件路径（相对服务目录 / cwd） */
export const DEFAULT_CREDENTIAL_FILE = "auth-center.credential.json";

/** 远端来源环境变量：显式设置即启用远端来源（与文件键互斥，成对检查） */
export const AUTH_CENTER_CREDENTIAL_URL_ENV = "AUTH_CENTER_CREDENTIAL_URL";

/** 本地来源环境变量：指示凭证文件路径（可被 options.path 覆盖） */
export const AUTH_CENTER_CREDENTIAL_FILE_ENV = "AUTH_CENTER_CREDENTIAL_FILE";

/** 远端来源展示标识（不含 URL：URL 含访问凭据，禁止回显） */
const REMOTE_SOURCE_DISPLAY = "remote://auth-center.credential.json";

/** 凭证来源（解析结果：本地文件 | 远端 URL） */
type CredentialSource =
  | { kind: "file"; path: string; display: string; cacheKey: string }
  | { kind: "url"; url: string; display: string; cacheKey: string };

/**
 * 解析凭证来源（显式，不嗅探）：
 * 1. AUTH_CENTER_CREDENTIAL_URL 与 AUTH_CENTER_CREDENTIAL_FILE 同时设置 → 抛错（显式二选一）；
 * 2. URL 设置 → 远端来源（options.path 忽略）；
 * 3. 否则文件来源：options.path ?? AUTH_CENTER_CREDENTIAL_FILE ?? DEFAULT_CREDENTIAL_FILE。
 */
function resolveCredentialSource(explicitPath?: string): CredentialSource {
  const url = process.env[AUTH_CENTER_CREDENTIAL_URL_ENV];
  const fileEnv = process.env[AUTH_CENTER_CREDENTIAL_FILE_ENV];
  if (url && fileEnv) {
    throw new CredentialFileError(
      `[service-kit/auth] credential source conflict: ${AUTH_CENTER_CREDENTIAL_URL_ENV} ` +
        `and ${AUTH_CENTER_CREDENTIAL_FILE_ENV} are both set（显式二选一：远端 URL 或本地路径）`
    );
  }
  if (url) {
    return { kind: "url", url, display: REMOTE_SOURCE_DISPLAY, cacheKey: `url:${url}` };
  }
  const raw = explicitPath ?? fileEnv ?? DEFAULT_CREDENTIAL_FILE;
  const abs = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  return { kind: "file", path: abs, display: abs, cacheKey: `file:${abs}` };
}

/** 进程级共享缓存状态（dual-package 安全：CJS/ESM 双实例共享同一份） */
interface CredentialCacheState {
  /** 来源内容缓存（key = 来源标识；值 = 来源原始文本，校验/装配仍在读取时进行） */
  sources: Map<string, string>;
  /** 已提示过的文件路径（同路径只提示一次，防轮询刷屏） */
  gitIgnoreWarned: Set<string>;
}

/** globalThis 上的缓存状态键名（跨模块实例共享） */
const CREDENTIAL_CACHE_GLOBAL_KEY = "__yunzoneServiceKitAuthCredentialCache";

/** 读取进程级共享缓存状态（不存在则惰性创建） */
function cacheState(): CredentialCacheState {
  const store = globalThis as unknown as {
    [CREDENTIAL_CACHE_GLOBAL_KEY]?: CredentialCacheState;
  };
  if (!store[CREDENTIAL_CACHE_GLOBAL_KEY]) {
    store[CREDENTIAL_CACHE_GLOBAL_KEY] = {
      sources: new Map(),
      gitIgnoreWarned: new Set(),
    };
  }
  return store[CREDENTIAL_CACHE_GLOBAL_KEY];
}

/** 测试专用：清空来源缓存与 .gitignore 提示记忆（同进程重复用例时保证隔离） */
export function resetAuthCenterCredentialCacheForTest(): void {
  const state = cacheState();
  state.sources.clear();
  state.gitIgnoreWarned.clear();
}

/**
 * 凭证文件 schema（v2 形态；单一命名源 = OAuth 2.0 协议术语，RFC 6749）：
 * - 鉴权段（authCenterUrl + authCenterApiKey）成对可选：整段省略 = 匿名 introspect 形态；只设其一即校验失败；
 * - OAuth 客户端段：clientId 必填（协议参数 client_id 同词源）；clientSecret 可选
 *   （管理员凭证无 secret）；clientName / clientRole 为展示与角色元数据；
 * - product / productCenter 为可选段（存在即整段装配，段内字段齐备性按段校验）；
 * - version / type / issuer / endpoints 等签发元数据为未知字段，被 zod 默认剥离（不报错）；
 * - v1 形态（apiKey / client.id / productCenter.apiKey）强切不再支持，见 looksLikeV1。
 */
const credentialFileSchema = z
  .object({
    /** 鉴权段（成对可选）：整段省略 = 匿名 introspect 形态；只设其一即校验失败 */
    authCenterUrl: z.string().min(1, "不能为空").optional(),
    authCenterApiKey: z.string().min(1, "不能为空").optional(),
    clientId: z.string().min(1, "不能为空"),
    clientSecret: z.string().min(1, "不能为空").optional(),
    clientName: z.string().optional(),
    clientRole: z.string().optional(),
    /** 产品段（可选）：产品权威指代（product.id 轮换不变，产品中心独家权威） */
    product: z
      .object({
        id: z.string().min(1, "不能为空"),
        name: z.string().optional(),
      })
      .optional(),
    /** 产品中心段（可选）：产品中心服务地址（调产品中心 v1 的 Bearer 复用 clientSecret） */
    productCenter: z
      .object({
        baseUrl: z.string().min(1, "不能为空"),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    // 鉴权段齐套校验（成对出现，同设同缺）：拆开即配置不完整，
    // 禁止隐式降级（惯例对齐 /config storage 的凭证齐套语义）
    const hasUrl = value.authCenterUrl !== undefined;
    const hasKey = value.authCenterApiKey !== undefined;
    if (hasUrl !== hasKey) {
      const missing = hasUrl ? "authCenterApiKey" : "authCenterUrl";
      ctx.addIssue({
        code: "custom",
        message:
          `鉴权段不完整：检测到 ${hasUrl ? "authCenterUrl" : "authCenterApiKey"} 但缺 ${missing}` +
          `（鉴权段必须成对出现；匿名 introspect 形态请整段省略）`,
        path: [missing],
      });
    }
  });

/** loadAuthCenterCredential 选项 */
export interface LoadAuthCenterCredentialOptions {
  /**
   * 凭证文件路径（仅文件来源生效），默认取 `AUTH_CENTER_CREDENTIAL_FILE`，
   * 再缺省 `<cwd>/auth-center.credential.json`；相对路径按 cwd 解析。
   * 远端来源（`AUTH_CENTER_CREDENTIAL_URL` 已设置）时忽略本项。
   */
  path?: string;
  /**
   * 文件不存在时是否返回 null，默认 false。
   * 单渠道约定下，显式调用即"需要凭证"，缺失直接抛 CredentialFileError
   * （fail-fast，避免把配置缺失推迟成运行时 undefined）。
   * 文件存在但内容非法时无论该值如何都抛错。
   */
  optional?: boolean;
}

/** 产品凭证（从凭证文件装配，消费方按需取用各段；命名对齐 OAuth 2.0 协议术语） */
export interface AuthCenterCredential {
  /**
   * 鉴权中心基础地址（尾部斜杠已归一化）。
   * 可选：无鉴权段形态（匿名 introspect 消费方，公开视图已覆盖 active/productId）
   * 不含本段；调鉴权中心端点的消费方需判空后传入 createAuthCenterClient。
   */
  authCenterUrl?: string;
  /**
   * 鉴权段服务凭证（Bearer，明文；sk-auth-<id>.<key> 自编码格式）。
   * 可选：与 authCenterUrl 成对出现（齐套校验，只设其一即校验失败）。
   */
  authCenterApiKey?: string;
  /**
   * OAuth 客户端身份（协议参数 client_id；产品中心 client_credential.id /
   * 鉴权中心 credentials.id，轮换保持稳定）
   */
  clientId: string;
  /** OAuth 客户端密钥（协议参数 client_secret；sk-pc-<id>.<key> 明文；管理员凭证无此字段） */
  clientSecret?: string;
  /** OAuth 客户端名称（展示用） */
  clientName?: string;
  /** 凭证角色（鉴权中心签发形态：admin / normal；产品凭证无此字段） */
  clientRole?: string;
  /** 产品段（文件含 product 段时装配）：产品权威指代，product.id 轮换不变 */
  product?: { id: string; name?: string };
  /** 产品中心段（文件含 productCenter 段时装配）：产品中心服务地址（尾部斜杠已归一化） */
  productCenter?: { baseUrl: string };
  /** 来源标识（诊断用，不含凭证值）：本地来源 = 绝对路径；远端来源 = 不含 URL 的稳定标识 */
  sourcePath: string;
}

/**
 * v1 旧形态特征检测（仅用于校验失败消息的迁移指引，不参与装配、不回显任何值）。
 * 强切窗口：v1 文件（2026-09 前签发）必须先字段重排为 v2 或重新签发方可加载。
 */
function looksLikeV1(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.apiKey === "string" && typeof obj.authCenterApiKey !== "string") return true;
  const client = obj.client;
  if (
    typeof client === "object" &&
    client !== null &&
    typeof (client as Record<string, unknown>).id === "string"
  ) {
    return true;
  }
  const productCenter = obj.productCenter;
  if (
    typeof productCenter === "object" &&
    productCenter !== null &&
    "apiKey" in (productCenter as Record<string, unknown>)
  ) {
    return true;
  }
  return false;
}

/**
 * 加载鉴权中心凭证文件。
 *
 * - `path`：默认 `<cwd>/auth-center.credential.json`
 * - `optional`：文件缺失时返回 null（默认缺失即抛）
 * - 失败时抛 CredentialFileError，message 包含文件路径与字段路径（不含凭证值）
 *
 * 类型重载：默认调用（无 options / optional 非 true）返回**非空**凭证
 * （单渠道语义：显式调用即需要凭证，缺失直接抛）；仅 `optional: true`
 * 时返回类型含 null，调用方自行收窄。
 */
export function loadAuthCenterCredential(
  options?: LoadAuthCenterCredentialOptions & { optional?: false }
): AuthCenterCredential;
export function loadAuthCenterCredential(
  options: LoadAuthCenterCredentialOptions & { optional: true }
): AuthCenterCredential | null;
export function loadAuthCenterCredential(
  options?: LoadAuthCenterCredentialOptions
): AuthCenterCredential | null {
  const source = resolveCredentialSource(options?.path);

  // 统一缓存快照：命中即用；未命中时文件来源可同步直读兜底（并装入缓存），
  // 远端来源记「缺失」语义（与 ENOENT 分支等价——取件失败不新增错误族）。
  const cache = cacheState().sources;
  let content = cache.get(source.cacheKey);
  if (content === undefined) {
    if (source.kind === "file") {
      try {
        content = readFileSync(source.path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          if (options?.optional) return null;
          throw new CredentialFileError(
            `[service-kit/auth] loadAuthCenterCredential: credential file not found: ${source.path} ` +
              `(凭证文件是服务凭证的唯一配置渠道：签发/轮换凭证时从鉴权中心管理后台下载，` +
              `放置到该路径并加入 .gitignore)`
          );
        }
        throw err;
      }
      cache.set(source.cacheKey, content);
    } else {
      if (options?.optional) return null;
      throw new CredentialFileError(
        `[service-kit/auth] loadAuthCenterCredential: remote credential not available ` +
          `(远端来源未预取或取件失败；本消息不展示 URL。请在启动流程调用 ` +
          `refreshAuthCenterCredential() 并确认远端可达)`
      );
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new CredentialFileError(
      `[service-kit/auth] loadAuthCenterCredential: credential content is not valid JSON: ${source.display}`
    );
  }

  const result = credentialFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new CredentialFileError(
      `[service-kit/auth] loadAuthCenterCredential: credential content validation failed: ` +
        `${source.display}. Issues: ${issues}（凭证文件形态见 docs/credential-file.md）` +
        (looksLikeV1(raw)
          ? "。检测到 v1 旧形态（apiKey / client.id / productCenter.apiKey）：v2 强切后不再支持，" +
            "请运行凭证文件迁移（字段重排，凭证值不变）或从签发方重新获取 v2 文件"
          : "")
    );
  }

  if (source.kind === "file") warnIfNotGitIgnored(source.path);

  return {
    // 鉴权段成对装配：无鉴权段形态下两键直接不存在（可选字段，消费方判空取用）
    ...(result.data.authCenterUrl
      ? { authCenterUrl: result.data.authCenterUrl.replace(/\/+$/, "") }
      : {}),
    ...(result.data.authCenterApiKey
      ? { authCenterApiKey: result.data.authCenterApiKey }
      : {}),
    clientId: result.data.clientId,
    clientSecret: result.data.clientSecret,
    clientName: result.data.clientName,
    clientRole: result.data.clientRole,
    product: result.data.product,
    productCenter: result.data.productCenter
      ? {
          baseUrl: result.data.productCenter.baseUrl.replace(/\/+$/, ""),
        }
      : undefined,
    sourcePath: source.display,
  };
}

/** refreshAuthCenterCredential 选项 */
export interface RefreshAuthCenterCredentialOptions {
  /** 显式文件路径（仅文件来源生效；语义同 loadAuthCenterCredential 的 path） */
  path?: string;
  /** 远端抓取超时毫秒（默认 10000；仅远端来源生效） */
  timeoutMs?: number;
}

/**
 * 从来源刷新凭证缓存（幂等；**永不抛错**——失败仅 console.warn，缓存不更新）。
 *
 * - 远端来源：fetch 取件成功才更新缓存（非 2xx / 网络失败 / 超时 → 缓存保持原值；
 *   冷启动时保持「无凭证」，读侧按缺失语义处理）；
 * - 文件来源：同步读取入缓存（读取失败 → 缓存保持原值）；
 * - 部署约定：各服务在启动流程调用一次（启动即部署，「部署时自动调一次」）；
 *   运行期热更新（如管理台刷新按钮）同样调用本函数。
 *
 * 消息脱敏：任何输出不回显远端 URL（本地文件路径不属于凭证值，可输出）。
 */
export async function refreshAuthCenterCredential(
  options?: RefreshAuthCenterCredentialOptions
): Promise<void> {
  let source: CredentialSource;
  try {
    source = resolveCredentialSource(options?.path);
  } catch (err) {
    console.warn(
      `[service-kit/auth] refreshAuthCenterCredential: 来源解析失败（缓存未更新）: ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  if (source.kind === "url") {
    await refreshFromUrl(source, options?.timeoutMs ?? 10_000);
    return;
  }

  try {
    cacheState().sources.set(source.cacheKey, readFileSync(source.path, "utf8"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.warn(
      `[service-kit/auth] refreshAuthCenterCredential: 文件读取失败（缓存未更新）: ` +
        `${source.display}${code ? ` (${code})` : ""}`
    );
  }
}

/** 运行时 fetch 句柄（Node 18+；本地类型收窄，避免全局类型定义差异） */
type FetchLike = (
  input: string,
  init: { signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** 从远端来源取件并更新缓存（失败仅告警；不回显 URL） */
async function refreshFromUrl(
  source: Extract<CredentialSource, { kind: "url" }>,
  timeoutMs: number
): Promise<void> {
  const fetchImpl = resolveRuntimeFetch();
  if (!fetchImpl) {
    console.warn(
      "[service-kit/auth] refreshAuthCenterCredential: 当前运行时缺少 fetch（Node 18+ 必需），缓存未更新"
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(source.url, { signal: controller.signal });
    if (!response.ok) {
      console.warn(
        `[service-kit/auth] refreshAuthCenterCredential: 远端来源返回 HTTP ${response.status}（缓存未更新；不展示 URL）`
      );
      return;
    }
    cacheState().sources.set(source.cacheKey, await response.text());
  } catch (err) {
    console.warn(
      `[service-kit/auth] refreshAuthCenterCredential: 远端来源取件失败（缓存未更新；不展示 URL）: ` +
        `${redactUrl(err instanceof Error ? err.message : String(err), source.url)}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 读取运行时 fetch（存在性检查 + 本地类型收窄） */
function resolveRuntimeFetch(): FetchLike | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof candidate === "function" ? (candidate as FetchLike) : null;
}

/** 错误消息脱敏：URL 含访问凭据，精确匹配替换为占位符 */
function redactUrl(message: string, url: string): string {
  return message.split(url).join("<remote-url>");
}

/**
 * 启发式检查凭证文件是否被 .gitignore 覆盖：未覆盖时 console.warn 一次。
 * 仅是提示非保证（gitignore 语义子集：精确名 / `*` 通配 / 目录前缀；不支持 `!` 反选、
 * `**` 与字符组）——真正的防泄漏以 .gitignore 维护约定为准。
 */
function warnIfNotGitIgnored(filePath: string): void {
  const warned = cacheState().gitIgnoreWarned;
  if (warned.has(filePath)) return;
  warned.add(filePath);
  try {
    // 从文件所在目录向上找最近的 .git（最多 5 层），在其同目录检查 .gitignore
    let dir = dirname(filePath);
    let gitRoot: string | null = null;
    for (let i = 0; i < 5 && !gitRoot; i++) {
      if (existsSync(join(dir, ".git"))) {
        gitRoot = dir;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!gitRoot) return;

    let lines: string[];
    try {
      lines = readFileSync(join(gitRoot, ".gitignore"), "utf8").split(/\r?\n/);
    } catch {
      lines = [];
    }

    const base = basename(filePath);
    const rel = relative(gitRoot, filePath).replace(/\\/g, "/");
    const covered = lines.some((line) => {
      const rule = line.trim();
      if (rule === "" || rule.startsWith("#") || rule.startsWith("!")) return false;
      if (rule === base || rule === rel) return true;
      if (rule.endsWith("/")) return rel.startsWith(rule);
      if (rule.includes("*")) {
        const pattern = rule
          .split("*")
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*");
        const re = new RegExp(`^${pattern}$`);
        return re.test(base) || re.test(rel);
      }
      return false;
    });

    if (!covered) {
      console.warn(
        `[service-kit/auth] credential file may be tracked by git: ${filePath}. ` +
          `凭证文件含明文 apiKey，请将 "${base}" 加入 .gitignore（本提示为启发式检查，仅供参考）`
      );
    }
  } catch {
    // 启发式检查失败静默跳过（不阻塞凭证加载）
  }
}
