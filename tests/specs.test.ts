/**
 * config 分面规范（specs）— 单元测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminFacet,
  composeFacets,
  deploymentAliases,
  deploymentFacet,
  envSnapshot,
  EnvConfigError,
  facetKeys,
  loadEnv,
  requiredFacet,
  userCenterFacet,
} from "../src/config";

afterEach(() => {
  delete process.env.USER_CENTER_URL;
  delete process.env.USER_CENTER_API_KEY;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.DEPLOY_ENV;
  delete process.env.PROJECT_DOMAIN_DEFAULT;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.DEPLOY_PROVIDER;
  delete process.env.PORT;
  delete process.env.WORKSPACE_PATH;
  delete process.env.COZE_PROJECT_ENV;
  delete process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  delete process.env.COZE_WORKSPACE_PATH;
  delete process.env.DEPLOY_RUN_PORT;
});

describe("composeFacets", () => {
  it("组合多个分面并保留字段", () => {
    const schema = composeFacets(deploymentFacet, userCenterFacet, adminFacet);
    const keys = facetKeys(schema);
    expect(keys).toContain("DEPLOY_ENV");
    expect(keys).toContain("USER_CENTER_URL");
    expect(keys).toContain("ADMIN_PASSWORD");
    expect(keys).toContain("ADMIN_PATH");
  });

  it("组合结果可被 loadEnv 解析且类型收敛", () => {
    process.env.USER_CENTER_URL = "https://uc.example.com";
    const schema = composeFacets(userCenterFacet, adminFacet);
    const env = loadEnv(schema);
    expect(env.USER_CENTER_URL).toBe("https://uc.example.com");
    expect(env.ADMIN_PASSWORD).toBeUndefined();
  });

  it("重复 key 直接抛错（防止静默覆盖）", () => {
    expect(() =>
      composeFacets(
        z.object({ DUP: z.string().optional() }),
        z.object({ DUP: z.string().optional() })
      )
    ).toThrowError(/duplicate env key "DUP"/);
  });
});

describe("requiredFacet", () => {
  it("必填 key 存在且非空时通过", () => {
    process.env.ADMIN_PASSWORD = "admin-pass";
    const schema = requiredFacet(adminFacet, ["ADMIN_PASSWORD"]);
    const env = loadEnv(schema);
    expect(env.ADMIN_PASSWORD).toBe("admin-pass");
  });

  it("必填 key 缺失时 loadEnv 抛 EnvConfigError 且快照不回显值", () => {
    process.env.ADMIN_PASSWORD = "admin-pass";
    const schema = requiredFacet(adminFacet, ["ADMIN_PASSWORD", "ADMIN_USERNAME"]);

    expect(() => loadEnv(schema)).toThrowError(EnvConfigError);
    try {
      loadEnv(schema);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("ADMIN_PASSWORD=***set***");
      expect(message).toContain("ADMIN_USERNAME=(unset)");
      // 不回显任何变量值
      expect(message).not.toContain("admin-pass");
    }
  });

  it("空字符串视为未设置", () => {
    process.env.ADMIN_PASSWORD = "";
    const schema = requiredFacet(adminFacet, ["ADMIN_PASSWORD"]);
    expect(() => loadEnv(schema)).toThrowError(/ADMIN_PASSWORD.*required but unset/);
  });
});

describe("loadEnv aliases（legacy 过渡）", () => {
  it("规范 key 未设置时回退 legacy 别名", () => {
    process.env.COZE_PROJECT_ENV = "PROD";
    const env = loadEnv(deploymentFacet, { aliases: deploymentAliases });
    expect(env.DEPLOY_ENV).toBe("PROD");
  });

  it("规范 key 优先于 legacy 别名", () => {
    process.env.DEPLOY_ENV = "PROD";
    process.env.COZE_PROJECT_ENV = "DEV";
    const env = loadEnv(deploymentFacet, { aliases: deploymentAliases });
    expect(env.DEPLOY_ENV).toBe("PROD");
  });

  it("aliases 不污染 process.env", () => {
    process.env.COZE_PROJECT_ENV = "PROD";
    loadEnv(deploymentFacet, { aliases: deploymentAliases });
    expect(process.env.DEPLOY_ENV).toBeUndefined();
  });

  it("失败时诊断快照只列规范名（不回显 legacy 值）", () => {
    process.env.COZE_PROJECT_ENV = "env-super-secret";
    // DEPLOY_PROVIDER 不在 deploymentAliases 中，required 下必然 unset → 抛错
    const schema = requiredFacet(deploymentFacet, [
      "DEPLOY_ENV",
      "DEPLOY_PROVIDER",
    ]);

    expect(() =>
      loadEnv(schema, { aliases: deploymentAliases })
    ).toThrowError(EnvConfigError);
    try {
      loadEnv(schema, { aliases: deploymentAliases });
    } catch (err) {
      const message = (err as Error).message;
      // 快照列出规范名（来自 alias 的值也算 set）
      expect(message).toContain("DEPLOY_ENV=***set***");
      expect(message).toContain("DEPLOY_PROVIDER=(unset)");
      // 不回显任何变量值
      expect(message).not.toContain("env-super-secret");
    }
  });
});

describe("envSnapshot", () => {
  it("输出 set/unset 指纹且不含变量值", () => {
    const snapshot = envSnapshot(
      { SECRET: "super-secret-value" },
      ["SECRET", "MISSING"]
    );
    expect(snapshot).toEqual({ SECRET: "set", MISSING: "unset" });
    expect(JSON.stringify(snapshot)).not.toContain("super-secret-value");
  });
});

describe("facetKeys", () => {
  it("提取 ZodObject 顶层 key", () => {
    expect(facetKeys(adminFacet).sort()).toEqual([
          "ADMIN_PASSWORD",
          "ADMIN_PATH",
          "ADMIN_SESSION_MAX_AGE",
          "ADMIN_USERNAME",
        ]);
  });

  it("requiredFacet 包装后仍可提取（superRefine 返回 this）", () => {
    const schema = requiredFacet(userCenterFacet, ["USER_CENTER_URL"]);
    expect(facetKeys(schema).sort()).toEqual([
      "USER_CENTER_API_KEY",
      "USER_CENTER_URL",
    ]);
  });
});
