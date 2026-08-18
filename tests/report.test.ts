/**
 * ops 运维报告聚合器 — 单元测试
 */

import { describe, expect, it } from "vitest";
import {
  createOpsReporter,
  type OpsReport,
} from "../src/ops";
import {
  ProviderRegistry,
  type KitProvider,
} from "../src/registry";

function stub(
  id: string,
  available: boolean,
  priority?: number
): KitProvider {
  return {
    meta: { id, name: `Provider ${id}`, priority },
    isAvailable: () => available,
  };
}

class StubRegistry extends ProviderRegistry<KitProvider> {
  constructor() {
    super({ name: "StubRegistry" });
  }
}

describe("createOpsReporter", () => {
  it("聚合服务信息（注入 env，不依赖真实 process.env）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "1.2.3",
      env: {
        DEPLOY_ENV: "PROD",
        BETTER_AUTH_URL: "https://svc.example.com",
        HOSTNAME: "0.0.0.0",
        PORT: "8080",
      },
    });
    reporter.setEnvKeys(["BETTER_AUTH_URL", "SECRET_KEY"]);

    const report: OpsReport = await reporter.report();

    expect(report.service.name).toBe("test-service");
    expect(report.service.version).toBe("1.2.3");
    expect(report.service.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(report.deployment).toEqual({
      env: "PROD",
      baseUrl: "https://svc.example.com",
      host: "0.0.0.0",
      port: 8080,
    });
    expect(report.envFingerprint).toEqual({
      BETTER_AUTH_URL: "set",
      SECRET_KEY: "unset",
    });
    expect(report.registries).toEqual({});
  });

  it("legacy 平台注入旧名经适配层映射（COZE_* / DEPLOY_RUN_PORT）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "1.2.3",
      env: {
        COZE_PROJECT_ENV: "PROD",
        DEPLOY_RUN_PORT: "8080",
      },
    });

    const report = await reporter.report();
    // deployment.env 展示中立键（来自 legacy 回退），端口回退自 DEPLOY_RUN_PORT
    expect(report.deployment.env).toBe("PROD");
    expect(report.deployment.port).toBe(8080);
  });

  it("devFallback 语义：DEV 环境 baseUrl 回退到 localhost", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {
        DEPLOY_ENV: "DEV",
        PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
      },
    });

    const report = await reporter.report();
    expect(report.deployment.baseUrl).toBe("http://localhost:5000");
  });

  it("devFallback 语义：legacy COZE_PROJECT_ENV=DEV 同样回退", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {
        COZE_PROJECT_ENV: "DEV",
        COZE_PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
      },
    });

    const report = await reporter.report();
    expect(report.deployment.baseUrl).toBe("http://localhost:5000");
  });

  it("聚合注册中心状态快照", async () => {
    const registry = new StubRegistry();
    registry.register(stub("ok", true, 100));
    registry.register(stub("off", false, 10));

    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {},
    });
    reporter.addRegistry("captcha", registry);

    const report = await reporter.report();
    expect(report.registries.captcha).toEqual({
      registeredCount: 2,
      availableCount: 1,
      activeProvider: "ok",
      providers: [
        { id: "ok", name: "Provider ok", priority: 100, available: true },
        { id: "off", name: "Provider off", priority: 10, available: false },
      ],
    });
  });

  it("envFingerprint 不含变量值（防泄漏）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: { SECRET_KEY: "sk-super-secret" },
    });
    reporter.setEnvKeys(["SECRET_KEY"]);

    const report = await reporter.report();
    expect(report.envFingerprint.SECRET_KEY).toBe("set");
    expect(JSON.stringify(report)).not.toContain("sk-super-secret");
  });
});
