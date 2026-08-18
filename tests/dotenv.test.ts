/**
 * config 模块 — .env 文件解析与加载测试
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EnvFileError,
  loadDotEnv,
  loadEnv,
  parseDotEnv,
} from "../src/config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kit-dotenv-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KIT_DOTENV_ALPHA;
  delete process.env.KIT_DOTENV_BETA;
  delete process.env.KIT_DOTENV_EXISTING;
});

describe("parseDotEnv", () => {
  it("解析基本 KEY=VALUE，key 允许首尾空白", () => {
    const parsed = parseDotEnv("A=1\n  B  =  2  \nC=3");
    expect(parsed).toEqual({ A: "1", B: "2", C: "3" });
  });

  it("跳过空行与 # 注释行，支持 CRLF 与 BOM", () => {
    const parsed = parseDotEnv(
      "\uFEFF# comment\r\n\r\nA=1\r\n  # indented comment\r\nB=2"
    );
    expect(parsed).toEqual({ A: "1", B: "2" });
  });

  it("单引号值为字面量（不解析转义）", () => {
    expect(parseDotEnv("A='hello\\nworld'").A).toBe("hello\\nworld");
  });

  it("双引号值解析 \\n \\r \\t 与引号转义", () => {
    expect(parseDotEnv('A="a\\nb\\tc\\"d"').A).toBe('a\nb\tc"d');
  });

  it("支持 export 前缀", () => {
    expect(parseDotEnv("export A=1").A).toBe("1");
  });

  it("值含 # 保留为字面量（不支持行尾注释）", () => {
    expect(parseDotEnv("A=pa#ss#word").A).toBe("pa#ss#word");
  });

  it("未闭合引号抛 EnvFileError（含行号，不回显内容）", () => {
    expect(() => parseDotEnv("A=1\nB=\"oops")).toThrowError(EnvFileError);
    try {
      parseDotEnv("A=1\nB=\"oops");
    } catch (err) {
      expect((err as Error).message).toContain("line 2");
      expect((err as Error).message).not.toContain("oops");
    }
  });

  it("非法行（无 =）在 strict 模式抛错，strict: false 静默跳过", () => {
    expect(() => parseDotEnv("A=1\nBANG")).toThrowError(
      /line 2 is not a "KEY=VALUE" assignment/
    );
    expect(parseDotEnv("A=1\nBANG", { strict: false })).toEqual({ A: "1" });
  });
});

describe("loadDotEnv", () => {
  it("读取 .env 文件并合并进 process.env", () => {
    const file = join(tmpDir, ".env");
    writeFileSync(file, "KIT_DOTENV_ALPHA=from-file\nKIT_DOTENV_BETA=2");
    const loaded = loadDotEnv({ path: file });
    expect(loaded).toEqual({
      KIT_DOTENV_ALPHA: "from-file",
      KIT_DOTENV_BETA: "2",
    });
    expect(process.env.KIT_DOTENV_ALPHA).toBe("from-file");
  });

  it("默认不覆盖 process.env 已有变量（平台注入优先）", () => {
    process.env.KIT_DOTENV_EXISTING = "from-platform";
    const file = join(tmpDir, ".env");
    writeFileSync(file, "KIT_DOTENV_EXISTING=from-file\nKIT_DOTENV_BETA=2");
    const loaded = loadDotEnv({ path: file });
    expect(loaded.KIT_DOTENV_EXISTING).toBeUndefined();
    expect(process.env.KIT_DOTENV_EXISTING).toBe("from-platform");
    expect(process.env.KIT_DOTENV_BETA).toBe("2");
  });

  it("override: true 时覆盖 process.env 已有变量", () => {
    process.env.KIT_DOTENV_EXISTING = "from-platform";
    const file = join(tmpDir, ".env");
    writeFileSync(file, "KIT_DOTENV_EXISTING=from-file");
    const loaded = loadDotEnv({ path: file, override: true });
    expect(loaded.KIT_DOTENV_EXISTING).toBe("from-file");
    expect(process.env.KIT_DOTENV_EXISTING).toBe("from-file");
  });

  it("文件不存在默认静默跳过并返回空对象", () => {
    const loaded = loadDotEnv({ path: join(tmpDir, "missing.env") });
    expect(loaded).toEqual({});
  });

  it("required: true 时文件不存在抛 EnvFileError", () => {
    expect(() =>
      loadDotEnv({ path: join(tmpDir, "missing.env"), required: true })
    ).toThrowError(EnvFileError);
  });
});

describe("loadEnv + dotenv 集成", () => {
  it("dotenv 选项先加载 .env 再执行 schema 校验", () => {
    const file = join(tmpDir, ".env");
    writeFileSync(file, "KIT_DOTENV_ALPHA=hello");
    const schema = z.object({ KIT_DOTENV_ALPHA: z.string() });
    const env = loadEnv(schema, { dotenv: { path: file } });
    expect(env.KIT_DOTENV_ALPHA).toBe("hello");
  });

  it("dotenv: true 使用默认路径 <cwd>/.env", () => {
    const cwd = process.cwd();
    try {
      process.chdir(tmpDir);
      writeFileSync(join(tmpDir, ".env"), "KIT_DOTENV_ALPHA=cwd-file");
      const env = loadEnv(z.object({ KIT_DOTENV_ALPHA: z.string() }), {
        dotenv: true,
      });
      expect(env.KIT_DOTENV_ALPHA).toBe("cwd-file");
    } finally {
      process.chdir(cwd);
    }
  });
});
