/**
 * 环境变量分面规范（Env Facets）
 *
 * 集群统一约定：环境变量按"服务角色"分面声明，服务通过 composeFacets 组合自己需要的面。
 *
 * - 所有分面字段全部 optional：延续"通用 envSchema 全部 optional"约定（缺省降级/懒加载），
 *   需要必填的模块用 requiredFacet 声明独立子 schema。
 * - 规范名统一：鉴权中心三要素为 AUTH_CENTER_*（AUTH_SERVER_* 为 legacy 别名，
 *   通过 loadEnv 的 aliases 过渡，文档标注 v0.3 移除）。
 * - 管理面语义：ADMIN_PASSWORD 未设置 = 管理后台禁用（503），禁止默认密码回退。
 */

import { z } from "zod";

/** 环境变量分面（zod object） */
export type EnvFacet<S extends z.ZodRawShape = z.ZodRawShape> = z.ZodObject<S>;

/** ── 部署面：平台注入的部署环境变量（沿用现有命名，不引入新名） ── */
export const deploymentFacet = z.object({
  COZE_PROJECT_ENV: z.string().optional(),
  COZE_PROJECT_DOMAIN_DEFAULT: z.string().optional(),
  HOSTNAME: z.string().optional(),
  DEPLOY_RUN_PORT: z.string().optional(),
  PORT: z.string().optional(),
  COZE_WORKSPACE_PATH: z.string().optional(),
});

/** ── 鉴权中心面（Token Authority Service）：规范名 AUTH_CENTER_* ── */
export const authCenterFacet = z.object({
  AUTH_CENTER_URL: z.string().optional(),
  AUTH_CENTER_API_KEY: z.string().optional(),
  AUTH_CENTER_PRODUCT_ID: z.string().optional(),
});

/** ── 用户中心面：服务端 URL 与客户端注入（NEXT_PUBLIC_*）分开声明 ── */
export const userCenterFacet = z.object({
  USER_CENTER_URL: z.string().optional(),
  NEXT_PUBLIC_USER_CENTER_URL: z.string().optional(),
  /** 预留：用户中心服务端凭证（当前集群暂无消费者） */
  USER_CENTER_API_KEY: z.string().optional(),
});

/** ── 管理面：ADMIN_PASSWORD 未设置 = 管理后台禁用（503） ── */
export const adminFacet = z.object({
  ADMIN_PASSWORD: z.string().optional(),
  /** 管理后台路径前缀，默认 "/admin" */
  ADMIN_PATH: z.string().optional(),
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

/**
 * 提取 schema 顶层 key，供诊断快照/运维指纹使用。
 */
export function facetKeys(schema: z.ZodType): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  return [];
}
