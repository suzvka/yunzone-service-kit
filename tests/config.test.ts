/**
 * config 模块 — 单元测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EnvConfigError,
  defineEnv,
  loadEnv,
  resolveBaseUrl,
  resolveDatabaseUrl,
  resolveListenAddress,
} from "../src/config";

afterEach(() => {
  delete process.env.KIT_TEST_REQUIRED;
  delete process.env.KIT_TEST_OPTIONAL;
});

describe("defineEnv / loadEnv", () => {
  it("schema 校验通过时返回解析结果", () => {
    process.env.KIT_TEST_REQUIRED = "hello";
    const schema = defineEnv(
      z.object({
        KIT_TEST_REQUIRED: z.string(),
        KIT_TEST_OPTIONAL: z.string().optional(),
      })
    );

    const env = loadEnv(schema);
    expect(env.KIT_TEST_REQUIRED).toBe("hello");
    expect(env.KIT_TEST_OPTIONAL).toBeUndefined();
  });

  it("校验失败时抛 EnvConfigError 且含诊断快照", () => {
    delete process.env.KIT_TEST_REQUIRED;
    const schema = defineEnv(
      z.object({
        KIT_TEST_REQUIRED: z.string(),
        KIT_TEST_OPTIONAL: z.string().optional(),
      })
    );

    expect(() => loadEnv(schema)).toThrowError(EnvConfigError);
    try {
      loadEnv(schema);
    } catch (err) {
      const message = (err as Error).message;
      // 快照标注缺失变量
      expect(message).toContain("KIT_TEST_REQUIRED=(unset)");
      expect(message).toContain("KIT_TEST_OPTIONAL=(unset)");
      // 不回显任何变量值
      expect(message).not.toContain("hello");
    }
  });
});

describe("resolveDatabaseUrl", () => {
  it("postgres 模式直接返回 DATABASE_URL", () => {
    const url = resolveDatabaseUrl({
      provider: "postgres",
      env: { DATABASE_URL: "postgresql://u:p@host:5432/db" },
    });
    expect(url).toBe("postgresql://u:p@host:5432/db");
  });

  it("未设置 DATABASE_PROVIDER 时默认 postgres", () => {
    const url = resolveDatabaseUrl({
      env: { DATABASE_URL: "postgresql://u:p@host:5432/db" },
    });
    expect(url).toBe("postgresql://u:p@host:5432/db");
  });

  it("postgres 模式缺少 DATABASE_URL 时抛带诊断快照的错误", () => {
    expect(() =>
      resolveDatabaseUrl({
        provider: "postgres",
        env: { DATABASE_PROVIDER: "postgres" },
      })
    ).toThrowError(/DATABASE_URL is not set.*Diagnostic snapshot/s);
  });

  it("coze 模式优先使用 PGDATABASE_URL 并去除查询参数", () => {
    const url = resolveDatabaseUrl({
      provider: "coze",
      env: {
        PGDATABASE_URL: "postgresql://u:p@host:5432/db?sslmode=require&x=1",
      },
    });
    expect(url).toBe("postgresql://u:p@host:5432/db");
  });

  it("coze 模式从组件变量拼接并对密码做 URL 编码", () => {
    const url = resolveDatabaseUrl({
      provider: "coze",
      env: {
        PGHOST: "db.internal",
        PGPORT: "6432",
        PGUSER: "svc",
        PGPASSWORD: "p@ss/word",
        PGDATABASE: "app",
      },
    });
    expect(url).toBe("postgresql://svc:p%40ss%2Fword@db.internal:6432/app");
  });

  it("coze 模式组件变量默认端口 5432 / 库名 postgres", () => {
    const url = resolveDatabaseUrl({
      provider: "coze",
      env: { PGHOST: "h", PGUSER: "u", PGPASSWORD: "p" },
    });
    expect(url).toBe("postgresql://u:p@h:5432/postgres");
  });

  it("coze 模式缺少必需变量时报错", () => {
    expect(() =>
      resolveDatabaseUrl({ provider: "coze", env: { PGHOST: "h" } })
    ).toThrowError(/missing required env vars/);
  });

  it("未知 provider 报错并列出支持项", () => {
    expect(() =>
      resolveDatabaseUrl({ env: { DATABASE_PROVIDER: "mysql" } })
    ).toThrowError(/Unknown provider: "mysql". Supported: postgres, coze/);
  });
});

describe("resolveBaseUrl", () => {
  it("PUBLIC_BASE_URL 优先（解析链最高优先级）", () => {
    expect(
      resolveBaseUrl({
        env: {
          PUBLIC_BASE_URL: "https://public.example.com",
          BETTER_AUTH_URL: "https://auth.example.com",
          PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
        },
      })
    ).toBe("https://public.example.com");
  });

  it("BETTER_AUTH_URL 第二优先（历史遗留兼容键）", () => {
    expect(
      resolveBaseUrl({
        env: {
          BETTER_AUTH_URL: "https://auth.example.com",
          PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
        },
      })
    ).toBe("https://auth.example.com");
  });

  it("legacy 旧名经适配层回退：BETTER_AUTH_URL 优先", () => {
    expect(
      resolveBaseUrl({
        env: {
          BETTER_AUTH_URL: "https://auth.example.com",
          COZE_PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
        },
      })
    ).toBe("https://auth.example.com");
  });

  it("DEV 环境回退到 fallback（默认 localhost:5000）", () => {
    expect(
      resolveBaseUrl({
        env: {
          DEPLOY_ENV: "DEV",
          PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
        },
      })
    ).toBe("http://localhost:5000");
  });

  it("legacy 旧名回退：COZE_PROJECT_ENV=DEV 时同样回退", () => {
    expect(
      resolveBaseUrl({
        env: {
          COZE_PROJECT_ENV: "DEV",
          COZE_PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
        },
      })
    ).toBe("http://localhost:5000");
  });

  it("生产环境使用 PROJECT_DOMAIN_DEFAULT", () => {
    expect(
      resolveBaseUrl({
        env: { PROJECT_DOMAIN_DEFAULT: "https://platform.example.com" },
      })
    ).toBe("https://platform.example.com");
  });

  it("legacy 旧名回退：生产环境使用 COZE_PROJECT_DOMAIN_DEFAULT", () => {
    expect(
      resolveBaseUrl({
        env: { COZE_PROJECT_DOMAIN_DEFAULT: "https://platform.example.com" },
      })
    ).toBe("https://platform.example.com");
  });

  it("devFallback 关闭时 DEV 环境仍读取项目域名", () => {
    expect(
      resolveBaseUrl({
        devFallback: false,
        env: {
          DEPLOY_ENV: "DEV",
          PROJECT_DOMAIN_DEFAULT: "https://platform.example.com",
        },
      })
    ).toBe("https://platform.example.com");
  });

  it("全部缺失时回退到 fallback（可自定义）", () => {
    expect(resolveBaseUrl({ env: {} })).toBe("http://localhost:5000");
    expect(resolveBaseUrl({ env: {}, fallback: "http://127.0.0.1:8080" })).toBe(
      "http://127.0.0.1:8080"
    );
  });
});

describe("resolveListenAddress", () => {
  it("PORT 优先于平台旧名 DEPLOY_RUN_PORT", () => {
    const addr = resolveListenAddress({
      env: { PORT: "8080", DEPLOY_RUN_PORT: "9090" },
    });
    expect(addr).toEqual({ host: "0.0.0.0", port: 8080 });
  });

  it("PORT 未设置时回退平台旧名 DEPLOY_RUN_PORT", () => {
    const addr = resolveListenAddress({ env: { DEPLOY_RUN_PORT: "9090" } });
    expect(addr).toEqual({ host: "0.0.0.0", port: 9090 });
  });

  it("HOSTNAME 与默认端口 5000", () => {
    const addr = resolveListenAddress({ env: { HOSTNAME: "127.0.0.1" } });
    expect(addr).toEqual({ host: "127.0.0.1", port: 5000 });
  });
});
