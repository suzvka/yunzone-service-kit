/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-10-13 */
/**
 * storage 渠道开放注册表 — 单元测试（2026-10-13 开放化改造）
 * 业务注册自定义渠道经同一 resolveStorageChannel / createObjectStore 分派；内置渠道不可置换。
 */

import { describe, expect, it } from "vitest";
import {
  ObjectStoreConfigError,
  createObjectStore,
  isKnownStorageChannel,
  listRegisteredStorageChannels,
  registerStorageChannel,
  resolveStorageChannel,
  unregisterStorageChannel,
} from "../src/storage";
import type { ObjectStore, UploadParams, GetUploadUrlOptions } from "../src/storage";

/** 最小契约桩（与 storage.test.ts StubObjectStore 同思路，仅覆盖分派面） */
class StubStore implements ObjectStore {
  readonly envSeen: Record<string, string | undefined>;
  constructor(env: Record<string, string | undefined>) {
    this.envSeen = env;
  }
  async upload(_params: UploadParams): Promise<string> {
    return "stub-key";
  }
  async getSignedUrl(key: string, _expireSeconds?: number): Promise<string> {
    return `https://stub.example/${key}`;
  }
  async getUploadUrl(options: GetUploadUrlOptions): Promise<string> {
    return `https://stub.example/${options.key}`;
  }
  async delete(_key: string): Promise<boolean> {
    return true;
  }
  async exists(_key: string): Promise<boolean> {
    return true;
  }
}

describe("registerStorageChannel（开放注册）", () => {
  it("注册后 resolveStorageChannel 接受该渠道；createObjectStore 分派到注册工厂", () => {
    const store = new StubStore({});
    registerStorageChannel("stub", () => store);
    try {
      expect(isKnownStorageChannel("stub")).toBe(true);
      expect(resolveChannelOf("stub")).toBe("stub");
      expect(createObjectStore({ channel: "stub" })).toBe(store);
    } finally {
      unregisterStorageChannel("stub");
    }
  });

  it("工厂接收调用时环境快照（env 注入透传）", () => {
    let seen: Record<string, string | undefined> = {};
    registerStorageChannel("stub-env", ({ env }) => {
      seen = env;
      return new StubStore(env);
    });
    try {
      createObjectStore({ channel: "stub-env" }, { STUB_TOKEN: "abc" });
      expect(seen.STUB_TOKEN).toBe("abc");
    } finally {
      unregisterStorageChannel("stub-env");
    }
  });

  it("同名重复注册 = 覆盖（组合根责任自负）", () => {
    const first = new StubStore({});
    const second = new StubStore({});
    registerStorageChannel("dup", () => first);
    registerStorageChannel("dup", () => second);
    try {
      expect(createObjectStore({ channel: "dup" })).toBe(second);
    } finally {
      unregisterStorageChannel("dup");
    }
  });

  it("内置渠道名（s3/coze/none）禁止注册与注销（官方语义不可被业务置换）", () => {
    for (const builtin of ["s3", "coze", "none"]) {
      expect(() => registerStorageChannel(builtin, () => new StubStore({}))).toThrowError(
        ObjectStoreConfigError
      );
      expect(unregisterStorageChannel(builtin)).toBe(false);
    }
  });

  it("unregister 后渠道回到非法值域（resolve 拒绝并提示已注册列表）", () => {
    registerStorageChannel("ghost", () => new StubStore({}));
    unregisterStorageChannel("ghost");
    expect(isKnownStorageChannel("ghost")).toBe(false);
    expect(() => resolveChannelOf("ghost")).toThrowError(/STORAGE_PROVIDER 非法: "ghost"/);
  });

  it("resolve 非法值的诊断消息在无注册渠道时保持原格式（兼容既有断言）", () => {
    expect(listRegisteredStorageChannels().length >= 0).toBe(true);
    try {
      resolveChannelOf("minio");
      expect.unreachable("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ObjectStoreConfigError);
      expect((e as Error).message).toMatch(/支持: s3, coze, none/);
    }
  });
});

/** resolveStorageChannel 的 env 注入便捷包装（保持调用面聚焦） */
function resolveChannelOf(value: string): string {
  return resolveStorageChannel({ STORAGE_PROVIDER: value }) as string;
}
