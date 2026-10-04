/** test-meta: tier=fast; risk=low; owner=platform; expires=2027-03-31 */
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
    expect(report.sections).toEqual({});
  });

  it("显式 coze：平台注入旧名经适配层映射（COZE_* / DEPLOY_RUN_PORT）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "1.2.3",
      env: {
        DEPLOY_PROVIDER: "coze",
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

  it("devFallback 语义：显式 coze 时 legacy COZE_PROJECT_ENV=DEV 同样回退", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {
        DEPLOY_PROVIDER: "coze",
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

  it("扩展段：同步 provider 数据进 sections（ok/data 信封）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {},
    });
    reporter.addSection("apiHeat", () => ({ scope: "cards", total: 3 }));

    const report = await reporter.report();
    expect(report.sections.apiHeat).toEqual({
      ok: true,
      data: { scope: "cards", total: 3 },
    });
  });

  it("扩展段：异步 provider 与多段并发聚合（数据形状由宿主自定义）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {},
    });
    reporter.addSection("async", async () => ({ v: 1 }));
    reporter.addSection("scalar", () => 42);

    const report = await reporter.report();
    expect(report.sections).toEqual({
      async: { ok: true, data: { v: 1 } },
      scalar: { ok: true, data: 42 },
    });
  });

  it("扩展段：provider 抛错只降级该段（其余段与整份报告仍可用）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {},
    });
    reporter.addSection("boom", () => {
      throw new Error("heat counter unavailable");
    });
    reporter.addSection("fine", () => "ok");

    const report = await reporter.report();
    expect(report.sections.boom).toEqual({
      ok: false,
      error: "heat counter unavailable",
    });
    expect(report.sections.fine).toEqual({ ok: true, data: "ok" });
    expect(report.service.name).toBe("test-service");
  });

  it("扩展段：rejected promise 同样降级；非 Error 抛出转字符串（不带堆栈）", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {},
    });
    reporter.addSection("reject", async () => {
      throw new Error("async down");
    });
    reporter.addSection("raw", () => {
      throw "raw-reason";
    });

    const report = await reporter.report();
    expect(report.sections.reject).toEqual({ ok: false, error: "async down" });
    expect(report.sections.raw).toEqual({ ok: false, error: "raw-reason" });
    expect(JSON.stringify(report.sections)).not.toContain("at resolveSection");
  });

  it("扩展段：同 id 后注册者覆盖前者", async () => {
    const reporter = createOpsReporter({
      name: "test-service",
      version: "0.0.0",
      env: {},
    });
    reporter.addSection("dup", () => "first");
    reporter.addSection("dup", () => "second");

    const report = await reporter.report();
    expect(report.sections.dup).toEqual({ ok: true, data: "second" });
  });
});
