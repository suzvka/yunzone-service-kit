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
        COZE_PROJECT_ENV: "PROD",
        BETTER_AUTH_URL: "https://svc.example.com",
        HOSTNAME: "0.0.0.0",
        DEPLOY_RUN_PORT: "8080",
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

  it("devFallback 语义：DEV 环境 baseUrl 回退到 localhost", async () => {
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
