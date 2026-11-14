import { describe, expect, test } from 'bun:test';

import {
  isResponseCommitted,
  responseCommitMiddleware,
} from './response-commit.ts';

type MiddlewareServer = (options: {
  readonly request: Request;
  readonly pathname: string;
  readonly context: object;
  readonly handlerType: 'serverFn' | 'router';
  readonly next: () => Promise<{ readonly response: Response }>;
}) => Promise<unknown>;

const PAGE_URL = 'https://app.example/launches';

// TanStackのミドルウェアの型はserverの引数を登録した文脈の型で持つため、テストで渡す最小の形の関数として呼ぶ
const serverOf = (): MiddlewareServer => {
  const server = (
    responseCommitMiddleware.options as {
      readonly server?: MiddlewareServer | undefined;
    }
  ).server;
  if (server === undefined) {
    throw new Error(
      '応答の送り始めのミドルウェアにサーバーの処理がありません。',
    );
  }
  return server;
};

const run = (
  request: Request,
  next: () => Promise<{ readonly response: Response }>,
): Promise<unknown> =>
  serverOf()({
    request,
    pathname: new URL(request.url).pathname,
    context: {},
    handlerType: 'router',
    next,
  });

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗を期待したが成功した');
};

describe('responseCommitMiddleware', () => {
  test('後続の処理が応答を返すまでは送り始める前として扱う', async () => {
    const request = new Request(PAGE_URL);
    let committedDuringNext: boolean | undefined;

    await run(request, () => {
      committedDuringNext = isResponseCommitted(request);
      return Promise.resolve({ response: new Response('page') });
    });

    expect(committedDuringNext).toBe(false);
  });

  test('後続の処理が応答を返した後は送り始めた後として扱い、結果をそのまま返す', async () => {
    const request = new Request(PAGE_URL);
    const result = { response: new Response('page') };

    const returned = await run(request, () => Promise.resolve(result));

    expect(returned).toBe(result);
    expect(isResponseCommitted(request)).toBe(true);
  });

  test('後続の処理が例外になっても送り始めた後として扱い、例外を伝える', async () => {
    const request = new Request(PAGE_URL);
    const failure = new Error('描画の失敗');

    expect(await rejectionOf(run(request, () => Promise.reject(failure)))).toBe(
      failure,
    );
    expect(isResponseCommitted(request)).toBe(true);
  });

  test('要求ごとに区別し、他の要求の送り始めに影響されない', async () => {
    const committed = new Request(PAGE_URL);
    const other = new Request(PAGE_URL);

    await run(committed, () =>
      Promise.resolve({ response: new Response('page') }),
    );

    expect(isResponseCommitted(committed)).toBe(true);
    expect(isResponseCommitted(other)).toBe(false);
  });
});
