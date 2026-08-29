/**
 * /points 客户端执行层单测（stub 全局 fetch）
 *
 * 覆盖：balance / deduct 契约透传（含 duplicate 与 ok:false 业务结果不抛错）、
 * 鉴权头与 URL 组装、错误归一化（协议层失败抛 PointsServiceError）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPointsClient } from '../src/points/client';
import { PointsServiceError } from '../src/points/errors';
import { POINTS_ENDPOINTS } from '../src/points/types';

const BASE = 'https://user-center.example.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createPointsClient', () => {
  it('balance：POST 到契约端点，body 为 { accountId }，返回 { balance }', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balance: 100 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPointsClient({ baseUrl: `${BASE}/`, apiKey: 'sk-b' });
    const result = await client.balance({ accountId: 'acct-1' });

    expect(result).toEqual({ balance: 100 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}${POINTS_ENDPOINTS.balance}`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-b');
    expect(JSON.parse(init.body as string)).toEqual({ accountId: 'acct-1' });
  });

  it('deduct：请求体含 requestId / accountId / points / metadata，透传响应', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, duplicate: false, balance: 90 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPointsClient({ baseUrl: BASE, apiKey: 'sk-b' });
    const result = await client.deduct({
      requestId: 'req-1',
      accountId: 'acct-1',
      points: 10,
      metadata: { phase: 'settle' },
    });

    expect(result).toEqual({ ok: true, duplicate: false, balance: 90 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}${POINTS_ENDPOINTS.deduct}`);
    expect(JSON.parse(init.body as string)).toEqual({
      requestId: 'req-1',
      accountId: 'acct-1',
      points: 10,
      metadata: { phase: 'settle' },
    });
  });

  it('幂等命中：duplicate:true 正常返回，不抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, duplicate: true })));

    const client = createPointsClient({ baseUrl: BASE, apiKey: 'sk-b' });
    await expect(
      client.deduct({ requestId: 'req-1', accountId: 'acct-1', points: 10 }),
    ).resolves.toEqual({ ok: true, duplicate: true });
  });

  it('业务失败：ok:false + reason 正常返回（不属协议层错误）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: false, duplicate: false, reason: 'insufficient balance' })),
    );

    const client = createPointsClient({ baseUrl: BASE, apiKey: 'sk-b' });
    await expect(
      client.deduct({ requestId: 'req-2', accountId: 'acct-1', points: 999 }),
    ).resolves.toMatchObject({ ok: false, reason: 'insufficient balance' });
  });

  it('非 2xx → PointsServiceError（调用方可按契约以同一 requestId 安全重试）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'internal' }, 500)));

    const client = createPointsClient({ baseUrl: BASE, apiKey: 'sk-b' });
    await expect(
      client.deduct({ requestId: 'req-1', accountId: 'acct-1', points: 10 }),
    ).rejects.toMatchObject({ name: 'PointsServiceError', code: 'POINTS_PROTOCOL_ERROR' });
  });

  it('网络失败 → PointsServiceError，cause 保留根因', async () => {
    const root = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(root)));

    const client = createPointsClient({ baseUrl: BASE, apiKey: 'sk-b' });
    await expect(client.balance({ accountId: 'acct-1' })).rejects.toSatisfy(
      (err: PointsServiceError) => {
        expect(err).toBeInstanceOf(PointsServiceError);
        expect(err.cause).toBe(root);
        return true;
      },
    );
  });

  it('apiKey 为空时不携带 Authorization 头', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ balance: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createPointsClient({ baseUrl: BASE });
    await client.balance({ accountId: 'acct-1' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
