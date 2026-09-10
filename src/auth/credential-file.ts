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
 * 文件分段（段 = 各签发方的语义域；文件命名沿用合一时代的历史名）：
 * - 鉴权段（顶层 authCenterUrl + apiKey）：yunzone_auth 服务凭证
 *   （sk-auth-<id>.<key> 自编码，凭证 id 即签发者身份，DESIGN.md §4.2）；
 * - 产品段（product，可选）：产品在产品中心的权威指代（product.id 轮换不变），
 *   消费方据此自指（如 claims.productId、归属校验）；管理员凭证等非产品交付物无此段；
 * - 产品中心段（productCenter，可选）：调产品中心 v1 的地址与 Bearer（sk-pc）；
 * - client 段：签发响应原样携带的元数据（productId 为合一时代兼容字段）。
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

/**
 * 凭证文件 schema（形态对齐签发/轮换响应体 + authCenterUrl，分段语义见文件头）：
 * - 顶层 version / type / issuer / endpoints 为签发响应原样携带的元数据，加载器不消费；
 * - 鉴权段（authCenterUrl + apiKey）必填——文件至少承载一枚可用的鉴权凭证；
 * - client.productId 为合一时代兼容字段（可选，新签发文件以 product.id 为权威指代）；
 * - product / productCenter 为可选段（存在即整段装配，段内字段齐备性按段校验）；
 * - 未知字段被 zod 默认剥离（不报错），保证旧加载器读新文件不炸。
 */
const credentialFileSchema = z.object({
  authCenterUrl: z.string().min(1, "不能为空"),
  apiKey: z.string().min(1, "不能为空"),
  client: z.object({
    productId: z.string().min(1, "不能为空").optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    expiresAt: z.string().nullable().optional(),
  }),
  /** 产品段（可选）：产品权威指代（product.id 轮换不变，产品中心独家权威） */
  product: z
    .object({
      id: z.string().min(1, "不能为空"),
      name: z.string().optional(),
    })
    .optional(),
  /** 产品中心段（可选）：调产品中心 v1 的地址与 Bearer（sk-pc） */
  productCenter: z
    .object({
      baseUrl: z.string().min(1, "不能为空"),
      apiKey: z.string().min(1, "不能为空"),
    })
    .optional(),
});

/** loadAuthCenterCredential 选项 */
export interface LoadAuthCenterCredentialOptions {
  /** 凭证文件路径，默认 `<cwd>/auth-center.credential.json`；相对路径按 cwd 解析 */
  path?: string;
  /**
   * 文件不存在时是否返回 null，默认 false。
   * 单渠道约定下，显式调用即"需要凭证"，缺失直接抛 CredentialFileError
   * （fail-fast，避免把配置缺失推迟成运行时 undefined）。
   * 文件存在但内容非法时无论该值如何都抛错。
   */
  optional?: boolean;
}

/** 产品凭证（从凭证文件装配，消费方按需取用各段） */
export interface AuthCenterCredential {
  /** 鉴权中心基础地址（尾部斜杠已归一化） */
  authCenterUrl: string;
  /** 服务凭证（Bearer，明文；去产品化后为 sk-auth-<id>.<key> 自编码格式） */
  apiKey: string;
  /** 凭证归属产品 ID（合一时代兼容字段，可选；权威指代见 product.id） */
  productId?: string;
  /** 凭证唯一标识（签发响应 client.id，新模型 = credentials.id） */
  clientId?: string;
  /** 凭证名称 */
  name?: string;
  /** 签发时快照的过期时间；仅供展示，运行时有效性以 introspect 为准（新模型恒 null） */
  expiresAt?: string | null;
  /** 产品段（文件含 product 段时装配）：产品权威指代，product.id 轮换不变 */
  product?: { id: string; name?: string };
  /** 产品中心段（文件含 productCenter 段时装配）：调产品中心 v1 的地址与 Bearer */
  productCenter?: { baseUrl: string; apiKey: string };
  /** 凭证文件绝对路径（诊断用，不含凭证值） */
  sourcePath: string;
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
  const filePath = isAbsolute(options?.path ?? DEFAULT_CREDENTIAL_FILE)
    ? (options?.path as string)
    : resolve(process.cwd(), options?.path ?? DEFAULT_CREDENTIAL_FILE);

  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      if (options?.optional) return null;
      throw new CredentialFileError(
        `[service-kit/auth] loadAuthCenterCredential: credential file not found: ${filePath} ` +
          `(凭证文件是服务凭证的唯一配置渠道：签发/轮换凭证时从鉴权中心管理后台下载，` +
          `放置到该路径并加入 .gitignore)`
      );
    }
    throw err;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new CredentialFileError(
      `[service-kit/auth] loadAuthCenterCredential: credential file is not valid JSON: ${filePath}`
    );
  }

  const result = credentialFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new CredentialFileError(
      `[service-kit/auth] loadAuthCenterCredential: credential file validation failed: ` +
        `${filePath}. Issues: ${issues}（凭证文件形态见 docs/credential-file.md）`
    );
  }

  warnIfNotGitIgnored(filePath);

  return {
    authCenterUrl: result.data.authCenterUrl.replace(/\/+$/, ""),
    apiKey: result.data.apiKey,
    productId: result.data.client.productId,
    clientId: result.data.client.id,
    name: result.data.client.name,
    expiresAt: result.data.client.expiresAt ?? null,
    product: result.data.product,
    productCenter: result.data.productCenter
      ? {
          ...result.data.productCenter,
          baseUrl: result.data.productCenter.baseUrl.replace(/\/+$/, ""),
        }
      : undefined,
    sourcePath: filePath,
  };
}

/** 已提示过的文件路径（同路径只提示一次，防轮询刷屏） */
const gitIgnoreWarned = new Set<string>();

/**
 * 启发式检查凭证文件是否被 .gitignore 覆盖：未覆盖时 console.warn 一次。
 * 仅是提示非保证（gitignore 语义子集：精确名 / `*` 通配 / 目录前缀；不支持 `!` 反选、
 * `**` 与字符组）——真正的防泄漏以 .gitignore 维护约定为准。
 */
function warnIfNotGitIgnored(filePath: string): void {
  if (gitIgnoreWarned.has(filePath)) return;
  gitIgnoreWarned.add(filePath);
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
