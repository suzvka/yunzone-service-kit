/**
 * storage 模块 — 单元测试（ObjectStore 契约）
 */

import { describe, expect, it, vi } from "vitest";
import {
  S3ObjectStore,
  ObjectStoreConfigError,
  ObjectStoreError,
  createObjectStore,
  resolveStorageChannel,
} from "../src/storage";
import type { ObjectStore, UploadParams } from "../src/storage";
import { resolveStorageConfig } from "../src/config";

// 签名 URL 生成依赖真实 S3Client 配置，单测只验证委托参数与返回面
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async (
      _client: unknown,
      _command: unknown,
      options: { expiresIn?: number }
    ) => `https://signed.example/${options?.expiresIn ?? "default"}`
  ),
}));

/**
 * 契约测试桩：验证抽象本身的行为（接口形状、参数传递、生命周期）。
 * 不校验真实 S3 语义——真实语义由渠道适配器保证（S3ObjectStore 部分另行验证）。
 */
class StubObjectStore implements ObjectStore {
  calls: Array<{ kind: string; key?: string; params?: UploadParams }> = [];
  uploadResult = "avatars/user123.jpg";
  urlResult = "https://signed.example/1";
  deleteResult = true;
  existsResult = true;
  initCalled = false;
  disconnectCalled = false;

  async upload(params: UploadParams): Promise<string> {
    this.calls.push({ kind: "upload", params });
    return this.uploadResult;
  }

  async getSignedUrl(key: string, _expireSeconds?: number): Promise<string> {
    this.calls.push({ kind: "getSignedUrl", key });
    return this.urlResult;
  }

  async delete(key: string): Promise<boolean> {
    this.calls.push({ kind: "delete", key });
    return this.deleteResult;
  }

  async exists(key: string): Promise<boolean> {
    this.calls.push({ kind: "exists", key });
    return this.existsResult;
  }

  async init(): Promise<void> {
    this.initCalled = true;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
  }
}

describe("resolveStorageChannel", () => {
  it("STORAGE_PROVIDER 直读三渠道", () => {
    expect(resolveStorageChannel({ STORAGE_PROVIDER: "s3" })).toBe("s3");
    expect(resolveStorageChannel({ STORAGE_PROVIDER: "coze" })).toBe("coze");
    expect(resolveStorageChannel({ STORAGE_PROVIDER: "none" })).toBe("none");
  });

  it("未设置时默认 s3（与 db 默认 postgres 一致，不自动嗅探）", () => {
    expect(resolveStorageChannel({})).toBe("s3");
    expect(resolveStorageChannel({ STORAGE_PROVIDER: "" })).toBe("s3");
  });

  it("非法值抛 ObjectStoreConfigError 并列出支持项", () => {
    expect(() => resolveStorageChannel({ STORAGE_PROVIDER: "minio" })).toThrowError(
      ObjectStoreConfigError
    );
    expect(() => resolveStorageChannel({ STORAGE_PROVIDER: "minio" })).toThrowError(
      /STORAGE_PROVIDER 非法: "minio".*支持: s3, coze, none/
    );
  });
});

describe("ObjectStore 契约形状", () => {
  it("upload 返回注入的 key，参数原样传递", async () => {
    const stub = new StubObjectStore();
    const params: UploadParams = {
      fileContent: Buffer.from("data"),
      fileName: "avatars/user123.jpg",
      contentType: "image/jpeg",
    };

    const key = await stub.upload(params);
    expect(key).toBe("avatars/user123.jpg");
    expect(stub.calls).toEqual([{ kind: "upload", params }]);
  });

  it("getSignedUrl / delete / exists 按 key 透传", async () => {
    const stub = new StubObjectStore();
    expect(await stub.getSignedUrl("a/b.jpg")).toBe("https://signed.example/1");
    expect(await stub.delete("a/b.jpg")).toBe(true);
    expect(await stub.exists("a/b.jpg")).toBe(true);

    expect(stub.calls).toEqual([
      { kind: "getSignedUrl", key: "a/b.jpg" },
      { kind: "delete", key: "a/b.jpg" },
      { kind: "exists", key: "a/b.jpg" },
    ]);
  });

  it("生命周期钩子可调用（继承 LifecycleAware）", async () => {
    const stub = new StubObjectStore();
    await stub.init();
    await stub.disconnect();
    expect(stub.initCalled).toBe(true);
    expect(stub.disconnectCalled).toBe(true);
  });
});

describe("resolveStorageConfig", () => {
  it("s3 渠道：S3_* 必填变量解析，凭证缺省为 undefined", () => {
    const config = resolveStorageConfig({
      provider: "s3",
      env: {
        S3_ENDPOINT_URL: "https://s3.example.com",
        S3_BUCKET_NAME: "my-bucket",
      },
    });
    expect(config).toEqual({
      endpointUrl: "https://s3.example.com",
      bucket: "my-bucket",
      credentials: undefined,
    });
  });

  it("s3 渠道：凭证成对设置时返回 credentials", () => {
    const config = resolveStorageConfig({
      provider: "s3",
      env: {
        S3_ENDPOINT_URL: "https://s3.example.com",
        S3_BUCKET_NAME: "my-bucket",
        S3_ACCESS_KEY_ID: "ak",
        S3_SECRET_ACCESS_KEY: "sk",
      },
    });
    expect(config.credentials).toEqual({ accessKeyId: "ak", secretAccessKey: "sk" });
  });

  it("coze 渠道：COZE_BUCKET_* 变量组解析", () => {
    const config = resolveStorageConfig({
      provider: "coze",
      env: {
        COZE_BUCKET_ENDPOINT_URL: "https://coze-s3.example.com",
        COZE_BUCKET_NAME: "coze-bucket",
      },
    });
    expect(config).toEqual({
      endpointUrl: "https://coze-s3.example.com",
      bucket: "coze-bucket",
      credentials: undefined,
    });
  });

  it("s3 凭证缺失抛 ObjectStoreConfigError，诊断快照不回显值", () => {
    expect(() =>
      resolveStorageConfig({
        provider: "s3",
        env: { S3_ENDPOINT_URL: "https://s3.example.com" },
      })
    ).toThrowError(ObjectStoreConfigError);
    expect(() =>
      resolveStorageConfig({
        provider: "s3",
        env: { S3_ENDPOINT_URL: "https://s3.example.com" },
      })
    ).toThrowError(/S3_ENDPOINT_URL and S3_BUCKET_NAME are not set/);
    // 诊断快照只输出 set/unset，绝不回显配置值
    expect(() =>
      resolveStorageConfig({
        provider: "s3",
        env: { S3_ENDPOINT_URL: "https://s3.example.com" },
      })
    ).toThrowError(/S3_ENDPOINT_URL=\*\*\*set\*\*\*/);
    expect(() =>
      resolveStorageConfig({
        provider: "s3",
        env: { S3_ENDPOINT_URL: "https://s3.example.com" },
      })
    ).not.toThrowError(/https:\/\/s3\.example\.com/);
  });

  it("coze 凭证缺失抛 ObjectStoreConfigError", () => {
    expect(() => resolveStorageConfig({ provider: "coze", env: {} })).toThrowError(
      ObjectStoreConfigError
    );
    expect(() => resolveStorageConfig({ provider: "coze", env: {} })).toThrowError(
      /missing required env vars/
    );
  });

  it("凭证只设置其一抛错（配置不完整 fail-fast，禁止隐式降级）", () => {
    expect(() =>
      resolveStorageConfig({
        provider: "s3",
        env: {
          S3_ENDPOINT_URL: "https://s3.example.com",
          S3_BUCKET_NAME: "b",
          S3_ACCESS_KEY_ID: "ak",
        },
      })
    ).toThrowError(ObjectStoreConfigError);
    expect(() =>
      resolveStorageConfig({
        provider: "s3",
        env: {
          S3_ENDPOINT_URL: "https://s3.example.com",
          S3_BUCKET_NAME: "b",
          S3_ACCESS_KEY_ID: "ak",
        },
      })
    ).toThrowError(/Incomplete credentials/);
  });

  it("非法 provider 抛 ObjectStoreConfigError 并列出支持项", () => {
    expect(() => resolveStorageConfig({ provider: "minio" as never, env: {} })).toThrowError(
      ObjectStoreConfigError
    );
    expect(() => resolveStorageConfig({ provider: "minio" as never, env: {} })).toThrowError(
      /Unknown provider: "minio".*Supported: s3, coze/
    );
  });
});

describe("工厂", () => {
  it("createObjectStore 按渠道分派凭证获取并返回 S3ObjectStore 实例", () => {
    const s3 = createObjectStore(
      { channel: "s3" },
      { S3_ENDPOINT_URL: "https://s3.example.com", S3_BUCKET_NAME: "b" }
    );
    expect(s3).toBeInstanceOf(S3ObjectStore);

    const coze = createObjectStore(
      { channel: "coze" },
      {
        COZE_BUCKET_ENDPOINT_URL: "https://coze-s3.example.com",
        COZE_BUCKET_NAME: "cb",
      }
    );
    expect(coze).toBeInstanceOf(S3ObjectStore);
  });

  it("none 渠道（显式无存储声明）创建执行器直接抛 ObjectStoreConfigError（fail-fast，不做降级）", () => {
    expect(() => createObjectStore({ channel: "none" }, {})).toThrowError(
      ObjectStoreConfigError
    );
    expect(() => createObjectStore({ channel: "none" }, {})).toThrowError(
      /none.*不应创建存储执行器/
    );
  });

  it("凭证缺失时抛 ObjectStoreConfigError（fail-fast，禁止自动嗅探）", () => {
    expect(() => createObjectStore({ channel: "s3" }, {})).toThrowError(
      ObjectStoreConfigError
    );
    expect(() => createObjectStore({ channel: "coze" }, {})).toThrowError(
      ObjectStoreConfigError
    );
  });
});

describe("S3ObjectStore 适配器", () => {
  /** 注入的伪 S3Client：记录收到的命令，供断言命令构造 */
  function makeStubClient() {
    const send = vi.fn();
    return { send } as unknown as import("@aws-sdk/client-s3").S3Client;
  }

  const baseConfig = {
    endpointUrl: "https://s3.example.com",
    bucket: "my-bucket",
  };

  it("upload 构造 PutObjectCommand（key 即 fileName）并返回 fileName", async () => {
    const client = makeStubClient();
    const sendMock = client.send as unknown as ReturnType<typeof vi.fn>;
    sendMock.mockResolvedValue({});

    const store = new S3ObjectStore(baseConfig, { client });
    const content = Buffer.from("hello");
    const key = await store.upload({
      fileContent: content,
      fileName: "avatars/user123.jpg",
      contentType: "image/jpeg",
    });

    expect(key).toBe("avatars/user123.jpg");
    const command = sendMock.mock.calls[0][0];
    expect(command.constructor.name).toBe("PutObjectCommand");
    expect(command.input).toEqual({
      Bucket: "my-bucket",
      Key: "avatars/user123.jpg",
      Body: content,
      ContentType: "image/jpeg",
    });
  });

  it("getSignedUrl 委托 presigner（默认 86400s，可覆盖）", async () => {
    const client = makeStubClient();
    const store = new S3ObjectStore(baseConfig, { client });

    const url = await store.getSignedUrl("a/b.jpg");
    expect(url).toBe("https://signed.example/86400");

    const url2 = await store.getSignedUrl("a/b.jpg", 600);
    expect(url2).toBe("https://signed.example/600");
  });

  it("delete 构造 DeleteObjectCommand 并返回 true（幂等）", async () => {
    const client = makeStubClient();
    const sendMock = client.send as unknown as ReturnType<typeof vi.fn>;
    sendMock.mockResolvedValue({});

    const store = new S3ObjectStore(baseConfig, { client });
    expect(await store.delete("a/b.jpg")).toBe(true);

    const command = sendMock.mock.calls[0][0];
    expect(command.constructor.name).toBe("DeleteObjectCommand");
    expect(command.input).toEqual({ Bucket: "my-bucket", Key: "a/b.jpg" });
  });

  it("exists：HeadObject 命中返回 true；404 归一化为 false", async () => {
    const client = makeStubClient();
    const sendMock = client.send as unknown as ReturnType<typeof vi.fn>;
    const store = new S3ObjectStore(baseConfig, { client });

    sendMock.mockResolvedValueOnce({});
    expect(await store.exists("a/b.jpg")).toBe(true);

    sendMock.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    expect(await store.exists("missing.jpg")).toBe(false);

    const command = sendMock.mock.calls[0][0];
    expect(command.constructor.name).toBe("HeadObjectCommand");
    expect(command.input).toEqual({ Bucket: "my-bucket", Key: "a/b.jpg" });
  });

  it("非 404 错误包装为 ObjectStoreError 并保留 cause", async () => {
    const client = makeStubClient();
    const sendMock = client.send as unknown as ReturnType<typeof vi.fn>;
    sendMock.mockRejectedValue(new Error("network down"));

    const store = new S3ObjectStore(baseConfig, { client });
    await expect(store.exists("a/b.jpg")).rejects.toBeInstanceOf(ObjectStoreError);
    await expect(store.upload({ fileContent: Buffer.from("x"), fileName: "a" })).rejects.toBeInstanceOf(
      ObjectStoreError
    );

    try {
      await store.upload({ fileContent: Buffer.from("x"), fileName: "a" });
    } catch (err) {
      expect((err as Error).cause).toBeInstanceOf(Error);
      expect(((err as Error).cause as Error).message).toBe("network down");
    }
  });

  it("disconnect 释放客户端", async () => {
    const client = makeStubClient();
    const destroy = vi.fn();
    Object.defineProperty(client, "destroy", { value: destroy });

    const store = new S3ObjectStore(baseConfig, { client });
    await store.disconnect();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
