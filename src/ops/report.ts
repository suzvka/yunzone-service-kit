/**
 * 运维数据聚合器（纯逻辑，零框架耦合）
 *
 * 使用方式：
 * ```ts
 * import { createOpsReporter } from "yunzone-service-kit/ops";
 *
 * const reporter = createOpsReporter({ name: "user-center", version: "1.2.3" });
 * reporter.addRegistry("captcha", captchaRegistry);
 * reporter.addSection("apiHeat", () => heatCounter.snapshot());
 * reporter.setEnvKeys(["DEPLOY_ENV", "ADMIN_PASSWORD"]);
 *
 * // 服务自建端点（如 /ops）：
 * export async function GET() {
 *   return Response.json(await reporter.report());
 * }
 * ```
 */

import type { KitProvider } from "../registry";
import { ProviderRegistry } from "../registry";
import {
  envSnapshot,
  normalizeDeployEnv,
  resolveBaseUrl,
  resolveListenAddress,
} from "../config";
import type { OpsReport, OpsSectionProvider, OpsSectionResult } from "./types";

/** createOpsReporter 参数 */
export interface OpsReporterOptions {
  /** 服务名 */
  name: string;
  /** 服务版本 */
  version: string;
  /** 环境变量来源（默认 process.env，可注入用于测试） */
  env?: Record<string, string | undefined>;
}

/** 运维数据聚合器 */
export interface OpsReporter {
  /** 注册一个注册中心状态源（id 为报告中的 key） */
  addRegistry(id: string, registry: ProviderRegistry<KitProvider>): void;
  /**
   * 注册一个宿主扩展段（id 为报告 sections 中的 key；同 id 后注册者覆盖前者）
   *
   * 承载 kit 无契约的宿主自有运维数据（如 API 调用热度、队列积压、卡片目录快照）；
   * provider 在每次 report() 时调用，抛错只降级该段。
   */
  addSection(id: string, provider: OpsSectionProvider): void;
  /** 设置 env 指纹白名单（schema 顶层 key） */
  setEnvKeys(keys: string[]): void;
  /** 聚合生成运维报告 */
  report(): Promise<OpsReport>;
}

export function createOpsReporter(options: OpsReporterOptions): OpsReporter {
  const startedAt = Date.now();
  const registries = new Map<string, ProviderRegistry<KitProvider>>();
  const sections = new Map<string, OpsSectionProvider>();
  let envKeys: string[] = [];

  return {
    addRegistry(id, registry) {
      registries.set(id, registry);
    },

    addSection(id, provider) {
      sections.set(id, provider);
    },

    setEnvKeys(keys) {
      envKeys = keys;
    },

    async report() {
      // 平台注入变量经适配层映射到中立键（读取时映射，不写 process.env）
      const env = normalizeDeployEnv(options.env ?? process.env);

      const registriesReport: OpsReport["registries"] = {};
      for (const [id, registry] of registries) {
        registriesReport[id] = await registry.getStatus();
      }

      // 扩展段并发聚合（宿主代码耗时未知）：单段失败只降级该段，不牵连整份报告
      const sectionsReport: OpsReport["sections"] = {};
      await Promise.all(
        [...sections].map(async ([id, provider]) => {
          sectionsReport[id] = await resolveSection(provider);
        }),
      );

      const { host, port } = resolveListenAddress({ env });

      return {
        service: {
          name: options.name,
          version: options.version,
          startedAt: new Date(startedAt).toISOString(),
          uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        },
        deployment: {
          env: env.DEPLOY_ENV,
          baseUrl: resolveBaseUrl({ env }),
          host,
          port,
        },
        registries: registriesReport,
        sections: sectionsReport,
        envFingerprint: envSnapshot(env, envKeys),
      };
    },
  };
}

/** 单段聚合：provider 抛错（含返回 rejected promise）降级为 error 段，只留消息不留堆栈 */
async function resolveSection(provider: OpsSectionProvider): Promise<OpsSectionResult> {
  try {
    return { ok: true, data: await provider() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
