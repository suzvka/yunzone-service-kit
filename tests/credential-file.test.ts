/**
 * 产品凭证文件加载（credential-file）— 单元测试
 *
 * 覆盖：有效文件三要素解析（含尾部斜杠归一化）、单渠道 fail-fast 语义、
 * 非法内容 / 缺字段校验（不回显凭证值）、相对路径默认行为、
 * product / productCenter 可选段装配（整段齐备性、旧文件兼容）、
 * .gitignore 启发式提示的三态（无 .git / 未覆盖 / 已覆盖）、
 * 来源解析（环境变量指示 / 冲突抛错）、统一缓存快照与 refresh、
 * 远端来源（fetch 注入：成功 / 失败 / 超时 / URL 脱敏）。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_CENTER_CREDENTIAL_FILE_ENV,
  AUTH_CENTER_CREDENTIAL_URL_ENV,
  CredentialFileError,
  DEFAULT_CREDENTIAL_FILE,
  loadAuthCenterCredential,
  refreshAuthCenterCredential,
  resetAuthCenterCredentialCacheForTest,
} from "../src/auth";

let dir: string;

/** 清理来源相关环境变量（用例隔离） */
function clearSourceEnv(): void {
  delete process.env[AUTH_CENTER_CREDENTIAL_URL_ENV];
  delete process.env[AUTH_CENTER_CREDENTIAL_FILE_ENV];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kit-cred-"));
  resetAuthCenterCredentialCacheForTest();
  clearSourceEnv();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  clearSourceEnv();
  vi.unstubAllGlobals();
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

  it("产品凭证文件（含 product / productCenter 段）→ 整段装配 + 尾部斜杠归一化", () => {
    const filePath = writeCredential({
      ...validFile,
      product: { id: "e7bf14c7-0456-4851-b500-85521a0ba19c", name: "万言AI" },
      productCenter: { baseUrl: "https://pc.example.com/", apiKey: "sk-pc-test" },
    });
    const cred = loadAuthCenterCredential({ path: filePath });
    expect(cred.product).toEqual({
      id: "e7bf14c7-0456-4851-b500-85521a0ba19c",
      name: "万言AI",
    });
    expect(cred.productCenter).toEqual({
      baseUrl: "https://pc.example.com",
      apiKey: "sk-pc-test",
    });
  });

  it("缺可选段（旧文件形态）→ product / productCenter 为 undefined", () => {
    const filePath = writeCredential(validFile);
    const cred = loadAuthCenterCredential({ path: filePath });
    expect(cred.product).toBeUndefined();
    expect(cred.productCenter).toBeUndefined();
  });

  it("product.id 为空 → CredentialFileError（段内齐备性校验）", () => {
    const filePath = writeCredential({ ...validFile, product: { id: "" } });
    expect(() => loadAuthCenterCredential({ path: filePath })).toThrowError(
      CredentialFileError
    );
  });

  it("productCenter 缺 apiKey → CredentialFileError", () => {
    const filePath = writeCredential({
      ...validFile,
      productCenter: { baseUrl: "https://pc.example.com" },
    });
    expect(() => loadAuthCenterCredential({ path: filePath })).toThrowError(
      CredentialFileError
    );
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

  it("去产品化：缺 client.productId 仍可加载（productId 随鉴权中心去产品化放宽为可选，DESIGN.md §4）", () => {
    const filePath = writeCredential({
      authCenterUrl: "https://auth.example.com",
      apiKey: "sk-client-test",
      client: {},
    });
    const credential = loadAuthCenterCredential({ path: filePath });
    expect(credential.productId).toBeUndefined();
    expect(credential.apiKey).toBe("sk-client-test");
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

describe("来源解析（环境变量指示）", () => {
  it("AUTH_CENTER_CREDENTIAL_FILE 指示路径 → 无 options 也可加载", () => {
    const filePath = writeCredential(validFile, "env-indicated.json");
    process.env[AUTH_CENTER_CREDENTIAL_FILE_ENV] = filePath;
    expect(loadAuthCenterCredential().apiKey).toBe("sk-client-test");
  });

  it("options.path 覆盖环境变量指示的文件", () => {
    const envFile = writeCredential({ ...validFile, apiKey: "sk-env" }, "env.json");
    const explicitFile = writeCredential(
      { ...validFile, apiKey: "sk-explicit" },
      "explicit.json"
    );
    process.env[AUTH_CENTER_CREDENTIAL_FILE_ENV] = envFile;
    expect(loadAuthCenterCredential({ path: explicitFile }).apiKey).toBe("sk-explicit");
  });

  it("URL 与文件键同时设置 → 抛 CredentialFileError（消息含键名、不含值）", () => {
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = "https://oss.example.com/c.json?sig=SECRET";
    process.env[AUTH_CENTER_CREDENTIAL_FILE_ENV] = "auth-center.credential.json";
    try {
      loadAuthCenterCredential();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialFileError);
      const message = (err as Error).message;
      expect(message).toContain(AUTH_CENTER_CREDENTIAL_URL_ENV);
      expect(message).toContain(AUTH_CENTER_CREDENTIAL_FILE_ENV);
      expect(message).not.toContain("SECRET");
    }
  });
});

describe("统一缓存快照与 refresh（文件来源）", () => {
  it("加载即快照：修改文件不生效，refresh 后生效", async () => {
    const filePath = writeCredential(validFile);
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-client-test");

    writeFileSync(
      filePath,
      JSON.stringify({ ...validFile, apiKey: "sk-rotated" }, null, 2),
      "utf8"
    );
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-client-test");

    await refreshAuthCenterCredential({ path: filePath });
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-rotated");
  });

  it("refresh 读取失败 → warn 且缓存保持旧值（不抛错）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = writeCredential(validFile);
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-client-test");

    rmSync(filePath);
    await refreshAuthCenterCredential({ path: filePath });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // 快照保持：盘上文件已删，缓存命中仍可装配
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-client-test");
  });

  it("reset 助手清空缓存（测试隔离语义）", () => {
    const filePath = writeCredential(validFile);
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-client-test");

    writeFileSync(filePath, JSON.stringify({ ...validFile, apiKey: "sk-new" }, null, 2), "utf8");
    resetAuthCenterCredentialCacheForTest();
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-new");
  });
});

describe("远端来源（AUTH_CENTER_CREDENTIAL_URL）", () => {
  const remoteUrl = "https://oss.example.com/credentials/wanyanai.json?sig=SECRET";
  const remoteDisplay = "remote://auth-center.credential.json";

  type FetchImpl = (
    input: string,
    init: { signal: AbortSignal }
  ) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

  function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn> {
    const fn = vi.fn(impl);
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  /** 返回 HTTP 200 + body 的 fetch 实现 */
  const okBody =
    (body: string): FetchImpl =>
    async () => ({ ok: true, status: 200, text: async () => body });

  it("未预取 → 抛 CredentialFileError（消息不含 URL）；optional → null", () => {
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    try {
      loadAuthCenterCredential();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialFileError);
      expect((err as Error).message).not.toContain(remoteUrl);
      expect((err as Error).message).not.toContain("SECRET");
    }
    expect(loadAuthCenterCredential({ optional: true })).toBeNull();
  });

  it("refresh 成功后加载：装配成功、sourcePath 为远端标识、fetch 收到 URL", async () => {
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    const fetchMock = stubFetch(okBody(JSON.stringify(validFile)));

    await refreshAuthCenterCredential();
    const credential = loadAuthCenterCredential();
    expect(credential.apiKey).toBe("sk-client-test");
    expect(credential.sourcePath).toBe(remoteDisplay);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(remoteUrl);
  });

  it("远端内容非法 → 读侧校验失败（消息不含 URL）", async () => {
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    stubFetch(okBody("not-json{"));

    await refreshAuthCenterCredential();
    try {
      loadAuthCenterCredential();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CredentialFileError);
      expect((err as Error).message).toContain(remoteDisplay);
      expect((err as Error).message).not.toContain("SECRET");
    }
  });

  it("refresh 失败（HTTP 500）→ warn 且读侧走缺失语义", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    stubFetch(async () => ({ ok: false, status: 500, text: async () => "" }));

    await refreshAuthCenterCredential();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).not.toContain("SECRET");
    expect(loadAuthCenterCredential({ optional: true })).toBeNull();
  });

  it("fetch 拒绝（消息内嵌 URL）→ warn 脱敏，不出现原 URL", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    stubFetch(async () => {
      throw new Error(`request to ${remoteUrl} failed`);
    });

    await refreshAuthCenterCredential();
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain("<remote-url>");
    expect(message).not.toContain("SECRET");
  });

  it("refresh 超时（timeoutMs）→ warn 且不抛错", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    stubFetch(
      (_input, init) =>
        new Promise<never>((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted by timeout"))
          );
        })
    );

    await refreshAuthCenterCredential({ timeoutMs: 20 });
    expect(warnSpy).toHaveBeenCalled();
    expect(loadAuthCenterCredential({ optional: true })).toBeNull();
  });

  it("URL 模式忽略 options.path（来源以环境变量为准）", async () => {
    const filePath = writeCredential({ ...validFile, apiKey: "sk-local-file" }, "local.json");
    process.env[AUTH_CENTER_CREDENTIAL_URL_ENV] = remoteUrl;
    stubFetch(okBody(JSON.stringify({ ...validFile, apiKey: "sk-remote" })));

    await refreshAuthCenterCredential();
    expect(loadAuthCenterCredential({ path: filePath }).apiKey).toBe("sk-remote");
  });
});
