/**
 * 部署适配层（deploy）— 单元测试
 */

import { describe, expect, it } from "vitest";
import { deploymentAliases, normalizeDeployEnv } from "../src/config";

describe("deploymentAliases", () => {
  it("覆盖全部部署面平台注入旧名映射", () => {
    expect(deploymentAliases).toEqual({
      DEPLOY_ENV: ["COZE_PROJECT_ENV"],
      PROJECT_DOMAIN_DEFAULT: ["COZE_PROJECT_DOMAIN_DEFAULT"],
      WORKSPACE_PATH: ["COZE_WORKSPACE_PATH"],
      PORT: ["DEPLOY_RUN_PORT"],
    });
  });
});

describe("normalizeDeployEnv", () => {
  it("默认 coze：中立键未设置时回退平台注入旧名", () => {
    const env = normalizeDeployEnv({
      COZE_PROJECT_ENV: "PROD",
      COZE_PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
      COZE_WORKSPACE_PATH: "/workspace/app",
      DEPLOY_RUN_PORT: "8080",
    });
    expect(env.DEPLOY_ENV).toBe("PROD");
    expect(env.PROJECT_DOMAIN_DEFAULT).toBe("https://platform.example.com");
    expect(env.WORKSPACE_PATH).toBe("/workspace/app");
    expect(env.PORT).toBe("8080");
  });

  it("中立键优先于平台注入旧名", () => {
    const env = normalizeDeployEnv({
      DEPLOY_ENV: "PROD",
      PORT: "8080",
      COZE_PROJECT_ENV: "DEV",
      DEPLOY_RUN_PORT: "9090",
    });
    expect(env.DEPLOY_ENV).toBe("PROD");
    expect(env.PORT).toBe("8080");
  });

  it("显式 DEPLOY_PROVIDER=self 时直读中立键（无平台注入回退）", () => {
    const env = normalizeDeployEnv({
      DEPLOY_PROVIDER: "self",
      DEPLOY_ENV: "PROD",
      COZE_PROJECT_ENV: "DEV",
    });
    expect(env.DEPLOY_ENV).toBe("PROD");
  });

  it("provider 选项显式指定时优先于 env.DEPLOY_PROVIDER", () => {
    const env = normalizeDeployEnv(
      { DEPLOY_PROVIDER: "self", COZE_PROJECT_ENV: "DEV" },
      { provider: "coze" }
    );
    expect(env.DEPLOY_ENV).toBe("DEV");
  });

  it("未知 provider 显式报错（不静默回退）", () => {
    expect(() =>
      normalizeDeployEnv({ DEPLOY_PROVIDER: "vercel" })
    ).toThrowError(/unknown DEPLOY_PROVIDER "vercel".*Supported: coze, self/s);
  });

  it("不污染原始 env（返回拷贝）", () => {
    const source: Record<string, string | undefined> = {
      COZE_PROJECT_ENV: "PROD",
    };
    normalizeDeployEnv(source);
    expect(source.DEPLOY_ENV).toBeUndefined();
    expect(source.COZE_PROJECT_ENV).toBe("PROD");
  });
});
