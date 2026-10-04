/** test-meta: tier=fast; risk=medium; owner=platform; expires=2027-03-31 */
/**
 * app 应用目录契约 — 单元测试
 */

import { describe, expect, it, vi } from "vitest";
import {
  APP_MANIFEST_SCHEMA_VERSION,
  AppManifestError,
  parseAppManifest,
  resolveAppCatalog,
} from "../src/app";
import type { AppManifest } from "../src/app";

/** 合法完整 manifest（全字段） */
function fullManifest(): AppManifest {
  return {
    schemaVersion: "1.0",
    apis: [
      {
        id: "text-diagnose",
        name: "文本诊断",
        summary: "对输入文本执行框架级诊断分析。",
        method: "POST",
        path: "/api/v1/text/diagnose",
        tags: ["文本", "同步"],
        // 接入要点层（全字段）
        auth: "公开",
        request: [
          { name: "text", required: true, note: "待诊断文本" },
          { name: "locale", note: "输出语言；缺省服务端默认" },
        ],
        response: [{ name: "diagnosis", required: true, note: "诊断结论" }],
        errors: [{ status: 429, note: "调用过于频繁" }],
        docs: "https://docs.example.com/wanyanai/text-diagnose",
      },
      {
        id: "plugin-list",
        name: "插件清单",
        summary: "返回当前已启用的功能插件列表。",
        path: "/api/v1/plugins",
      },
    ],
    app: {
      id: "wanyanai",
      name: "WanyanAI",
      tagline: "AI 驱动的文本诊断专家",
      description: "插件化智能文本分析平台，框架开源，功能插件支持按需定制。",
      href: "https://wanyan.coze.site",
      status: "live",
      assets: {
        icon: "/icons/wanyanai.png",
        cover: "/covers/wanyanai.png",
        banner: "/banners/wanyanai.png",
      },
      tags: ["开源框架", "可定制"],
      links: {
        docs: "https://docs.example.com/wanyanai",
        source: "https://github.com/example/wanyanai",
      },
    },
  };
}

/** 最小合法 manifest（仅必填字段） */
function minimalManifest(overrides: Record<string, unknown> = {}): AppManifest {
  return {
    schemaVersion: "1.0",
    app: {
      id: "rimlife",
      name: "RimLife-API",
      description: "RimWorld 专用 LLM 接口，预置游戏世界知识。",
      href: "https://rimlife.example.com",
      assets: { icon: "/icons/rimlife.png" },
      ...overrides,
    },
  };
}

describe("parseAppManifest", () => {
  it("解析合法完整 manifest，全字段保留", () => {
    const fixture = fullManifest();
    const manifest = parseAppManifest(fixture, "wanyanai");
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.app.id).toBe("wanyanai");
    expect(manifest.app.name).toBe("WanyanAI");
    // 期望值引用夹具字段（不手抄第二份副本）
    expect(manifest.app.tagline).toBe(fixture.app.tagline);
    expect(manifest.app.description).toBe(fixture.app.description);
    expect(manifest.app.href).toBe("https://wanyan.coze.site");
    expect(manifest.app.status).toBe("live");
    expect(manifest.app.assets).toEqual({
      icon: "/icons/wanyanai.png",
      cover: "/covers/wanyanai.png",
      banner: "/banners/wanyanai.png",
    });
    expect(manifest.app.tags).toEqual(fixture.app.tags);
    expect(manifest.app.links).toEqual({
      docs: "https://docs.example.com/wanyanai",
      source: "https://github.com/example/wanyanai",
      support: undefined,
    });
    expect(manifest.apis).toHaveLength(2);
    expect(manifest.apis[0]).toEqual({
      id: "text-diagnose",
      name: "文本诊断",
      summary: "对输入文本执行框架级诊断分析。",
      method: "POST",
      path: "/api/v1/text/diagnose",
      tags: ["文本", "同步"],
      auth: "公开",
      request: [
        { name: "text", required: true, note: "待诊断文本" },
        { name: "locale", required: false, note: "输出语言；缺省服务端默认" },
      ],
      response: [{ name: "diagnosis", required: true, note: "诊断结论" }],
      errors: [{ status: 429, note: "调用过于频繁" }],
      docs: "https://docs.example.com/wanyanai/text-diagnose",
    });
  });

  it("缺省字段归一化：status → live、tags → []", () => {
    const manifest = parseAppManifest(minimalManifest());
    expect(manifest.app.status).toBe("live");
    expect(manifest.app.tags).toEqual([]);
    expect(manifest.app.tagline).toBeUndefined();
    expect(manifest.app.links).toBeUndefined();
  });

  it("apis 缺省归一化为 []，条目 method → GET、tags → []", () => {
    const manifest = parseAppManifest(minimalManifest());
    expect(manifest.apis).toEqual([]);
    const full = parseAppManifest(fullManifest());
    expect(full.apis[1].method).toBe("GET");
    expect(full.apis[1].tags).toEqual([]);
  });

  it("接入要点缺省归一化：request / response / errors → []、auth / docs → undefined、required → false", () => {
    const full = parseAppManifest(fullManifest());
    // 未声明接入要点的条目：集合类缺省 []、标量类缺省 undefined
    expect(full.apis[1].auth).toBeUndefined();
    expect(full.apis[1].request).toEqual([]);
    expect(full.apis[1].response).toEqual([]);
    expect(full.apis[1].errors).toEqual([]);
    expect(full.apis[1].docs).toBeUndefined();
    // required 缺省归一化为 false（locale 条目未声明 required）
    expect(full.apis[0].request[1].required).toBe(false);
  });

  it("接入要点非法形态（request 条目 name 空串）抛错，诊断含字段路径", () => {
    const manifest = fullManifest();
    manifest.apis = [
      {
        id: "x",
        name: "X",
        summary: "s",
        path: "/x",
        request: [{ name: "", required: true }],
      },
    ];
    try {
      parseAppManifest(manifest);
      expect.unreachable("should throw");
    } catch (err) {
      const e = err as AppManifestError;
      expect(e.code).toBe("APP_MANIFEST_INVALID");
      expect(e.message).toContain("apis.0.request.0.name");
    }
  });

  it("apis 条目重复 id 抛错（APP_MANIFEST_API_DUPLICATE_ID）", () => {
    const manifest = fullManifest();
    const entry = manifest.apis![0];
    manifest.apis = [entry, { ...entry }];
    expect(() => parseAppManifest(manifest)).toThrowError(
      expect.objectContaining({ code: "APP_MANIFEST_API_DUPLICATE_ID" })
    );
  });

  it("apis 条目非法形态（summary 空串）抛错，诊断含字段路径", () => {
    const manifest = fullManifest();
    manifest.apis = [
      { id: "x", name: "X", summary: "", method: "POST", path: "/x" },
    ];
    try {
      parseAppManifest(manifest);
      expect.unreachable("should throw");
    } catch (err) {
      const e = err as AppManifestError;
      expect(e.code).toBe("APP_MANIFEST_INVALID");
      expect(e.message).toContain("apis.0.summary");
    }
  });

  it("缺失必填字段（icon）抛 AppManifestError，code 为 APP_MANIFEST_INVALID", () => {
    expect(() =>
      parseAppManifest({
        schemaVersion: "1.0",
        app: {
          id: "x",
          name: "X",
          description: "desc",
          href: "https://x.example.com",
          assets: {},
        },
      })
    ).toThrowError(
      expect.objectContaining({
        name: "AppManifestError",
        code: "APP_MANIFEST_INVALID",
      })
    );
  });

  it("空字符串字段（name / href / description）抛 AppManifestError", () => {
    expect(() => parseAppManifest(minimalManifest({ name: "" }))).toThrowError(
      AppManifestError
    );
    expect(() =>
      parseAppManifest(minimalManifest({ href: "" }))
    ).toThrowError(AppManifestError);
    expect(() =>
      parseAppManifest(minimalManifest({ description: "" }))
    ).toThrowError(AppManifestError);
  });

  it("schemaVersion 非当前支持版本抛错（APP_MANIFEST_VERSION_UNSUPPORTED）", () => {
    expect(() =>
      parseAppManifest({ ...minimalManifest(), schemaVersion: "2.0" })
    ).toThrowError(
      expect.objectContaining({
        code: "APP_MANIFEST_VERSION_UNSUPPORTED",
      })
    );
  });

  it("source 参数出现在错误 message 中（便于定位来源）", () => {
    try {
      parseAppManifest({ schemaVersion: "9.9", app: {} }, "wanyanai/manifest.json");
      expect.unreachable("should throw");
    } catch (err) {
      const e = err as AppManifestError;
      expect(e.message).toContain("[wanyanai/manifest.json]");
    }
  });

  it("错误 message 含 zod 字段路径诊断", () => {
    try {
      parseAppManifest({ schemaVersion: "1.0", app: { id: "x" } });
      expect.unreachable("should throw");
    } catch (err) {
      const e = err as AppManifestError;
      expect(e.message).toContain("app.name");
      expect(e.message).toContain("app.assets");
      expect(e.message).toContain("app.href");
    }
  });
});

describe("resolveAppCatalog", () => {
  it("单条 entry：manifest 解析 + 归一化正确", () => {
    const fixture = fullManifest();
    const apps = resolveAppCatalog([
      { id: "wanyanai", manifest: fixture },
    ]);

    expect(apps).toHaveLength(1);
    const app = apps[0];
    expect(app.id).toBe("wanyanai");
    expect(app.name).toBe("WanyanAI");
    expect(app.tagline).toBe(fixture.app.tagline);
    expect(app.description).toBe(fixture.app.description);
    expect(app.href).toBe("https://wanyan.coze.site");
    expect(app.status).toBe("live");
    expect(app.assets.icon).toBe("/icons/wanyanai.png");
    expect(app.tags).toEqual(fixture.app.tags);
    expect(app.apis).toHaveLength(2);
    expect(app.apis[0].id).toBe("text-diagnose");
    expect(app.apis[0].method).toBe("POST");
    expect(app.apis[1].method).toBe("GET");
    expect(app.apis[1].tags).toEqual([]);
    // 接入要点随 manifest 一并透传（无编排覆盖语义）
    expect(app.apis[0].auth).toBe(fixture.apis![0].auth);
    expect(app.apis[0].request[0].name).toBe("text");
    expect(app.apis[0].errors[0].status).toBe(429);
    expect(app.links.docs).toBe("https://docs.example.com/wanyanai");
    expect(app.links.support).toBeUndefined();
    expect(app.order).toBeUndefined();
    expect(app.hidden).toBe(false);
  });

  it("tagline 缺省时回退 description", () => {
    const fixture = minimalManifest();
    const apps = resolveAppCatalog([
      { id: "rimlife", manifest: fixture },
    ]);
    expect(apps[0].tagline).toBe(fixture.app.description);
    expect(apps[0].apis).toEqual([]);
  });

  it("编排覆盖：name / status 覆盖 manifest 声明", () => {
    const overrideName = "万言 AI 文坛";
    const apps = resolveAppCatalog([
      {
        id: "wanyanai",
        manifest: fullManifest(),
        name: overrideName,
        status: "beta",
      },
    ]);
    expect(apps[0].name).toBe(overrideName);
    expect(apps[0].status).toBe("beta");
  });

  it("排序：有 order 的按数值升序在前，无 order 的按 id 稳定排后", () => {
    const apps = resolveAppCatalog([
      { id: "zeta", manifest: minimalManifest({ id: "zeta", name: "Z" }) },
      {
        id: "alpha",
        manifest: minimalManifest({ id: "alpha", name: "A" }),
        order: 2,
      },
      {
        id: "beta",
        manifest: minimalManifest({ id: "beta", name: "B" }),
        order: 1,
      },
    ]);
    expect(apps.map((a) => a.id)).toEqual(["beta", "alpha", "zeta"]);
  });

  it("hidden 标志保留不丢", () => {
    const apps = resolveAppCatalog([
      { id: "wanyanai", manifest: fullManifest(), hidden: true },
    ]);
    expect(apps[0].hidden).toBe(true);
  });

  it("manifest 支持 JSON 字符串输入", () => {
    const apps = resolveAppCatalog([
      { id: "wanyanai", manifest: JSON.stringify(fullManifest()) },
    ]);
    expect(apps[0].id).toBe("wanyanai");
    expect(apps[0].name).toBe("WanyanAI");
  });

  it("manifest 解析失败默认抛错（fail-fast）", () => {
    expect(() =>
      resolveAppCatalog([
        { id: "bad", manifest: JSON.stringify({ schemaVersion: "1.0" }) },
      ])
    ).toThrowError(
      expect.objectContaining({ code: "APP_MANIFEST_INVALID" })
    );
  });

  it("skipInvalid: true 时 warn 并跳过非法条目", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const apps = resolveAppCatalog(
        [
          { id: "bad", manifest: JSON.stringify({ schemaVersion: "1.0" }) },
          { id: "good", manifest: fullManifest() },
        ],
        { skipInvalid: true }
      );
      expect(apps.map((a) => a.id)).toEqual(["good"]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[app-catalog] skip invalid manifest for "bad"')
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("重复 id 抛错（APP_CATALOG_DUPLICATE_ID）", () => {
    expect(() =>
      resolveAppCatalog([
        { id: "wanyanai", manifest: fullManifest() },
        {
          id: "wanyanai",
          manifest: minimalManifest({ id: "wanyanai", name: "X" }),
        },
      ])
    ).toThrowError(
      expect.objectContaining({ code: "APP_CATALOG_DUPLICATE_ID" })
    );
  });

  it("纯函数幂等：相同输入两次调用结果一致", () => {
    const entries = [
      { id: "wanyanai", manifest: fullManifest(), order: 1 },
      { id: "rimlife", manifest: minimalManifest(), order: 2 },
    ];
    expect(resolveAppCatalog(entries)).toEqual(resolveAppCatalog(entries));
  });

  it("schemaVersion 常量导出为当前支持版本", () => {
    expect(APP_MANIFEST_SCHEMA_VERSION).toBe("1.0");
  });
});
