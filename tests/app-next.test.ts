/**
 * app 标准端点托管（app/next）— 单元测试
 */

import { describe, expect, it } from "vitest";
import { APP_MANIFEST_WELL_KNOWN_PATH } from "../src/app";
import { createAppManifestHandler } from "../src/app/next";
import type { AppManifest } from "../src/app";

/** 合法完整 manifest（全字段） */
function fullManifest(): AppManifest {
  return {
    schemaVersion: "1.0",
    app: {
      id: "wanyanai",
      name: "WanyanAI",
      tagline: "AI 驱动的文本诊断专家",
      description: "插件化智能文本分析平台，框架开源，功能插件支持按需定制。",
      href: "https://wanyan.coze.site",
      status: "live",
      assets: { icon: "https://wanyan.coze.site/app-icon.png" },
      tags: ["开源框架", "可定制"],
    },
  };
}

describe("createAppManifestHandler", () => {
  it("静态 manifest 返回 200 + 契约 JSON + 缓存头", async () => {
    const handler = createAppManifestHandler({ manifest: fullManifest() });
    const res = await handler();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("Content-Type")).toContain("application/json");

    const body = await res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.app.id).toBe("wanyanai");
    expect(body.app.status).toBe("live");
  });

  it("函数式 manifest（动态 status）每次请求求值生效", async () => {
    let status: "live" | "maintenance" = "live";
    const handler = createAppManifestHandler({
      manifest: () => ({ ...fullManifest(), app: { ...fullManifest().app, status } }),
    });

    const first = await (await handler()).json();
    expect(first.app.status).toBe("live");

    status = "maintenance";
    const second = await (await handler()).json();
    expect(second.app.status).toBe("maintenance");
  });

  it("非法 manifest 返回 500 + 固定错误码（不泄漏诊断细节）", async () => {
    const handler = createAppManifestHandler({
      manifest: { schemaVersion: "1.0", app: {} } as unknown as AppManifest,
    });
    const res = await handler();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("APP_MANIFEST_INVALID");
    expect(body.message).toBe("invalid app manifest");
    // 不泄漏 zod 字段路径诊断
    expect(JSON.stringify(body)).not.toContain("app.name");
  });

  it("标准端点路径常量导出正确", () => {
    expect(APP_MANIFEST_WELL_KNOWN_PATH).toBe("/.well-known/app-manifest.json");
  });
});
