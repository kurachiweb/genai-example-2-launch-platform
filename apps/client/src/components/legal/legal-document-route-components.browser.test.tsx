import { createRoute } from '@tanstack/react-router';
import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { LOADING_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import {
  createPageRouterContext,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import type { ClientLegalDocumentQuery } from '../../graphql/generated/graphql.ts';
import {
  legalDocumentQueryOptions,
  loadLegalDocument,
} from '../../graphql/legal-documents.ts';
import {
  legalDocumentErrorComponent,
  legalDocumentPendingComponent,
  legalDocumentRouteComponent,
} from './legal-document-route-components.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える。文書は取得のキャッシュに先に入れる
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PUBLISHED: ClientLegalDocumentQuery = {
  legalDocument: {
    latest: {
      versionNumber: 1,
      publishedAt: '2026-10-01T00:00:00.000Z',
      body: '## 第1条(目的)\n\n本規約はサービスの利用条件を定めます。',
    },
    revisions: [
      {
        versionNumber: 1,
        publishedAt: '2026-10-01T00:00:00.000Z',
        changeSummary: '初版',
      },
    ],
  },
};

const main = () => page.getByRole('main');
const heading = () => main().getByRole('heading', { level: 1 });
const articleHeading = () =>
  main().getByRole('heading', { level: 2, name: '第1条(目的)' });

const cachedContext = () => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    legalDocumentQueryOptions('privacy').queryKey,
    PUBLISHED,
  );
  return context;
};

describe('最新版のページのルートの部品', () => {
  test('取得した文書を、種類の名前の見出しの下に本文として表示する', async () => {
    await renderPageRouter({
      path: '/privacy',
      context: cachedContext(),
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/privacy',
          loader: loadLegalDocument('privacy'),
          component: legalDocumentRouteComponent('privacy'),
        }),
      ],
    });

    await expect.element(heading()).toHaveTextContent('プライバシーポリシー');
    await expect.element(articleHeading()).toBeVisible();
  });

  test('読み込み中は、種類の名前の見出しと読み込み中の表示を出す', async () => {
    await renderPageRouter({
      path: '/privacy',
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/privacy',
          loader: () => new Promise<never>(() => undefined),
          pendingMs: 0,
          pendingComponent: legalDocumentPendingComponent('privacy'),
          component: legalDocumentRouteComponent('privacy'),
        }),
      ],
    });

    await expect.element(heading()).toHaveTextContent('プライバシーポリシー');
    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent(LOADING_LABEL);
  });

  test('取得に失敗すると再試行を出し、押すと見出しへフォーカスを移して取得し直した文書を表示する', async () => {
    let calls = 0;
    await renderPageRouter({
      path: '/privacy',
      context: cachedContext(),
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/privacy',
          loader: () => {
            calls += 1;
            if (calls === 1) {
              throw new Error('一時的な失敗');
            }
          },
          errorComponent: legalDocumentErrorComponent('privacy'),
          component: legalDocumentRouteComponent('privacy'),
        }),
      ],
    });

    await expect.element(heading()).toHaveTextContent('プライバシーポリシー');
    await expect.element(articleHeading()).not.toBeInTheDocument();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(articleHeading()).toBeVisible();
    await expect.element(heading()).toHaveFocus();
  });
});
