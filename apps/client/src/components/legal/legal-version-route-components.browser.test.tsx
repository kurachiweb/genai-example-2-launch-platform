import { createRoute } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import {
  LOADING_LABEL,
  NOT_FOUND_TITLE,
  UNEXPECTED_ERROR_TITLE,
} from '../../../lib/utilities/messages/state-messages.ts';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import type { ClientLegalDocumentVersionQuery } from '../../graphql/generated/graphql.ts';
import {
  legalDocumentVersionQueryOptions,
  loadLegalDocumentVersion,
} from '../../graphql/legal-documents.ts';
import {
  legalVersionErrorComponent,
  legalVersionPendingComponent,
  legalVersionRouteComponent,
} from './legal-version-route-components.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える。版は取得のキャッシュに先に入れる
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const ROUTE_PATH = '/legal/revisions/$versionNumber';

const PAST_VERSION: ClientLegalDocumentVersionQuery = {
  legalDocumentVersion: {
    publishedAt: '2026-10-01T00:00:00.000Z',
    changeSummary: '初版',
    body: '## 第1条(表記)\n\n事業者の名称を示します。',
    isLatest: false,
  },
};

const main = () => page.getByRole('main');
const heading = () => main().getByRole('heading', { level: 1 });
const articleHeading = () =>
  main().getByRole('heading', { level: 2, name: '第1条(表記)' });

const contextWith = (version: ClientLegalDocumentVersionQuery) => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    legalDocumentVersionQueryOptions('legal-notice', 2).queryKey,
    version,
  );
  return context;
};

type VersionRouteOptions = Omit<
  Parameters<typeof createRoute>[0],
  'getParentRoute' | 'path'
>;

const versionRoute =
  (options: VersionRouteOptions) => (rootRoute: PageRootRoute) => [
    createRoute({
      ...options,
      getParentRoute: () => rootRoute,
      path: ROUTE_PATH,
    } as Parameters<typeof createRoute>[0]),
  ];

describe('過去版のページのルートの部品', () => {
  test('loaderの版番号の版を、文書の名前と版の呼び名の見出しの下に表示する', async () => {
    await renderPageRouter({
      path: '/legal/revisions/2',
      context: contextWith(PAST_VERSION),
      createRoutes: versionRoute({
        loader: loadLegalDocumentVersion('legal-notice'),
        component: legalVersionRouteComponent('legal-notice'),
      }),
    });

    await expect.element(heading()).toHaveTextContent('法的通知(第2版)');
    await expect.element(articleHeading()).toBeVisible();
  });

  test('取得し直した版が無ければ存在しないページにする', async () => {
    await renderPageRouter({
      path: '/legal/revisions/2',
      context: contextWith({ legalDocumentVersion: null }),
      createRoutes: versionRoute({
        loader: () => ({ versionNumber: 2 }),
        component: legalVersionRouteComponent('legal-notice'),
      }),
    });

    await expect
      .element(main().getByRole('heading', { name: NOT_FOUND_TITLE }))
      .toBeVisible();
  });

  test('読み込み中は、URLの版番号から作った見出しと読み込み中の表示を出す', async () => {
    await renderPageRouter({
      path: '/legal/revisions/3',
      createRoutes: versionRoute({
        loader: () => new Promise<never>(() => undefined),
        pendingMs: 0,
        pendingComponent: legalVersionPendingComponent('legal-notice'),
        component: legalVersionRouteComponent('legal-notice'),
      }),
    });

    await expect.element(heading()).toHaveTextContent('法的通知(第3版)');
    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent(LOADING_LABEL);
  });

  test('取得に失敗すると再試行を出し、押すと見出しへフォーカスを移して取得し直した版を表示する', async () => {
    let calls = 0;
    await renderPageRouter({
      path: '/legal/revisions/2',
      context: contextWith(PAST_VERSION),
      createRoutes: versionRoute({
        loader: () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('一時的な失敗');
          }
          return { versionNumber: 2 };
        },
        errorComponent: legalVersionErrorComponent('legal-notice'),
        component: legalVersionRouteComponent('legal-notice'),
      }),
    });

    await expect.element(heading()).toHaveTextContent('法的通知(第2版)');
    await expect.element(articleHeading()).not.toBeInTheDocument();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(articleHeading()).toBeVisible();
    await expect.element(heading()).toHaveFocus();
  });

  test('URLの版番号が形式に合わないまま失敗した時は、想定外のエラーの画面にする', async () => {
    await renderPageRouter({
      path: '/legal/revisions/abc',
      createRoutes: versionRoute({
        loader: () => {
          throw new Error('想定外の失敗');
        },
        errorComponent: legalVersionErrorComponent('legal-notice'),
        component: legalVersionRouteComponent('legal-notice'),
      }),
    });

    await expect
      .element(main().getByRole('heading', { name: UNEXPECTED_ERROR_TITLE }))
      .toBeVisible();
  });
});
