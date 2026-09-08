/**
 * 鉴权中心凭证文件加载（credential-file）— 单元测试
 *
 * 覆盖：有效文件三要素解析（含尾部斜杠归一化）、单渠道 fail-fast 语义、
 * 非法内容 / 缺字段校验（不回显凭证值）、相对路径默认行为、
 * .gitignore 启发式提示的三态（无 .git / 未覆盖 / 已覆盖）。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CredentialFileError,
  DEFAULT_CREDENTIAL_FILE,
  loadAuthCenterCredential,
} from "../src/auth";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kit-cred-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** 写入凭证文件（对象序列化为 JSON；字符串原样写入用于非法内容用例） */
function writeCredential(content: unknown, name = DEFAULT_CREDENTIAL_FILE): string {
  const filePath = join(dir, name);
  writeFileSync(
    filePath,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
  return filePath;
}

/** 形态对齐签发响应体 + authCenterUrl（含未知字段，验证放行） */
const validFile = {
  version: "1.0",
  type: "client-credential",
  issuer: "token-authority",
  authCenterUrl: "https://auth.example.com/",
  client: {
    id: "tok-hash-1",
    name: "wanyanai",
    productId: "wanyanai",
    expiresAt: "2027-09-09T00:00:00.000Z",
    redirectUris: ["https://app.example.com/callback"],
  },
  apiKey: "sk-client-test",
  endpoints: {},
};

describe("loadAuthCenterCredential", () => {
  it("有效文件 → 返回三要素并归一化尾部斜杠", () => {
    const filePath = writeCredential(validFile);
    expect(loadAuthCenterCredential({ path: filePath })).toEqual({
      authCenterUrl: "https://auth.example.com",
      apiKey: "sk-client-test",
      productId: "wanyanai",
      clientId: "tok-hash-1",
      name: "wanyanai",
      expiresAt: "2027-09-09T00:00:00.000Z",
      sourcePath: filePath,
    });
  });

  it("文件缺失 → 默认抛 CredentialFileError（单渠道 fail-fast）", () => {
    expect(() =>
      loadAuthCenterCredential({ path: join(dir, "absent.json") })
    ).toThrowError(CredentialFileError);
  });

  it("optional: true 且文件缺失 → 返回 null", () => {
    expect(
      loadAuthCenterCredential({ path: join(dir, "absent.json"), optional: true })
    ).toBeNull();
  });

  it("非 JSON 内容 → CredentialFileError（不回显内容）", () => {
    const filePath = writeCredential("not-json{");
    expect(() => loadAuthCenterCredential({ path: filePath })).toThrowError(
      CredentialFileError
    );
  });

  it.each([
    ["缺 authCenterUrl", { client: { productId: "p" }, apiKey: "sk-client-test" }, "authCenterUrl"],
    [
      "缺 apiKey",
      { authCenterUrl: "https://auth.example.com", client: { productId: "p" } },
      "apiKey",
    ],
    [
      "缺 client.productId",
      { authCenterUrl: "https://auth.example.com", apiKey: "sk-client-test", client: {} },
      "client.productId",
    ],
  ])("%s → 校验失败且报字段路径、不回显凭证值", (_name, content, field) => {
    const filePath = writeCredential(content);
    try {
      loadAuthCenterCredential({ path: filePath });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialFileError);
      const message = (err as Error).message;
      expect(message).toContain(field);
      expect(message).not.toContain("sk-client-test");
    }
  });

  it("无 options → 按 cwd 解析默认路径，缺失报错含默认文件名", () => {
    try {
      loadAuthCenterCredential();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialFileError);
      expect((err as Error).message).toContain(DEFAULT_CREDENTIAL_FILE);
    }
  });
});

describe("gitignore 启发式提示", () => {
  it("无 .git → 静默；.git 存在未覆盖 → warn 一次；已覆盖 → 不 warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 场景 1：目录无 .git → 不提示
    loadAuthCenterCredential({ path: writeCredential(validFile, "a.json") });
    expect(warnSpy).not.toHaveBeenCalled();

    // 场景 2：.git 存在且 .gitignore 未覆盖 → 提示一次（消息含文件名）
    mkdirSync(join(dir, ".git"));
    loadAuthCenterCredential({ path: writeCredential(validFile, "b.json") });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain("b.json");

    // 场景 3：.gitignore 精确覆盖后 → 不再提示
    writeFileSync(join(dir, ".gitignore"), "ignored.json\n", "utf8");
    loadAuthCenterCredential({ path: writeCredential(validFile, "ignored.json") });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
