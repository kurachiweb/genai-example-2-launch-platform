import { describe, expect, test } from 'bun:test';
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from '@sentry/tanstackstart-react';

import { responseCommitMiddleware } from './response-commit.ts';
import { createFrontendStartOptions } from './start-options.ts';

const APP_ORIGIN = 'https://app.example';
const PASSED = new Response('passed');

type MiddlewareServer = (options: {
  readonly request: Request;
  readonly pathname: string;
  readonly context: object;
  readonly handlerType: 'serverFn' | 'router';
  readonly next: () => Promise<{ readonly response: Response }>;
}) => Promise<Response | { readonly response: Response }>;

const startOptionsOf = () => createFrontendStartOptions()();

const runCsrfMiddleware = async (request: Request): Promise<Response> => {
  const [, csrf] = startOptionsOf().requestMiddleware;
  // TanStackのミドルウェアの型はserverの引数を登録した文脈の型で持つため、テストで渡す最小の形の関数として呼ぶ
  const server = (
    csrf.options as { readonly server?: MiddlewareServer | undefined }
  ).server;
  if (server === undefined) {
    throw new Error('CSRFのミドルウェアにサーバーの処理がありません。');
  }
  const pathname = new URL(request.url).pathname;
  const result = await server({
    request,
    pathname,
    context: {},
    handlerType: pathname.startsWith('/_serverFn/') ? 'serverFn' : 'router',
    next: () => Promise.resolve({ response: PASSED }),
  });
  return result instanceof Response ? result : result.response;
};

const requestOf = (
  path: string,
  method: string,
  headers: Readonly<Record<string, string>> = {},
): Request => new Request(`${APP_ORIGIN}${path}`, { method, headers });

describe('createFrontendStartOptions', () => {
  test('要求のミドルウェアはSentryを先頭に置き、CSRF、応答の送り始めの記録の順に置く', () => {
    const { requestMiddleware, functionMiddleware } = startOptionsOf();

    expect(requestMiddleware).toHaveLength(3);
    expect(requestMiddleware[0]).toBe(sentryGlobalRequestMiddleware);
    expect(requestMiddleware[1]).not.toBe(sentryGlobalRequestMiddleware);
    expect(requestMiddleware[1]).not.toBe(responseCommitMiddleware);
    expect(requestMiddleware[2]).toBe(responseCommitMiddleware);
    expect(functionMiddleware).toEqual([sentryGlobalFunctionMiddleware]);
  });

  test('呼ぶたびにCSRFのミドルウェアを作り直す', () => {
    expect(startOptionsOf().requestMiddleware[1]).not.toBe(
      startOptionsOf().requestMiddleware[1],
    );
  });
});

describe('CSRFのミドルウェア', () => {
  test('ページのGETは検証せずに通す', async () => {
    const response = await runCsrfMiddleware(requestOf('/posts', 'GET'));

    expect(response).toBe(PASSED);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%sは別のサイトからの要求を403で拒否する',
    async (method) => {
      const response = await runCsrfMiddleware(
        requestOf('/posts', method, { 'Sec-Fetch-Site': 'cross-site' }),
      );

      expect(response.status).toBe(403);
    },
  );

  test('状態変更の要求は同じオリジンからなら通す', async () => {
    const bySecFetchSite = await runCsrfMiddleware(
      requestOf('/posts', 'POST', { 'Sec-Fetch-Site': 'same-origin' }),
    );
    const byOrigin = await runCsrfMiddleware(
      requestOf('/posts', 'POST', { Origin: APP_ORIGIN }),
    );

    expect(bySecFetchSite).toBe(PASSED);
    expect(byOrigin).toBe(PASSED);
  });

  test('Originが一致しない状態変更の要求を拒否する', async () => {
    const response = await runCsrfMiddleware(
      requestOf('/posts', 'POST', { Origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(403);
  });

  test('サーバー関数の呼び出しはGETでも別のサイトからなら拒否する', async () => {
    const response = await runCsrfMiddleware(
      requestOf('/_serverFn/abc', 'GET', { 'Sec-Fetch-Site': 'cross-site' }),
    );

    expect(response.status).toBe(403);
  });

  test('パーセントエンコードしたサーバー関数の経路もGETで検証する', async () => {
    const response = await runCsrfMiddleware(
      requestOf('/%5FserverFn/abc', 'GET'),
    );

    expect(response.status).toBe(403);
  });

  test('Sec-Fetch-SiteとOriginが無ければ、同じオリジンのRefererがあっても拒否する', async () => {
    const response = await runCsrfMiddleware(
      requestOf('/posts', 'POST', { Referer: `${APP_ORIGIN}/posts` }),
    );

    expect(response.status).toBe(403);
  });

  test('Sec-Fetch-Site・Origin・Refererのどれも無い状態変更の要求を拒否する', async () => {
    const response = await runCsrfMiddleware(requestOf('/posts', 'DELETE'));

    expect(response.status).toBe(403);
  });
});
