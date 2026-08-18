/**
 * config 分面规范（specs）— 单元测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminFacet,
  authCenterFacet,
  composeFacets,
  deploymentFacet,
  envSnapshot,
  EnvConfigError,
  facetKeys,
  loadEnv,
  requiredFacet,
  userCenterFacet,
} from "../src/config";

afterEach(() => {
  delete process.env.AUTH_CENTER_URL;
  delete process.env.AUTH_CENTER_API_KEY;
  delete process.env.AUTH_CENTER_PRODUCT_ID;
  delete process.env.AUTH_SERVER_URL;
  delete process.env.AUTH_SERVER_API_KEY;
  delete process.env.AUTH_SERVER_PRODUCT_ID;
});

describe("composeFacets", () => {
  it("组合多个分面并保留字段", () => {
    const schema = composeFacets(deploymentFacet, authCenterFacet, adminFacet);
    const keys = facetKeys(schema);
    expect(keys).toContain("COZE_PROJECT_ENV");
    expect(keys).toContain("AUTH_CENTER_URL");
    expect(keys).toContain("ADMIN_PASSWORD");
    expect(keys).toContain("ADMIN_PATH");
  });

  it("组合结果可被 loadEnv 解析且类型收敛", () => {
    process.env.AUTH_CENTER_URL = "https://auth.example.com";
    const schema = composeFacets(authCenterFacet, userCenterFacet);
    const env = loadEnv(schema);
    expect(env.AUTH_CENTER_URL).toBe("https://auth.example.com");
    expect(env.USER_CENTER_URL).toBeUndefined();
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
    process.env.AUTH_CENTER_URL = "https://auth.example.com";
    process.env.AUTH_CENTER_API_KEY = "sk-client-abc";
    process.env.AUTH_CENTER_PRODUCT_ID = "wanyanai";

    const schema = requiredFacet(authCenterFacet, [
      "AUTH_CENTER_URL",
      "AUTH_CENTER_API_KEY",
      "AUTH_CENTER_PRODUCT_ID",
    ]);
    const env = loadEnv(schema);
    expect(env.AUTH_CENTER_URL).toBe("https://auth.example.com");
  });

  it("必填 key 缺失时 loadEnv 抛 EnvConfigError 且快照不回显值", () => {
    process.env.AUTH_CENTER_URL = "https://auth.example.com";
    const schema = requiredFacet(authCenterFacet, [
      "AUTH_CENTER_URL",
      "AUTH_CENTER_API_KEY",
      "AUTH_CENTER_PRODUCT_ID",
    ]);

    expect(() => loadEnv(schema)).toThrowError(EnvConfigError);
    try {
      loadEnv(schema);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("AUTH_CENTER_URL=***set***");
      expect(message).toContain("AUTH_CENTER_API_KEY=(unset)");
      // 不回显任何变量值
      expect(message).not.toContain("https://auth.example.com");
    }
  });

  it("空字符串视为未设置", () => {
    process.env.AUTH_CENTER_URL = "";
    const schema = requiredFacet(authCenterFacet, ["AUTH_CENTER_URL"]);
    expect(() => loadEnv(schema)).toThrowError(/AUTH_CENTER_URL.*required but unset/);
  });
});

describe("loadEnv aliases（legacy 过渡）", () => {
  it("规范 key 未设置时回退 legacy 别名", () => {
    process.env.AUTH_SERVER_URL = "https://legacy.example.com";
    const env = loadEnv(authCenterFacet, {
      aliases: { AUTH_CENTER_URL: ["AUTH_SERVER_URL"] },
    });
    expect(env.AUTH_CENTER_URL).toBe("https://legacy.example.com");
  });

  it("规范 key 优先于 legacy 别名", () => {
    process.env.AUTH_CENTER_URL = "https://canonical.example.com";
    process.env.AUTH_SERVER_URL = "https://legacy.example.com";
    const env = loadEnv(authCenterFacet, {
      aliases: { AUTH_CENTER_URL: ["AUTH_SERVER_URL"] },
    });
    expect(env.AUTH_CENTER_URL).toBe("https://canonical.example.com");
  });

  it("aliases 不污染 process.env", () => {
    process.env.AUTH_SERVER_URL = "https://legacy.example.com";
    loadEnv(authCenterFacet, {
      aliases: { AUTH_CENTER_URL: ["AUTH_SERVER_URL"] },
    });
    expect(process.env.AUTH_CENTER_URL).toBeUndefined();
  });

  it("失败时诊断快照只列规范名（不回显 legacy 值）", () => {
    process.env.AUTH_SERVER_API_KEY = "sk-super-secret";
    const schema = requiredFacet(authCenterFacet, [
      "AUTH_CENTER_URL",
      "AUTH_CENTER_API_KEY",
      "AUTH_CENTER_PRODUCT_ID",
    ]);

    expect(() =>
      loadEnv(schema, {
        aliases: {
          AUTH_CENTER_URL: ["AUTH_SERVER_URL"],
          AUTH_CENTER_API_KEY: ["AUTH_SERVER_API_KEY"],
        },
      })
    ).toThrowError(EnvConfigError);
    try {
      loadEnv(schema, {
        aliases: {
          AUTH_CENTER_URL: ["AUTH_SERVER_URL"],
          AUTH_CENTER_API_KEY: ["AUTH_SERVER_API_KEY"],
        },
      });
    } catch (err) {
      const message = (err as Error).message;
      // 快照列出规范名（来自 alias 的值也算 set）
      expect(message).toContain("AUTH_CENTER_API_KEY=***set***");
      // 不回显任何变量值
      expect(message).not.toContain("sk-super-secret");
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
    expect(facetKeys(adminFacet).sort()).toEqual(["ADMIN_PASSWORD", "ADMIN_PATH"]);
  });

  it("requiredFacet 包装后仍可提取（superRefine 返回 this）", () => {
    const schema = requiredFacet(authCenterFacet, ["AUTH_CENTER_URL"]);
    expect(facetKeys(schema).sort()).toEqual([
      "AUTH_CENTER_API_KEY",
      "AUTH_CENTER_PRODUCT_ID",
      "AUTH_CENTER_URL",
    ]);
  });
});
