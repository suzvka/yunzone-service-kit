/**
 * /auth 客户端执行层单测（stub 全局 fetch）
 *
 * 覆盖：introspect 透传（含防枚举语义不抛错）/ 鉴权头 / 错误归一化
 * （服务端错误码保留、网络失败 cause 保留、超时）/ healthz 三态。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthCenterClient } from '../src/auth/client';
import { AuthCenterError } from '../src/auth/errors';
import { TOKEN_ENDPOINTS } from '../src/auth/token-contract';

const BASE = 'https://auth.example.com';

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

describe('createAuthCenterClient.introspect', () => {
  it('POST 到契约端点，携带 Bearer 头与 JSON body，透传响应', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ active: true, productId: 'prod-1', userId: 'u-1', claims: { accountId: 'acct-1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    const result = await client.introspect({ token: 'tok-1' });

    expect(result.active).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}${TOKEN_ENDPOINTS.introspect}`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'tok-1' });
  });

  it('无效 token：服务端 200 + active:false 语义透传，不抛错（防枚举）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ active: false })));

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    await expect(client.introspect({ token: 'bad' })).resolves.toEqual({ active: false });
  });

  it('apiKey 为空时不携带 Authorization 头（匿名视图）', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ active: false }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createAuthCenterClient({ baseUrl: BASE });
    await client.introspect({ token: 'tok-1' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('非 2xx 且响应体含服务端错误码 → AuthCenterError.code 保留服务端码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'RATE_LIMITED', message: 'slow down' }, 429)));

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    await expect(client.introspect({ token: 'tok-1' })).rejects.toMatchObject({
      name: 'AuthCenterError',
      code: 'RATE_LIMITED',
    });
  });

  it('非 2xx 且响应体非 JSON → 默认协议错误码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gateway timeout', { status: 504 })),
    );

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    await expect(client.introspect({ token: 'tok-1' })).rejects.toMatchObject({
      code: 'AUTH_CENTER_PROTOCOL_ERROR',
    });
  });

  it('网络失败 → AuthCenterError，cause 保留根因', async () => {
    const root = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(root)));

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    await expect(client.introspect({ token: 'tok-1' })).rejects.toSatisfy((err: AuthCenterError) => {
      expect(err).toBeInstanceOf(AuthCenterError);
      expect(err.cause).toBe(root);
      return true;
    });
  });

  it('超过 timeoutMs → AuthCenterError（abort 信号触发）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
          }),
      ),
    );

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test', timeoutMs: 20 });
    await expect(client.introspect({ token: 'tok-1' })).rejects.toBeInstanceOf(AuthCenterError);
  });
});

describe('createAuthCenterClient.healthz', () => {
  it.each([
    ['2xx 可用 → true', 200, true],
    ['5xx → false', 500, false],
  ])('%s', async (_name, status, expected) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    await expect(client.healthz()).resolves.toBe(expected);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}${TOKEN_ENDPOINTS.healthz}`);
    expect(init.method).toBe('GET');
  });

  it('网络异常 → false（探活是轮询查询，不可用即 false，不抛错）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));

    const client = createAuthCenterClient({ baseUrl: BASE, apiKey: 'sk-test' });
    await expect(client.healthz()).resolves.toBe(false);
  });
});
