import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { signedInAdminQuery } from '../../../test/admin-viewer-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { adminViewerQueryOptions } from '../../graphql/admin-viewer.ts';
import { useAdminViewerRefresh } from './use-admin-viewer-refresh.ts';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const DONE = '取り直しを終えました';

function RefreshButton() {
  const refresh = useAdminViewerRefresh();
  const [done, setDone] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void refresh().then(() => {
            setDone(true);
          });
        }}
      >
        取り直す
      </button>
      {done ? <p>{DONE}</p> : null}
    </>
  );
}

async function refreshFailingWith(error: unknown): Promise<void> {
  const context = createPageRouterContext('local');
  vi.spyOn(context.queryClient, 'invalidateQueries').mockRejectedValue(error);
  await renderInRouter(<RefreshButton />, {
    context,
    cachedViewer: signedInAdminQuery(),
  });

  await userEvent.click(page.getByRole('button', { name: '取り直す' }));

  await expect.element(page.getByText(DONE)).toBeVisible();
}

beforeEach(() => {
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

describe('useAdminViewerRefresh', () => {
  test('ログイン中の管理者の取得を無効にした後に、ルーターに取り直させる', async () => {
    const context = createPageRouterContext('local');
    const invalidateQueries = vi.spyOn(
      context.queryClient,
      'invalidateQueries',
    );
    const router = await renderInRouter(<RefreshButton />, {
      context,
      cachedViewer: signedInAdminQuery(),
    });
    const invalidateRouter = vi.spyOn(router, 'invalidate');

    await userEvent.click(page.getByRole('button', { name: '取り直す' }));

    await expect.element(page.getByText(DONE)).toBeVisible();
    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: adminViewerQueryOptions().queryKey,
    });
    expect(invalidateRouter).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledBefore(invalidateRouter);
  });

  test('取り直しの想定外の失敗は、投げずにエラートラッキングへ送る', async () => {
    const failure = new Error('想定外の失敗');

    await refreshFailingWith(failure);

    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      failure,
      'render',
    );
  });

  test('GraphQLの失敗は送り直さない', async () => {
    await refreshFailingWith(
      new GraphQLClientError({
        code: 'upstream_unavailable',
        message: '現在ご利用いただけません。時間をおいて再度お試しください。',
        status: 503,
      }),
    );

    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
  });
});
