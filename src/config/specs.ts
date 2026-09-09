/**
 * 环境变量分面规范（Env Facets）
 *
 * 集群统一约定：环境变量按"服务角色"分面声明，服务通过 composeFacets 组合自己需要的面。
 *
 * - 所有分面字段全部 optional：延续"通用 envSchema 全部 optional"约定（缺省降级/懒加载），
 *   需要必填的模块用 requiredFacet 声明独立子 schema。
 * - 配置键命名规范（TICKET-001，三层命名空间模型）：
 *   - 通用契约命名空间（本文件声明的键）：一律中立命名，禁止以任何平台名
 *     （coze / vercel / render / aws 等）作为键名的一部分，平台差异通过键值分派
 *     （DEPLOY_PROVIDER / DATABASE_PROVIDER）表达；
 *   - 平台注入命名空间（COZE_*、PG* 等）：平台私有，项目不写入（loadDotEnv 默认
 *     平台注入优先，私有值会被静默覆盖）、不提升进通用契约；
 *   - 项目私有命名空间（服务自有 schema 扩展）：自由命名，但不得占用平台注入命名空间；
 *   - 裸读禁令：禁止直接 process.env.COZE_* 裸读平台注入变量，必须经中立键
 *     （通用契约 + deploymentAliases / normalizeDeployEnv）或自有 schema 显式声明接入。
 * - 管理面语义：ADMIN_PASSWORD 未设置 = 管理后台禁用（503），禁止默认密码回退。
 * - 鉴权中心服务凭证不走环境变量：唯一渠道是凭证文件（见 /auth 的 loadAuthCenterCredential，
 *   authCenterFacet 已退役）。
 * - 用户中心面 `userCenterFacet`（`USER_CENTER_URL` / `USER_CENTER_API_KEY`）已于 0.28.0 退役：
 *   计量与定价上移平台计量域后全集群无消费者（预留的 API_KEY 键自接入以来从未被读）。
 *   产品若需引用用户中心地址，在自己的私有 schema 里显式声明，不再由通用契约承载。
 */

import { z } from "zod";

/** 环境变量分面（zod object） */
export type EnvFacet<S extends z.ZodRawShape = z.ZodRawShape> = z.ZodObject<S>;

/** ── 部署面：中立键（TICKET-001），平台差异经 DEPLOY_PROVIDER 分派 ── */
export const deploymentFacet = z.object({
  DEPLOY_ENV: z.string().optional(),
  PROJECT_DOMAIN_DEFAULT: z.string().optional(),
  PUBLIC_BASE_URL: z.string().optional(),
  DEPLOY_PROVIDER: z.string().optional(),
  HOSTNAME: z.string().optional(),
  PORT: z.string().optional(),
  WORKSPACE_PATH: z.string().optional(),
});

/** ── 管理面：ADMIN_PASSWORD 未设置 = 管理后台禁用（503），禁止默认密码回退 ── */
export const adminFacet = z.object({
  ADMIN_PASSWORD: z.string().optional(),
  /** 管理后台路径前缀，默认 "/admin" */
  ADMIN_PATH: z.string().optional(),
  /** 管理后台用户名（可选）：设置后启用「用户名 + 密码」双凭证认证 */
  ADMIN_USERNAME: z.string().optional(),
  /** 会话有效期（秒），默认 86400（24h） */
  ADMIN_SESSION_MAX_AGE: z.string().optional(),
});

/** 合并两个 shape（B 覆盖同名 key；运行时重复 key 会抛错，此处仅为类型） */
type ExtendShape<A extends z.ZodRawShape, B extends z.ZodRawShape> = {
  [K in keyof A | keyof B]: K extends keyof B
    ? B[K]
    : K extends keyof A
      ? A[K]
      : never;
};

/**
 * 组合多个分面为一个 env schema。
 *
 * 重复 key 直接抛错（避免静默覆盖导致部署配置失效）。
 */
export function composeFacets<A extends z.ZodRawShape>(
  a: z.ZodObject<A>
): z.ZodObject<A>;
export function composeFacets<
  A extends z.ZodRawShape,
  B extends z.ZodRawShape,
>(a: z.ZodObject<A>, b: z.ZodObject<B>): z.ZodObject<ExtendShape<A, B>>;
export function composeFacets<
  A extends z.ZodRawShape,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
>(
  a: z.ZodObject<A>,
  b: z.ZodObject<B>,
  c: z.ZodObject<C>
): z.ZodObject<ExtendShape<ExtendShape<A, B>, C>>;
export function composeFacets<
  A extends z.ZodRawShape,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  D extends z.ZodRawShape,
>(
  a: z.ZodObject<A>,
  b: z.ZodObject<B>,
  c: z.ZodObject<C>,
  d: z.ZodObject<D>
): z.ZodObject<ExtendShape<ExtendShape<ExtendShape<A, B>, C>, D>>;
export function composeFacets<
  A extends z.ZodRawShape,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  D extends z.ZodRawShape,
  E extends z.ZodRawShape,
>(
  a: z.ZodObject<A>,
  b: z.ZodObject<B>,
  c: z.ZodObject<C>,
  d: z.ZodObject<D>,
  e: z.ZodObject<E>
): z.ZodObject<
  ExtendShape<ExtendShape<ExtendShape<ExtendShape<A, B>, C>, D>, E>
>;
export function composeFacets<
  A extends z.ZodRawShape,
  B extends z.ZodRawShape,
  C extends z.ZodRawShape,
  D extends z.ZodRawShape,
  E extends z.ZodRawShape,
  F extends z.ZodRawShape,
>(
  a: z.ZodObject<A>,
  b: z.ZodObject<B>,
  c: z.ZodObject<C>,
  d: z.ZodObject<D>,
  e: z.ZodObject<E>,
  f: z.ZodObject<F>
): z.ZodObject<
  ExtendShape<
    ExtendShape<ExtendShape<ExtendShape<ExtendShape<A, B>, C>, D>, E>,
    F
  >
>;
export function composeFacets(
  a: z.ZodObject<z.ZodRawShape>,
  b?: z.ZodObject<z.ZodRawShape>,
  c?: z.ZodObject<z.ZodRawShape>,
  d?: z.ZodObject<z.ZodRawShape>,
  e?: z.ZodObject<z.ZodRawShape>,
  f?: z.ZodObject<z.ZodRawShape>,
): z.ZodObject {
  const facets = [a, b, c, d, e, f].filter(
    (x): x is z.ZodObject<z.ZodRawShape> => x !== undefined
  );
  const shape: Record<string, unknown> = {};
  for (const facet of facets) {
    for (const [key, value] of Object.entries(facet.shape)) {
      if (key in shape) {
        throw new Error(
          `[service-kit/config] composeFacets: duplicate env key "${key}". ` +
            `Facets must not overlap — check facet composition.`
        );
      }
      shape[key] = value;
    }
  }
  return z.object(shape as z.ZodRawShape);
}

/** 将指定 key 置为必填（output 类型同步收紧） */
type MakeRequired<T, K extends keyof T> = Omit<T, K> & {
  [P in K]-?: T[P];
};

/**
 * 将分面中指定 key 转为必填（存在且非空）。
 *
 * 用于模块级必填（如鉴权中心客户端三要素），失败时由 loadEnv 抛出
 * 带诊断快照的 EnvConfigError。
 */
export function requiredFacet<
  S extends z.ZodObject<z.ZodRawShape>,
  Keys extends (keyof z.output<S> & string)[],
>(
  facet: S,
  keys: Keys
): z.ZodType<MakeRequired<z.output<S>, Keys[number]>> {
  return facet.superRefine((value, ctx) => {
    for (const key of keys) {
      const v = value[key];
      if (v === undefined || v === null || v === "") {
        ctx.addIssue({
          code: "custom",
          message: `required but unset`,
          path: [key],
        });
      }
    }
  }) as unknown as z.ZodType<MakeRequired<z.output<S>, Keys[number]>>;
}

/** 提取 schema 顶层 key（诊断快照 / 运维指纹白名单；loadEnv 失败诊断内部亦复用） */
export function facetKeys(schema: z.ZodType): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  return [];
}
