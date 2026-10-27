import { afterEach, describe, expect, test } from 'bun:test';

import { resetSync } from '@logtape/logtape';
// @tanstack/react-routerが完全固定の版で推移的に依存するパッケージ。ハイドレーションでのloaderの失敗の復元をテストで再現する公開の手段がここにしか無いため直接読み込む
import { defaultSerovalPlugins } from '@tanstack/router-core/ssr/client';
import { fromJSON, toJSON } from 'seroval';

import {
  htmlResponse,
  recordFrontendLogs,
  recordingApi,
  renderContextOf,
  runInStartRequest,
} from '../../test/start-request-fixtures.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import {
  type RenderErrorRouter,
  reportRenderError,
  reportUnexpectedError,
} from './report-error.ts';

const routerWithMatchErrors = (
  errors: readonly unknown[],
): RenderErrorRouter => ({
  state: { matches: errors.map((error) => ({ error })) },
});

// サーバーの描画でmatchに入ったloaderの失敗を、TanStack Routerの既定の直列化(ShallowErrorPlugin)でブラウザへ渡して戻す
const restoreLikeHydration = (error: unknown): unknown =>
  fromJSON<{ readonly error: unknown }>(
    toJSON({ error }, { plugins: defaultSerovalPlugins }),
    { plugins: defaultSerovalPlugins },
  ).error;

const unusedApi = recordingApi(() =>
  Promise.reject(new Error('APIは呼ばれない')),
);

const graphQLError = (code: string): GraphQLClientError =>
  new GraphQLClientError({ code, message: '失敗しました', status: 500 });

afterEach(() => {
  resetSync();
});

const runReporting = async (
  report: () => void,
): Promise<readonly unknown[]> => {
  const reported: unknown[] = [];
  await runInStartRequest({
    context: renderContextOf({ api: unusedApi, reported }),
    render: () => {
      report();
      return Promise.resolve(htmlResponse());
    },
  });
  return reported;
};

// TanStackのViteプラグインが無いBunでは、同型の関数はサーバーの分岐を実行する
describe('reportUnexpectedError(サーバーの分岐)', () => {
  test('想定外の失敗を描画の文脈の送信の関数へ渡し、送信元を付けたerrorのログを出す', async () => {
    const logs = recordFrontendLogs();
    const error = new Error('loaderで失敗しました');

    const reported = await runReporting(() => {
      reportUnexpectedError(error, 'loader');
    });

    expect(reported).toEqual([error]);
    const errorLogs = logs().filter((log) => log.level === 'error');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({
      category: 'client.http.error',
      source: 'loader',
    });
  });

  test('同じ例外を送信元を変えて2回渡しても1回だけ送る', async () => {
    const error = graphQLError('internal_error');

    const reported = await runReporting(() => {
      reportUnexpectedError(error, 'graphql');
      reportUnexpectedError(error, 'loader');
      reportRenderError(routerWithMatchErrors([]), error);
    });

    expect(reported).toEqual([error]);
  });

  test('想定内の失敗は送らずログも出さない', async () => {
    const logs = recordFrontendLogs();

    const reported = await runReporting(() => {
      reportUnexpectedError(graphQLError('not_found'), 'loader');
      reportUnexpectedError(graphQLError('csrf_rejected'), 'graphql');
    });

    expect(reported).toEqual([]);
    expect(logs().filter((log) => log.level === 'error')).toEqual([]);
  });

  test('中継が元の例外を送った上流への到達の失敗は送らない', async () => {
    const reported = await runReporting(() => {
      reportUnexpectedError(graphQLError('upstream_unavailable'), 'graphql');
      reportUnexpectedError(graphQLError('upstream_timeout'), 'loader');
    });

    expect(reported).toEqual([]);
  });
});

describe('reportRenderError', () => {
  test('ルートのmatchの失敗でない描画の例外を送信元renderとして1回送る', async () => {
    const logs = recordFrontendLogs();
    const error = new Error('描画に失敗しました');
    const router = routerWithMatchErrors([undefined, new Error('別の失敗')]);

    const reported = await runReporting(() => {
      reportRenderError(router, error);
      reportRenderError(router, error);
    });

    expect(reported).toEqual([error]);
    expect(logs().find((log) => log.level === 'error')?.['source']).toBe(
      'render',
    );
  });

  test('ルートのmatchが持つloaderの失敗と同じ例外は送らない', async () => {
    const loaderFailure = new Error('loaderで失敗しました');

    const reported = await runReporting(() => {
      reportRenderError(
        routerWithMatchErrors([undefined, loaderFailure]),
        loaderFailure,
      );
    });

    expect(reported).toEqual([]);
  });

  test.each([
    ['想定外の失敗', graphQLError('internal_error')],
    ['想定内の失敗', graphQLError('not_found')],
  ])(
    'ハイドレーションで復元されたloaderの%sは、サーバーが送った後のため送らない',
    async (_label, serverFailure) => {
      const restored = restoreLikeHydration(serverFailure);

      const reported = await runReporting(() => {
        reportRenderError(routerWithMatchErrors([restored]), restored);
      });

      expect(restored).not.toBe(serverFailure);
      expect(restored).not.toBeInstanceOf(GraphQLClientError);
      expect(reported).toEqual([]);
    },
  );

  test('matchの失敗でない想定内のGraphQLClientErrorは送らない', async () => {
    const reported = await runReporting(() => {
      reportRenderError(
        routerWithMatchErrors([]),
        graphQLError('rate_limit_exceeded'),
      );
    });

    expect(reported).toEqual([]);
  });
});
