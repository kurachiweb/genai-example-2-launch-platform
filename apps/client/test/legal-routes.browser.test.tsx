import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import {
  GraphQLClientError,
  type GraphQLResult,
} from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientLegalDocumentDocument,
  type ClientLegalDocumentQuery,
  ClientLegalDocumentVersionDocument,
  type ClientLegalDocumentVersionQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as LegalNoticeRoute } from '../src/routes/legal/index.tsx';
import { Route as PrivacyVersionRoute } from '../src/routes/privacy/revisions/$versionNumber.tsx';
import { Route as TermsRoute } from '../src/routes/terms/index.tsx';
import { renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const NOT_FOUND_TITLE = 'ページが見つかりません。';

const PUBLISHED: GraphQLResult<ClientLegalDocumentQuery> = {
  ok: true,
  data: {
    legalDocument: {
      latest: {
        versionNumber: 2,
        publishedAt: '2026-11-02T03:04:05.000Z',
        body: '本規約は、サービスの利用条件を定めます。',
      },
      revisions: [
        {
          versionNumber: 2,
          publishedAt: '2026-11-02T03:04:05.000Z',
          changeSummary: '第3条を改めました。',
        },
        {
          versionNumber: 1,
          publishedAt: '2026-10-01T00:00:00.000Z',
          changeSummary: '初版',
        },
      ],
    },
  },
};

const PREPARING: GraphQLResult<ClientLegalDocumentQuery> = {
  ok: true,
  data: { legalDocument: { latest: null, revisions: [] } },
};

const VERSION: GraphQLResult<ClientLegalDocumentVersionQuery> = {
  ok: true,
  data: {
    legalDocumentVersion: {
      publishedAt: '2026-10-01T00:00:00.000Z',
      changeSummary: '初版',
      body: '個人情報の取り扱いを定めます。',
      isLatest: false,
    },
  },
};

const INTERNAL_ERROR = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

// アプリの経路と同じ取得・head・読み込み中と失敗の画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const renderLegalRoute = (
  path: string,
  route:
    typeof TermsRoute | typeof LegalNoticeRoute | typeof PrivacyVersionRoute,
  routePath: string,
) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: routePath,
        loader: route.options.loader,
        pendingComponent: route.options.pendingComponent,
        errorComponent: route.options.errorComponent,
        component: route.options.component,
      } as Parameters<typeof createRoute>[0]),
    ],
  });

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });

beforeEach(() => {
  executeGraphQL.mockReset();
});

describe('公開ページの経路', () => {
  test('最新版の本文と改訂履歴を、共通レイアウトの中に表示する', async () => {
    executeGraphQL.mockResolvedValue(PUBLISHED);

    await renderLegalRoute('/terms', TermsRoute, '/terms');

    await expect.element(pageTitle()).toHaveTextContent('利用規約');
    await expect
      .element(page.getByText('本規約は、サービスの利用条件を定めます。'))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: '第1版' }))
      .toHaveAttribute('href', '/terms/revisions/1');
    await expect.element(page.getByRole('contentinfo')).toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientLegalDocumentDocument,
      { kind: 'TERMS' },
      expect.anything(),
    );
  });

  test('版が無い文書は準備中である旨を表示する', async () => {
    executeGraphQL.mockResolvedValue(PREPARING);

    await renderLegalRoute('/legal', LegalNoticeRoute, '/legal');

    await expect.element(pageTitle()).toHaveTextContent('法的通知');
    await expect
      .element(page.getByText('この文書は準備中です。'))
      .toBeVisible();
  });

  test('取得の失敗は文書の名前の見出しを残して再試行と問い合わせの導線を示し、再試行で表示し直して見出しへフォーカスを移す', async () => {
    executeGraphQL
      .mockResolvedValueOnce(INTERNAL_ERROR)
      .mockResolvedValue(PREPARING);

    await renderLegalRoute('/terms', TermsRoute, '/terms');

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('サーバーでエラーが発生しました。');
    await expect.element(pageTitle()).toHaveTextContent('利用規約');
    await expect
      .element(
        page.getByRole('main').getByRole('link', { name: 'お問い合わせ' }),
      )
      .toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect
      .element(page.getByText('この文書は準備中です。'))
      .toBeVisible();
    await expect.element(pageTitle()).toHaveFocus();
  });
});

describe('過去版のページの経路', () => {
  const VERSION_ROUTE_PATH = '/privacy/revisions/$versionNumber';

  test('版の本文を、文書の名前と版番号の見出しで表示する', async () => {
    executeGraphQL.mockResolvedValue(VERSION);

    await renderLegalRoute(
      '/privacy/revisions/1',
      PrivacyVersionRoute,
      VERSION_ROUTE_PATH,
    );

    await expect
      .element(pageTitle())
      .toHaveTextContent('プライバシーポリシー(第1版)');
    await expect
      .element(page.getByText('個人情報の取り扱いを定めます。'))
      .toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientLegalDocumentVersionDocument,
      { kind: 'PRIVACY', versionNumber: 1 },
      expect.anything(),
    );
  });

  test('版番号の形式違反は、取得せずに存在しないページの画面にする', async () => {
    await renderLegalRoute(
      '/privacy/revisions/01',
      PrivacyVersionRoute,
      VERSION_ROUTE_PATH,
    );

    await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('存在しない版は、存在しないページの画面にする', async () => {
    executeGraphQL.mockResolvedValue({
      ok: true,
      data: { legalDocumentVersion: null },
    });

    await renderLegalRoute(
      '/privacy/revisions/7',
      PrivacyVersionRoute,
      VERSION_ROUTE_PATH,
    );

    await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
  });

  test('取得の失敗は版の見出しを残して再試行を示し、再試行で表示し直して見出しへフォーカスを移す', async () => {
    executeGraphQL
      .mockResolvedValueOnce(INTERNAL_ERROR)
      .mockResolvedValue(VERSION);

    await renderLegalRoute(
      '/privacy/revisions/1',
      PrivacyVersionRoute,
      VERSION_ROUTE_PATH,
    );

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('サーバーでエラーが発生しました。');
    await expect
      .element(pageTitle())
      .toHaveTextContent('プライバシーポリシー(第1版)');

    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect
      .element(page.getByText('個人情報の取り扱いを定めます。'))
      .toBeVisible();
    await expect.element(pageTitle()).toHaveFocus();
  });
});
