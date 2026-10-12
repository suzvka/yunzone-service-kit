/**
 * 管理后台公共逻辑（纯逻辑，零框架耦合）
 *
 * 集群统一语义（v2.0 Admin Keybook Protocol，见 docs/admin-keybook-protocol.md）：
 * - ADMIN_KEYBOOK 未设置 = 管理后台禁用（503），禁止任何默认回退；
 * - 密码本 = 公钥清单（Ed25519），本身非秘密——泄露不能伪造签名；
 *   私钥由管理员持有（登录伴侣本地导入），**从不上网**；
 * - 密码本仅在进程启动时一次性加载（见 ./runtime.ts），换本须重启，
 *   且指纹变化后全部旧会话立即失效；
 * - 登录为挑战应答：服务器发一次性 challenge 令牌（HMAC 无状态 + 短窗口 +
 *   host 通道绑定），客户端签规范串，服务器查密码本验签后签发会话；
 * - 会话格式沿用 v1.0 HMAC-SHA256 签名（防伪造、无状态、多实例自动可用），
 *   secret 改由密码本指纹派生：`sha256hex("admin-session:" + fingerprint)`；
 * - ADMIN_SESSION_MAX_AGE 控制会话有效期（秒），默认 86400（24h）。
 *
 * 路由守卫（requireAdminAuth）属框架适配层，见独立入口 ops/next.ts。
 */

import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import { AdminKeybookError } from "./errors";

/** 管理后台会话 cookie 名（协议统一） */
export const ADMIN_SESSION_COOKIE = "admin_session";

/** 会话默认有效期（秒）：24h */
export const ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

/** challenge 默认有效期（秒）：120s 短窗口 */
export const ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS = 120;

/** 密码本 schema 版本（当前唯一受支持形态） */
export const ADMIN_KEYBOOK_VERSION = 1;

/** key id 字符集（进规范串与排序，禁止 `.` 以免歧义） */
const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,63}$/;
/** base64url 字符集（Buffer 解码宽松，须显式校验 + 回环比较收紧） */
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

// ────────────────────────────────────────────────────────────
// 密码本：类型 / 解析 / 加载 / 指纹
// ────────────────────────────────────────────────────────────

/** 密码本单条公钥（`publicKeyB64` = 32 字节 raw Ed25519 公钥的 base64url） */
export interface AdminKeybookKey {
  id: string;
  publicKeyB64: string;
  /** 展示用标签（不参与指纹计算） */
  label?: string;
  /** 录入时间（展示/审计用，不参与指纹计算） */
  addedAt?: string;
  /** 撤销标记：非空即撤销——验签一律拒绝，但仍计入指纹 */
  revokedAt?: string | null;
}

/** 已加载并校验的密码本 */
export interface LoadedAdminKeybook {
  keys: AdminKeybookKey[];
  /** 规范化序列化后的 SHA-256 十六进制指纹（会话/challenge 派生的种子） */
  fingerprint: string;
  /** 加载时间（毫秒，诊断用） */
  loadedAt: number;
}

/** 是否已撤销（revokedAt 非空即撤销，不做时间语义——撤销即编辑密码本 + 重启） */
export function isAdminKeyRevoked(key: AdminKeybookKey): boolean {
  return key.revokedAt !== undefined && key.revokedAt !== null && key.revokedAt !== "";
}

/**
 * 规范化序列化：按 id 排序，仅取影响认证的字段（id / publicKeyB64 / revokedAt）。
 * 展示元数据（label / addedAt）变化不改变指纹——改标签不应导致全员会话失效。
 */
export function canonicalKeybookSerialize(keys: AdminKeybookKey[]): string {
  const sorted = [...keys].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(
    sorted.map((k) => [k.id, k.publicKeyB64, isAdminKeyRevoked(k) ? k.revokedAt : null])
  );
}

/** 计算密码本指纹（sha256hex of 规范化序列化） */
export function computeKeybookFingerprint(keys: AdminKeybookKey[]): string {
  return createHash("sha256").update(canonicalKeybookSerialize(keys)).digest("hex");
}

/**
 * 解析并校验密码本 JSON（形态见 docs/admin-keybook-protocol.md §2）。
 *
 * 拒绝：非 version 1、keys 缺失/空数组/超上限、id 非法或重复、
 * public_key 非 base64url 或解码后长度 ≠ 32 字节。错误消息只报字段路径。
 */
export function parseAdminKeybook(raw: string): LoadedAdminKeybook {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new AdminKeybookError(
      "[service-kit/ops] parseAdminKeybook: 密码本内容不是合法 JSON（形态见 docs/admin-keybook-protocol.md）"
    );
  }
  return loadedFromDocument(doc);
}

/** 从已解析的 JSON 文档装配密码本（adminctl 与加载器共用） */
export function loadedFromDocument(
  doc: unknown,
  loadedAt: number = Date.now()
): LoadedAdminKeybook {
  if (typeof doc !== "object" || doc === null) {
    throw new AdminKeybookError("[service-kit/ops] 密码本必须是 JSON 对象");
  }
  const obj = doc as Record<string, unknown>;
  if (obj.version !== ADMIN_KEYBOOK_VERSION) {
    throw new AdminKeybookError(
      `[service-kit/ops] 密码本 version 不支持：期望 ${ADMIN_KEYBOOK_VERSION}，实际 ${String(obj.version)}`
    );
  }
  if (!Array.isArray(obj.keys)) {
    throw new AdminKeybookError("[service-kit/ops] 密码本 keys 必须是数组");
  }
  if (obj.keys.length === 0) {
    throw new AdminKeybookError(
      "[service-kit/ops] 密码本 keys 为空：空密码本等同禁用，请删除 ADMIN_KEYBOOK 显式禁用管理后台"
    );
  }
  if (obj.keys.length > 1000) {
    throw new AdminKeybookError("[service-kit/ops] 密码本 keys 超过上限 1000");
  }

  const seen = new Set<string>();
  const keys: AdminKeybookKey[] = obj.keys.map((entry, index) => {
    const where = `keys[${index}]`;
    if (typeof entry !== "object" || entry === null) {
      throw new AdminKeybookError(`[service-kit/ops] 密码本 ${where} 必须是对象`);
    }
    const e = entry as Record<string, unknown>;
    const id = e.id;
    if (typeof id !== "string" || !KEY_ID_RE.test(id)) {
      throw new AdminKeybookError(
        `[service-kit/ops] 密码本 ${where}.id 非法（允许 [A-Za-z0-9][A-Za-z0-9_:-]{0,63}，不得含点号）`
      );
    }
    if (seen.has(id)) {
      throw new AdminKeybookError(`[service-kit/ops] 密码本存在重复 id："${id}"`);
    }
    seen.add(id);

    const publicKeyB64 = e.public_key;
    if (
      typeof publicKeyB64 !== "string" ||
      !B64URL_RE.test(publicKeyB64) ||
      Buffer.from(publicKeyB64, "base64url").length !== 32 ||
      Buffer.from(publicKeyB64, "base64url").toString("base64url") !== publicKeyB64
    ) {
      throw new AdminKeybookError(
        `[service-kit/ops] 密码本 ${where}.public_key 非法（须为 32 字节 raw Ed25519 公钥的 base64url）`
      );
    }

    const revokedAt =
      e.revoked_at === undefined || e.revoked_at === null
        ? undefined
        : typeof e.revoked_at === "string"
          ? e.revoked_at
          : null;
    if (e.revoked_at !== undefined && e.revoked_at !== null && typeof e.revoked_at !== "string") {
      throw new AdminKeybookError(`[service-kit/ops] 密码本 ${where}.revoked_at 必须是字符串或 null`);
    }

    const key: AdminKeybookKey = { id, publicKeyB64 };
    if (typeof e.label === "string") key.label = e.label;
    if (typeof e.added_at === "string") key.addedAt = e.added_at;
    if (revokedAt !== undefined) key.revokedAt = revokedAt;
    return key;
  });

  return { keys, fingerprint: computeKeybookFingerprint(keys), loadedAt };
}

/** 运行时 fetch 句柄（Node 18+；本地类型收窄，避免全局类型定义差异） */
type FetchLike = (
  input: string,
  init: { signal: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** 运行时文件读取句柄 */
type ReadFileLike = (path: string) => Promise<string>;

/** loadAdminKeybook 选项（均可注入用于测试） */
export interface LoadAdminKeybookOptions {
  /** HTTP(S) 来源取件句柄，默认 globalThis.fetch */
  fetchImpl?: FetchLike;
  /** 本地来源读取句柄，默认 node:fs/promises readFile(utf8) */
  readFileImpl?: ReadFileLike;
  /** HTTP(S) 来源超时毫秒，默认 10000 */
  timeoutMs?: number;
}

/** 来源是否为 http(s) URL（显式前缀分派，不嗅探） */
function isHttpUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** 消息脱敏：密码本 URL 可能含访问凭据（预签名 query），一律替换为占位符 */
function redactSource(message: string, source: string): string {
  return message.split(source).join("<keybook-url>");
}

/**
 * 加载密码本：`http(s)://` 前缀走 fetch（默认 10s 超时，非 2xx 抛错），
 * 其余按本地路径读取。结果只在进程启动时消费一次（见 ./runtime.ts），
 * 换本须重启。失败一律抛 AdminKeybookError，消息不回显 URL 凭据。
 */
export async function loadAdminKeybook(
  source: string,
  options: LoadAdminKeybookOptions = {}
): Promise<LoadedAdminKeybook> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new AdminKeybookError(
      "[service-kit/ops] loadAdminKeybook: ADMIN_KEYBOOK 为空（未配置即显式禁用管理后台）"
    );
  }

  let raw: string;
  if (isHttpUrl(trimmed)) {
    raw = await fetchKeybook(trimmed, options);
  } else {
    raw = await readKeybookFile(trimmed, options);
  }
  return parseAdminKeybook(raw);
}

/** HTTP(S) 来源取件（超时 + 非 2xx 抛错；消息脱敏） */
async function fetchKeybook(
  url: string,
  options: LoadAdminKeybookOptions
): Promise<string> {
  const candidate = options.fetchImpl ?? (globalThis as { fetch?: unknown }).fetch;
  if (typeof candidate !== "function") {
    throw new AdminKeybookError(
      "[service-kit/ops] loadAdminKeybook: 当前运行时缺少 fetch（Node 18+ 必需），无法从 URL 加载密码本"
    );
  }
  const fetchImpl = candidate as FetchLike;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000
  );
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new AdminKeybookError(
        `[service-kit/ops] loadAdminKeybook: 密码本远端来源返回 HTTP ${response.status}（来源已脱敏）`
      );
    }
    return await response.text();
  } catch (err) {
    if (err instanceof AdminKeybookError) throw err;
    throw new AdminKeybookError(
      `[service-kit/ops] loadAdminKeybook: 密码本远端取件失败（来源已脱敏）: ` +
        redactSource(err instanceof Error ? err.message : String(err), url),
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 本地来源读取（ENOENT 附迁移语义提示；消息可含路径——本地路径非凭据） */
async function readKeybookFile(
  path: string,
  options: LoadAdminKeybookOptions
): Promise<string> {
  const read = options.readFileImpl ?? ((p: string) => fsReadFile(p, "utf8"));
  try {
    return await read(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new AdminKeybookError(
      `[service-kit/ops] loadAdminKeybook: 密码本文件读取失败: ${path}` +
        `${code ? ` (${code})` : ""}（ADMIN_KEYBOOK 支持本地路径或 http(s) URL；` +
        `未配置即显式禁用管理后台）`,
      { cause: err }
    );
  }
}

// ────────────────────────────────────────────────────────────
// 配置解析（同步；密码本实际加载见 ./runtime.ts 的启动一次性装配）
// ────────────────────────────────────────────────────────────

/** 管理后台配置解析结果 */
export interface AdminConfig {
  /** 是否启用（ADMIN_KEYBOOK 未设置时为 false） */
  enabled: boolean;
  /** 管理后台路径前缀（ADMIN_PATH，默认 "/admin"） */
  path: string;
  /** 密码本来源（ADMIN_KEYBOOK，本地路径或 http(s) URL；未设置时为 null） */
  keybookSource: string | null;
  /** 会话有效期（秒，ADMIN_SESSION_MAX_AGE，默认 86400） */
  sessionMaxAgeSeconds: number;
}

/**
 * 解析管理后台配置。
 *
 * 语义统一：ADMIN_KEYBOOK 未设置 = 管理后台禁用（503），禁止任何回退。
 * 本函数只做同步 env 读取；来源可达性/形态校验由 initAdminRuntime 在启动时完成。
 */
export function resolveAdminConfig(
  env?: Record<string, string | undefined>
): AdminConfig {
  const e = env ?? process.env;
  const rawSource = e.ADMIN_KEYBOOK;
  const keybookSource = rawSource && rawSource.trim() !== "" ? rawSource.trim() : null;

  const rawMaxAge = e.ADMIN_SESSION_MAX_AGE;
  const parsedMaxAge = rawMaxAge ? Number(rawMaxAge) : undefined;
  const sessionMaxAgeSeconds =
    parsedMaxAge !== undefined &&
    Number.isFinite(parsedMaxAge) &&
    parsedMaxAge > 0
      ? parsedMaxAge
      : ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS;

  return {
    enabled: keybookSource !== null,
    path: e.ADMIN_PATH || "/admin",
    keybookSource,
    sessionMaxAgeSeconds,
  };
}

// ────────────────────────────────────────────────────────────
// 挑战应答：challenge 令牌 / 规范串 / 验签
// ────────────────────────────────────────────────────────────

/** 常量时间比较两个字符串（长度短路，防 timingSafeEqual 对不等长 buffer 抛异常） */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** challenge 签名密钥派生（独立域分隔，与会话 secret 不互用） */
export function deriveAdminChallengeSecret(fingerprint: string): string {
  return createHash("sha256")
    .update(`admin-challenge:${fingerprint}`)
    .digest("hex");
}

/** createAdminChallenge 返回的 challenge 应答体（直接 JSON 回给客户端） */
export interface AdminChallenge {
  /** 无状态令牌：`nonceB64.issuedAt.hmacSig`（三段 base64url/十进制，以 `.` 分隔） */
  token: string;
  /** 一次性随机数（token 首段，客户端组装规范串所需） */
  nonceB64: string;
  /** 签发时间（秒） */
  issuedAt: number;
  /** 有效期（秒）——客户端提示用，服务端校验为权威 */
  expiresIn: number;
}

/** createAdminChallenge 选项 */
export interface CreateAdminChallengeOptions {
  /** challenge 有效期（秒），默认 120 */
  maxAgeSeconds?: number;
  /** 当前时间（可注入用于测试），单位毫秒 */
  now?: number;
}

/**
 * 签发 challenge 令牌（协议 §3.1）。
 *
 * 无状态设计：sig = HMAC-SHA256(challengeSecret, `nonce.issuedAt.host`)，
 * host 通道绑定防跨服务重放；不用即随窗口自然过期，无服务端会话表。
 *
 * @param fingerprint 密码本指纹（initAdminRuntime 产物）
 * @param host 本次登录的服务宿主（请求 Host），参与签名绑定
 */
export function createAdminChallenge(
  fingerprint: string,
  host: string,
  options: CreateAdminChallengeOptions = {}
): AdminChallenge {
  const maxAgeSeconds =
    options.maxAgeSeconds ?? ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS;
  const issuedAt = Math.floor((options.now ?? Date.now()) / 1000);
  const nonceB64 = randomBytes(16).toString("base64url");
  const signature = createHmac(
    "sha256",
    deriveAdminChallengeSecret(fingerprint)
  )
    .update(`${nonceB64}.${issuedAt}.${host}`)
    .digest("base64url");
  return {
    token: `${nonceB64}.${issuedAt}.${signature}`,
    nonceB64,
    issuedAt,
    expiresIn: maxAgeSeconds,
  };
}

/**
 * 已用 nonce 存储（进程内 best-effort 防重放）。
 * mark 返回 false 表示该 nonce 已被使用（一次性消费）。
 * nowSeconds 可注入（与 verifyAdminChallenge 的 now 同源，保证测试时钟一致）。
 */
export interface AdminChallengeSeenStore {
  /** 登记 nonce；已存在（或超容挤出）返回 false */
  mark(nonceB64: string, expiresAt: number, nowSeconds?: number): boolean;
  /** 是否已登记且未过期 */
  has(nonceB64: string, nowSeconds?: number): boolean;
  /** 清空（测试隔离用） */
  clear(): void;
}

/** 创建进程内 nonce LRU（Map 插入序近似；超上限先清过期项、再挤最旧） */
export function createAdminChallengeSeenStore(
  options: { maxEntries?: number } = {}
): AdminChallengeSeenStore {
  const maxEntries = options.maxEntries ?? 1024;
  const seen = new Map<string, number>(); // nonce -> expiresAt（秒）
  const nowSec = (injected?: number) => injected ?? Math.floor(Date.now() / 1000);
  return {
    mark(nonceB64: string, expiresAt: number, nowSeconds?: number): boolean {
      const now = nowSec(nowSeconds);
      // 惰性清理：先剔除已过期项
      for (const [k, exp] of seen) {
        if (exp <= now) {
          seen.delete(k);
        }
      }
      if (seen.has(nonceB64)) {
        return false;
      }
      if (seen.size >= maxEntries) {
        const oldest = seen.keys().next();
        if (!oldest.done) {
          seen.delete(oldest.value);
        }
      }
      seen.set(nonceB64, expiresAt);
      return true;
    },
    has(nonceB64: string, nowSeconds?: number): boolean {
      const exp = seen.get(nonceB64);
      if (exp === undefined) return false;
      if (exp <= nowSec(nowSeconds)) {
        seen.delete(nonceB64);
        return false;
      }
      return true;
    },
    clear(): void {
      seen.clear();
    },
  };
}

/** 默认共享 nonce 存储（多实例无 sticky 时按实例各自生效，残余风险见协议 §3.4） */
export const defaultAdminChallengeSeenStore = createAdminChallengeSeenStore();

/** verifyAdminChallenge 选项 */
export interface VerifyAdminChallengeOptions {
  /** 密码本指纹（challenge secret 派生种子） */
  fingerprint: string;
  /** 服务宿主（与签发时一致，通道绑定校验） */
  host: string;
  /** challenge 有效期（秒），默认 120 */
  maxAgeSeconds?: number;
  /** 当前时间（可注入用于测试），单位毫秒 */
  now?: number;
  /** nonce 一次性存储，默认共享 store；传 null 跳过重放检查（仅测试/无状态场景） */
  seen?: AdminChallengeSeenStore | null;
}

/**
 * 校验 challenge 令牌（协议 §3.2 步骤 1）。
 *
 * 校验顺序：三段分隔符 → issuedAt 数值 → 时间窗 → host 绑定 →
 * 签名长度短路 + 常量时间比较 → nonce 一次性消费。
 * 通过返回 `{ nonceB64, issuedAt }`（nonce 已登记消费），任一失败返回 null。
 */
export function verifyAdminChallenge(
  token: string | undefined | null,
  options: VerifyAdminChallengeOptions
): { nonceB64: string; issuedAt: number } | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [nonceB64, issuedAtStr, signature] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) {
    return null;
  }

  const maxAgeSeconds =
    options.maxAgeSeconds ?? ADMIN_CHALLENGE_DEFAULT_MAX_AGE_SECONDS;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (now - issuedAt > maxAgeSeconds) {
    return null;
  }

  const expected = createHmac(
    "sha256",
    deriveAdminChallengeSecret(options.fingerprint)
  )
    .update(`${nonceB64}.${issuedAtStr}.${options.host}`)
    .digest("base64url");
  if (!safeEqual(signature, expected)) {
    return null;
  }

  const seen =
    options.seen === undefined ? defaultAdminChallengeSeenStore : options.seen;
  if (seen && !seen.mark(nonceB64, issuedAt + maxAgeSeconds, now)) {
    return null;
  }
  return { nonceB64, issuedAt };
}

/** buildAdminLoginMessage 参数 */
export interface BuildAdminLoginMessageParams {
  keyId: string;
  /** challenge 的 nonceB64（token 首段） */
  nonceB64: string;
  /** 服务宿主（与 challenge 签发一致） */
  host: string;
  /** 时间戳（秒），须落在 challenge 窗口内 */
  ts: number;
}

/**
 * 组装客户端签名规范串（协议 §3.2，浏览器伴侣与服务端逐字节一致）：
 * `v2.{key_id}.{nonceB64}.{host}.{ts}`
 */
export function buildAdminLoginMessage(
  params: BuildAdminLoginMessageParams
): string {
  return `v2.${params.keyId}.${params.nonceB64}.${params.host}.${params.ts}`;
}

/**
 * 密码本验签（协议 §3.2 步骤 2）。
 *
 * 已撤销条目（revokedAt 非空）一律拒绝；签名须为 64 字节 base64url
 * （长度短路 + 回环校验），JWK 构造 / verify 异常一律吞为 false。
 */
export function verifyKeybookSignature(
  keybook: LoadedAdminKeybook,
  keyId: string,
  message: string,
  signatureB64: string
): boolean {
  const entry = keybook.keys.find((k) => k.id === keyId);
  if (!entry || isAdminKeyRevoked(entry)) {
    return false;
  }
  if (
    typeof signatureB64 !== "string" ||
    !B64URL_RE.test(signatureB64)
  ) {
    return false;
  }
  const signature = Buffer.from(signatureB64, "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== signatureB64) {
    return false;
  }
  try {
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: entry.publicKeyB64 },
      format: "jwk",
    });
    return cryptoVerify(null, Buffer.from(message, "utf8"), publicKey, signature);
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// 会话：HMAC-SHA256 签名（格式沿用 v1.0，secret 派生物换为密码本指纹）
// ────────────────────────────────────────────────────────────

/** 会话载荷（u=登录主体 key id，i=随机 nonce，t=签发时间秒） */
export interface SignedAdminSessionPayload {
  u: string;
  i: string;
  t: number;
}

/**
 * 从密码本指纹派生会话签名密钥（协议 §4）。
 * 指纹参与派生 → 换本重启后所有旧会话立即失效。
 */
export function deriveAdminSessionSecret(fingerprint: string): string {
  return createHash("sha256")
    .update(`admin-session:${fingerprint}`)
    .digest("hex");
}

/**
 * 创建 HMAC-SHA256 签名会话（协议 §4）。
 * @param fingerprint 密码本指纹（仅在此参与 secret 派生，不写入会话）
 * @param keyId 会话主体（登录所用密码本条目 id），默认 "admin"
 * @param now 当前时间（可注入用于测试）
 */
export function createSignedAdminSession(
  fingerprint: string,
  keyId: string = "admin",
  now: number = Date.now()
): string {
  const payload: SignedAdminSessionPayload = {
    u: keyId,
    i: randomBytes(8).toString("hex"),
    t: Math.floor(now / 1000),
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = deriveAdminSessionSecret(fingerprint);
  const signature = createHmac("sha256", secret)
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

/** validateSignedAdminSession 选项 */
export interface ValidateSignedAdminSessionOptions {
  /** 会话有效期（秒），默认 86400（24h） */
  maxAgeSeconds?: number;
  /** 当前时间（可注入用于测试），单位毫秒 */
  now?: number;
}

/**
 * 校验 HMAC 签名会话（协议 §4），返回会话主体 key id 或 null。
 *
 * 校验顺序：恰好 1 个 `.` 分隔符 → 签名长度短路 + 常量时间比较
 * → 载荷 JSON 解析与结构检查 → 过期检查。任一环节失败返回 null。
 */
export function validateSignedAdminSession(
  session: string | undefined | null,
  fingerprint: string,
  options: ValidateSignedAdminSessionOptions = {}
): string | null {
  if (!session) {
    return null;
  }

  const parts = session.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [payloadStr, signature] = parts;

  const expectedSignature = createHmac(
    "sha256",
    deriveAdminSessionSecret(fingerprint)
  )
    .update(payloadStr)
    .digest("base64url");
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  let payload: SignedAdminSessionPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString("utf8")
    ) as SignedAdminSessionPayload;
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.u !== "string" ||
    typeof payload.t !== "number"
  ) {
    return null;
  }

  const maxAgeSeconds =
    options.maxAgeSeconds ?? ADMIN_SESSION_DEFAULT_MAX_AGE_SECONDS;
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  if (now - payload.t > maxAgeSeconds) {
    return null;
  }

  return payload.u;
}
