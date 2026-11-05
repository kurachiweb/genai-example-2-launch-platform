import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientInquiryContactFormDocument,
  type ClientInquiryContactFormQuery,
  type ClientViewerQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as ContactRoute } from '../src/routes/contact.tsx';
import { renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery, VIEWER_NICKNAME } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const CATEGORIES = [
  { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' },
  { id: '01JC0000000000000000000000', name: 'その他' },
];

const contactForm = (
  composer: ClientInquiryContactFormQuery['inquiryComposer'],
) => ({
  ok: true,
  data: { inquiryCategories: CATEGORIES, inquiryComposer: composer },
});

// アプリの経路と同じ取得・head・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const renderContact = (cachedViewer?: ClientViewerQuery) =>
  renderPageRouter({
    path: '/contact',
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/contact',
        loader: ContactRoute.options.loader,
        component: ContactRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ],
    ...(cachedViewer === undefined ? {} : { cachedViewer }),
  });

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

describe('問い合わせの経路', () => {
  test('未ログインでは、カテゴリの選択肢を取得して未ログインのフォームを表示する', async () => {
    executeGraphQL.mockResolvedValue(contactForm(null));

    await renderContact();

    await expect.element(pageTitle()).toHaveTextContent('お問い合わせ');
    await expect
      .element(page.getByRole('textbox', { name: 'ニックネーム(必須)' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('option', { name: '不具合の報告' }))
      .toBeInTheDocument();
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientInquiryContactFormDocument,
      {},
      expect.anything(),
    );
  });

  test('停止していないログイン中の利用者には、取得した送信者を示すログインのフォームを表示する', async () => {
    executeGraphQL.mockResolvedValue(
      contactForm({ nickname: VIEWER_NICKNAME, avatar: null }),
    );

    await renderContact(signedInViewerQuery());

    await expect
      .element(page.getByRole('group', { name: '送信者' }))
      .toHaveTextContent(VIEWER_NICKNAME);
    expect(
      page.getByRole('textbox', { name: 'ニックネーム(必須)' }).query(),
    ).toBeNull();
  });

  test('停止中の利用者には、案内と未ログインのフォームを表示する', async () => {
    executeGraphQL.mockResolvedValue(contactForm(null));

    await renderContact(signedInViewerQuery({ status: 'SUSPENDED' }));

    await expect
      .element(page.getByRole('note', { name: '停止中のアカウント' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('textbox', { name: 'ニックネーム(必須)' }))
      .toBeVisible();
  });

  test('カテゴリの取得の失敗は、想定外のエラーの画面にする', async () => {
    executeGraphQL.mockResolvedValue({
      ok: false,
      error: new GraphQLClientError({
        code: 'internal_error',
        message: 'サーバーでエラーが発生しました。',
        status: 500,
      }),
    });

    await renderContact();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('ページを表示できませんでした。');
    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toBeVisible();
  });
});
