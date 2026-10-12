/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * ops 密码本（v2.0 Admin Keybook）— 单元测试
 *
 * 覆盖：parseAdminKeybook 形态校验、指纹稳定性、loadAdminKeybook 双源
 * （注入 fs/fetch，不落真实磁盘与网络）、Ed25519 验签（含 PKCS8 PEM 互操作，
 * 模拟登录伴侣导入路径）、initAdminRuntime 启动一次性装配与禁用态。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import {
  AdminKeybookError,
  buildAdminLoginMessage,
  computeKeybookFingerprint,
  initAdminRuntime,
  isAdminKeyRevoked,
  getAdminRuntimeCached,
  loadAdminKeybook,
  parseAdminKeybook,
  resetAdminRuntimeForTest,
  verifyKeybookSignature,
  type LoadedAdminKeybook,
} from "../src/ops";

// ── 测试密钥与密码本文档工厂（不落盘，内存生成） ──

function makeKeyMaterial(id: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    id,
    publicKeyB64: publicKey.export({ format: "jwk" }).x as string,
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    sign(message: string): string {
      return cryptoSign(
        null,
        Buffer.from(message, "utf8"),
        privateKey
      ).toString("base64url");
    },
  };
}

const ALPHA = makeKeyMaterial("alpha-laptop");
const BETA = makeKeyMaterial("beta-ops");

/** 合法密码本文档（可覆写字段做负例） */
function keybookDoc(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    keys: [
      {
        id: ALPHA.id,
        public_key: ALPHA.publicKeyB64,
        label: "Alpha",
        added_at: "2026-10-12",
        revoked_at: null,
      },
      {
        id: BETA.id,
        public_key: BETA.publicKeyB64,
        added_at: "2026-10-12",
      },
    ],
    ...overrides,
  };
}

const docString = (doc: unknown) => JSON.stringify(doc);

// ── parseAdminKeybook ──

describe("parseAdminKeybook", () => {
  it("合法文档解析出条目与 64 位十六进制指纹", () => {
    const kb = parseAdminKeybook(docString(keybookDoc()));
    expect(kb.keys).toHaveLength(2);
    expect(kb.keys[0].id).toBe(ALPHA.id);
    expect(kb.keys[0].publicKeyB64).toBe(ALPHA.publicKeyB64);
    expect(kb.keys[0].label).toBe("Alpha");
    expect(kb.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(kb.loadedAt).toBeGreaterThan(0);
  });

  it("非 JSON / 非对象 → AdminKeybookError", () => {
    expect(() => parseAdminKeybook("{not json")).toThrowError(AdminKeybookError);
    expect(() => parseAdminKeybook('"a string"')).toThrowError(AdminKeybookError);
  });

  it("version ≠ 1 / keys 非数组 / 空数组 → 拒", () => {
    expect(() => parseAdminKeybook(docString(keybookDoc({ version: 2 })))).toThrowError(
      /version 不支持/
    );
    expect(() => parseAdminKeybook(docString(keybookDoc({ keys: "x" })))).toThrowError(
      /keys 必须是数组/
    );
    expect(() => parseAdminKeybook(docString(keybookDoc({ keys: [] })))).toThrowError(
      /keys 为空/
    );
  });

  it("id 非法（含点号 / 空 / 超长）与重复 id → 拒", () => {
    const bad = (id: string) =>
      parseAdminKeybook(
        docString({ version: 1, keys: [{ id, public_key: ALPHA.publicKeyB64 }] })
      );
    expect(() => bad("has.dot")).toThrowError(/id 非法/);
    expect(() => bad("")).toThrowError(/id 非法/);
    expect(() => bad("-leading")).toThrowError(/id 非法/);
    expect(() => bad("x".repeat(65))).toThrowError(/id 非法/);
    expect(() =>
      parseAdminKeybook(
        docString({
          version: 1,
          keys: [
            { id: "dup", public_key: ALPHA.publicKeyB64 },
            { id: "dup", public_key: BETA.publicKeyB64 },
          ],
        })
      )
    ).toThrowError(/重复 id/);
  });

  it("public_key 非法（字符集 / 31 字节 / 非规范回环）→ 拒", () => {
    const withKey = (publicKey: string) =>
      parseAdminKeybook(
        docString({ version: 1, keys: [{ id: "k1", public_key: publicKey }] })
      );
    expect(() => withKey("not base64url!!")).toThrowError(/public_key 非法/);
    expect(() =>
      withKey(Buffer.alloc(31).toString("base64url"))
    ).toThrowError(/public_key 非法/);
    // "AA=" 带 padding：字符集正则即拒（Buffer 宽松解码会静默吞掉非法字符，回环/字符集校验兜底）
    expect(() => withKey("AA=")).toThrowError(/public_key 非法/);
  });

  it("revoked_at 非字符串非 null → 拒；字符串即标记撤销", () => {
    expect(() =>
      parseAdminKeybook(
        docString({
          version: 1,
          keys: [{ id: "k1", public_key: ALPHA.publicKeyB64, revoked_at: 123 }],
        })
      )
    ).toThrowError(/revoked_at 必须是字符串或 null/);
    const kb = parseAdminKeybook(
      docString({
        version: 1,
        keys: [{ id: "k1", public_key: ALPHA.publicKeyB64, revoked_at: "2026-10-12" }],
      })
    );
    expect(isAdminKeyRevoked(kb.keys[0])).toBe(true);
  });

  it("错误消息不回显公钥内容（只报字段路径）", () => {
    try {
      parseAdminKeybook(
        docString({ version: 1, keys: [{ id: "k1", public_key: "short!" }] })
      );
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("keys[0].public_key");
      expect((err as Error).message).not.toContain(ALPHA.publicKeyB64);
    }
  });
});

// ── 指纹 ──

describe("computeKeybookFingerprint（稳定性与敏感性）", () => {
  it("条目乱序 → 同指纹（按 id 排序规范化）", () => {
    const a = parseAdminKeybook(docString(keybookDoc()));
    const reversed = parseAdminKeybook(
      docString({ ...keybookDoc(), keys: [...keybookDoc().keys].reverse() })
    );
    expect(a.fingerprint).toBe(reversed.fingerprint);
  });

  it("label / added_at 变化 → 同指纹（展示元数据不炸会话）", () => {
    const doc = keybookDoc();
    const relabeled = {
      ...doc,
      keys: doc.keys.map((k: Record<string, unknown>) => ({
        ...k,
        label: "改个标签",
        added_at: "2099-01-01",
      })),
    };
    expect(computeKeybookFingerprint(parseAdminKeybook(docString(doc)).keys)).toBe(
      parseAdminKeybook(docString(relabeled)).fingerprint
    );
  });

  it("换公钥 / 增删条目 / 改 revoked_at → 指纹变化（换本=旧会话全失效）", () => {
    const base = parseAdminKeybook(docString(keybookDoc()));
    const swapped = parseAdminKeybook(
      docString({
        ...keybookDoc(),
        keys: [{ id: ALPHA.id, public_key: BETA.publicKeyB64 }, keybookDoc().keys[1]],
      })
    );
    const added = parseAdminKeybook(
      docString({
        ...keybookDoc(),
        keys: [...keybookDoc().keys, { id: "gamma", public_key: makeKeyMaterial("g").publicKeyB64 }],
      })
    );
    const revoked = parseAdminKeybook(
      docString({
        ...keybookDoc(),
        keys: [{ ...keybookDoc().keys[0], revoked_at: "2026-10-12" }, keybookDoc().keys[1]],
      })
    );
    expect(swapped.fingerprint).not.toBe(base.fingerprint);
    expect(added.fingerprint).not.toBe(base.fingerprint);
    expect(revoked.fingerprint).not.toBe(base.fingerprint);
  });
});

// ── loadAdminKeybook（双源，注入 fs/fetch，不落真实 IO） ──

describe("loadAdminKeybook", () => {
  it("空来源 → 拒（显式禁用走删除 ADMIN_KEYBOOK，而不是空串）", async () => {
    await expect(loadAdminKeybook("   ")).rejects.toThrowError(/为空/);
  });

  it("本地路径：readFileImpl 注入", async () => {
    const readFileImpl = vi.fn(async () => docString(keybookDoc()));
    const kb = await loadAdminKeybook("./keybook.json", { readFileImpl });
    expect(readFileImpl).toHaveBeenCalledWith("./keybook.json");
    expect(kb.keys).toHaveLength(2);
  });

  it("本地路径读取失败 → AdminKeybookError 含路径", async () => {
    const readFileImpl = async () => {
      throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    };
    await expect(
      loadAdminKeybook("/etc/keybook.json", { readFileImpl })
    ).rejects.toThrowError(/\/etc\/keybook\.json \(ENOENT\)/);
  });

  it("URL 来源：fetchImpl 注入，2xx 文本入解析", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => docString(keybookDoc()),
    }));
    const kb = await loadAdminKeybook("https://bucket.example.com/keybook.json", {
      // 类型收窄：测试替身覆盖 signal 用法
      fetchImpl: fetchImpl as never,
    });
    expect(kb.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("URL 非 2xx → 拒且消息含状态码不含 URL", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => "",
    }));
    const url = "https://bucket.example.com/kb?sig=SECRET";
    await expect(loadAdminKeybook(url, { fetchImpl: fetchImpl as never })).rejects.toThrowError(
      /HTTP 403/
    );
    try {
      await loadAdminKeybook(url, { fetchImpl: fetchImpl as never });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("SECRET");
      expect((err as Error).message).not.toContain(url);
    }
  });

  it("URL 网络失败 → 消息脱敏（不回显 URL/凭据）", async () => {
    const url = "https://bucket.example.com/kb?sig=SECRET";
    const fetchImpl = vi.fn(async () => {
      throw new Error(`fetch to ${url} failed`);
    });
    try {
      await loadAdminKeybook(url, { fetchImpl: fetchImpl as never });
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("远端取件失败");
      expect(message).not.toContain("SECRET");
      expect(message).not.toContain(url);
    }
  });

  it("超时：fetchImpl 挂起 → abort（timeoutMs 生效）", async () => {
    const fetchImpl = (
      _url: string,
      init: { signal: AbortSignal }
    ) =>
      new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted"))
        );
      });
    await expect(
      loadAdminKeybook("https://slow.example.com/kb.json", {
        fetchImpl: fetchImpl as never,
        timeoutMs: 20,
      })
    ).rejects.toThrowError(/远端取件失败/);
  });

  it("来源内容非法 → AdminKeybookError（解析失败即加载失败）", async () => {
    const readFileImpl = async () => "{oops";
    await expect(loadAdminKeybook("kb.json", { readFileImpl })).rejects.toThrowError(
      AdminKeybookError
    );
  });
});

// ── verifyKeybookSignature（Ed25519 查本验签） ──

describe("verifyKeybookSignature", () => {
  let keybook: LoadedAdminKeybook;
  const HOST = "core.example.com";
  const TS = 1_000_000_000;
  const NONCE = "test-nonce-abc";

  beforeEach(() => {
    keybook = parseAdminKeybook(docString(keybookDoc()));
  });

  const message = (keyId: string) =>
    buildAdminLoginMessage({ keyId, nonceB64: NONCE, host: HOST, ts: TS });

  it("正确私钥签名规范串 → 验签通过", () => {
    expect(
      verifyKeybookSignature(keybook, ALPHA.id, message(ALPHA.id), ALPHA.sign(message(ALPHA.id)))
    ).toBe(true);
  });

  it("BETA 的签名冒充 ALPHA key_id → 拒", () => {
    expect(
      verifyKeybookSignature(keybook, ALPHA.id, message(ALPHA.id), BETA.sign(message(ALPHA.id)))
    ).toBe(false);
  });

  it("消息被篡改（ts / host / nonce / key_id 域）→ 拒", () => {
    const signature = ALPHA.sign(message(ALPHA.id));
    expect(
      verifyKeybookSignature(keybook, ALPHA.id, message(ALPHA.id) + ".x", signature)
    ).toBe(false);
    const tampered = buildAdminLoginMessage({
      keyId: ALPHA.id,
      nonceB64: "other-nonce",
      host: HOST,
      ts: TS,
    });
    expect(verifyKeybookSignature(keybook, ALPHA.id, tampered, signature)).toBe(false);
  });

  it("未知 key_id / 已撤销条目 → 拒", () => {
    expect(
      verifyKeybookSignature(keybook, "ghost", message("ghost"), ALPHA.sign(message("ghost")))
    ).toBe(false);
    const revokedKb = parseAdminKeybook(
      docString({
        ...keybookDoc(),
        keys: [{ ...keybookDoc().keys[0], revoked_at: "2026-10-12" }, keybookDoc().keys[1]],
      })
    );
    expect(
      verifyKeybookSignature(revokedKb, ALPHA.id, message(ALPHA.id), ALPHA.sign(message(ALPHA.id)))
    ).toBe(false);
  });

  it("畸形签名（长度≠64 / 非 base64url / 空）→ 拒且不抛", () => {
    const msg = message(ALPHA.id);
    expect(verifyKeybookSignature(keybook, ALPHA.id, msg, "")).toBe(false);
    expect(verifyKeybookSignature(keybook, ALPHA.id, msg, "short")).toBe(false);
    expect(verifyKeybookSignature(keybook, ALPHA.id, msg, "has=padding+and/slash")).toBe(false);
    expect(verifyKeybookSignature(keybook, ALPHA.id, msg, "A".repeat(86))).toBe(false);
  });

  it("PKCS8 PEM 互操作：从私钥 PEM 重导入再签名，密码本条目验签通过（登录伴侣同款密钥形态）", () => {
    const fromPem = createPrivateKey(ALPHA.privatePem);
    const msg = message(ALPHA.id);
    const signature = cryptoSign(null, Buffer.from(msg, "utf8"), fromPem).toString("base64url");
    expect(verifyKeybookSignature(keybook, ALPHA.id, msg, signature)).toBe(true);
  });
});

// ── initAdminRuntime（启动一次性装配） ──

describe("initAdminRuntime", () => {
  beforeEach(() => {
    resetAdminRuntimeForTest();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    resetAdminRuntimeForTest();
  });

  it("ADMIN_KEYBOOK 未设置 → 禁用态，不触发任何加载", async () => {
    const readFileImpl = vi.fn(async () => docString(keybookDoc()));
    const runtime = await initAdminRuntime({ env: {}, load: { readFileImpl } });
    expect(runtime.enabled).toBe(false);
    expect(runtime.fingerprint).toBeNull();
    expect(runtime.loadError).toBeNull();
    expect(readFileImpl).not.toHaveBeenCalled();
  });

  it("本地密码本加载成功 → enabled + 指纹；进程内仅加载一次（缓存）", async () => {
    const readFileImpl = vi.fn(async () => docString(keybookDoc()));
    const first = await initAdminRuntime({
      env: { ADMIN_KEYBOOK: "kb.json" },
      load: { readFileImpl },
    });
    expect(first.enabled).toBe(true);
    expect(first.fingerprint).toBe(parseAdminKeybook(docString(keybookDoc())).fingerprint);

    const second = await initAdminRuntime();
    expect(second).toBe(first);
    expect(readFileImpl).toHaveBeenCalledTimes(1); // 守卫惰性调用命中缓存

    const forced = await initAdminRuntime({
      env: { ADMIN_KEYBOOK: "kb.json" },
      load: { readFileImpl },
      force: true,
    });
    expect(forced.enabled).toBe(true);
    expect(readFileImpl).toHaveBeenCalledTimes(2);
  });

  it("加载失败 → 禁用态 + loadError + console.warn（无回退、永不抛）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const readFileImpl = async () => {
      throw new Error("boom");
    };
    const runtime = await initAdminRuntime({
      env: { ADMIN_KEYBOOK: "missing.json" },
      load: { readFileImpl },
    });
    expect(runtime.enabled).toBe(false);
    expect(runtime.fingerprint).toBeNull();
    expect(runtime.loadError).toContain("missing.json");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("URL 来源经 fetchImpl 装配成功", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => docString(keybookDoc()),
    }));
    const runtime = await initAdminRuntime({
      env: { ADMIN_KEYBOOK: "https://bucket.example.com/keybook.json" },
      load: { fetchImpl: fetchImpl as never },
    });
    expect(runtime.enabled).toBe(true);
    expect(runtime.source).toBe("https://bucket.example.com/keybook.json");
  });

  it("getAdminRuntimeCached：settle 前 null，settle 后同步可读", async () => {
    expect(getAdminRuntimeCached()).toBeNull();
    const pending = initAdminRuntime({ env: {} });
    const runtime = await pending;
    expect(getAdminRuntimeCached()).toBe(runtime);
  });
});
