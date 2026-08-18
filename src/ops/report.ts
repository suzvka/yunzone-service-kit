/**
 * 运维数据聚合器（纯逻辑，零框架耦合）
 *
 * 使用方式：
 * ```ts
 * import { createOpsReporter } from "yunzone-service-kit/ops";
 *
 * const reporter = createOpsReporter({ name: "user-center", version: "1.2.3" });
 * reporter.addRegistry("captcha", captchaRegistry);
 * reporter.setEnvKeys(["AUTH_CENTER_URL", "DEPLOY_ENV"]);
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
import type { OpsReport } from "./types";

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
  /** 设置 env 指纹白名单（schema 顶层 key） */
  setEnvKeys(keys: string[]): void;
  /** 聚合生成运维报告 */
  report(): Promise<OpsReport>;
}

export function createOpsReporter(options: OpsReporterOptions): OpsReporter {
  const startedAt = Date.now();
  const registries = new Map<string, ProviderRegistry<KitProvider>>();
  let envKeys: string[] = [];

  return {
    addRegistry(id, registry) {
      registries.set(id, registry);
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
        envFingerprint: envSnapshot(env, envKeys),
      };
    },
  };
}
