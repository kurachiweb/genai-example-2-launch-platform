import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { requireViewer } from '../src/components/auth/require-viewer.ts';
import {
  ClientMemberInquiryDocument,
  type ClientViewerQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as InquiryChatRoute } from '../src/routes/_authenticated/inquiries/$inquiryId.tsx';
import {
  CHAT_INQUIRY_ID,
  memberInquiryResult,
} from './inquiry-chat-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const CHAT_PATH = `/inquiries/${CHAT_INQUIRY_ID}`;

const SERVER_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

// アプリの経路と同じ取得・判定・画面を通すため、本物の経路の設定を、ログイン必須のレイアウトの下の同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: requireViewer,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/inquiries/$inquiryId',
        loader: InquiryChatRoute.options.loader,
        pendingComponent: InquiryChatRoute.options.pendingComponent,
        errorComponent: InquiryChatRoute.options.errorComponent,
        notFoundComponent: InquiryChatRoute.options.notFoundComponent,
        component: InquiryChatRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ]),
  ];
};

const renderChatRoute = (
  cachedViewer: ClientViewerQuery = signedInViewerQuery(),
  path = CHAT_PATH,
) => renderPageRouter({ path, createRoutes, cachedViewer });

// APIサーバーはIDの上限(64文字)を超えると、nullではなく入力の検証の失敗を返す
const LONG_INQUIRY_ID = '0'.repeat(65);

const ID_TOO_LONG = new GraphQLClientError({
  code: 'validation_error',
  message: '入力内容を確認してください。',
  status: 400,
  details: [
    { field: 'id', code: 'too_big', message: '問い合わせが見つかりません。' },
  ],
});

const chatCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMemberInquiryDocument,
  );

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });
const messages = () =>
  page.getByRole('log', { name: 'メッセージ' }).getByRole('article');

beforeEach(() => {
  executeGraphQL.mockReset();
});

describe('問い合わせチャットの経路', () => {
  test('未ログインでは、チャットのパスを戻り先にしたログイン画面へ移し、問い合わせを取得しない', async () => {
    const router = await renderPageRouter({ path: CHAT_PATH, createRoutes });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: CHAT_PATH });
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('本人の問い合わせを取得して、題名の下にチャットを表示する', async () => {
    executeGraphQL.mockResolvedValue({ ok: true, data: memberInquiryResult() });

    await renderChatRoute();

    await expect.element(pageTitle()).toHaveTextContent('問い合わせチャット');
    await expect.poll(() => messages().elements().length).toBe(3);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientMemberInquiryDocument,
      { id: CHAT_INQUIRY_ID },
      expect.anything(),
    );
  });

  test.each([
    [
      '本人の問い合わせでないか存在しない',
      CHAT_PATH,
      { ok: true, data: { memberInquiry: null } },
    ],
    [
      '65文字のIDで形式に合わない',
      `/inquiries/${LONG_INQUIRY_ID}`,
      { ok: false, error: ID_TOO_LONG },
    ],
  ])(
    '%s時は、存在を明かさずに見つからない旨と問い合わせのページへのリンクを示す',
    async (_label, path, result) => {
      executeGraphQL.mockResolvedValue(result);

      await renderChatRoute(signedInViewerQuery(), path);

      await expect
        .element(page.getByRole('main'))
        .toHaveTextContent('問い合わせが見つかりません。');
      await expect
        .element(
          page
            .getByRole('main')
            .getByRole('link', { name: 'お問い合わせのページへ' }),
        )
        .toHaveAttribute('href', '/contact');
      expect(page.getByRole('log').query()).toBeNull();
      expect(page.getByRole('main').getByRole('alert').query()).toBeNull();
    },
  );

  test('別のページから戻って表示した時は、最初の表示から30秒以内でも取り直す', async () => {
    executeGraphQL
      .mockResolvedValueOnce({ ok: true, data: memberInquiryResult() })
      .mockResolvedValue({
        ok: true,
        data: memberInquiryResult({ status: 'OPEN' }),
      });
    const router = await renderChatRoute();
    await expect.poll(() => messages().elements().length).toBe(3);

    router.history.push('/auth/login');
    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    router.history.push(CHAT_PATH);

    await expect
      .element(page.getByRole('definition').nth(1))
      .toHaveTextContent('未対応');
    expect(chatCalls()).toHaveLength(2);
  });

  test('取得の失敗は見出しを残したまま示し、再試行で見出しへフォーカスを移して取得し直す', async () => {
    executeGraphQL
      .mockResolvedValueOnce({ ok: false, error: SERVER_ERROR })
      .mockResolvedValue({ ok: true, data: memberInquiryResult() });

    await renderChatRoute();

    await expect
      .element(page.getByRole('main').getByRole('alert'))
      .toHaveTextContent(SERVER_ERROR.message);
    await expect.element(pageTitle()).toHaveTextContent('問い合わせチャット');
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.poll(() => messages().elements().length).toBe(3);
    await expect.element(pageTitle()).toHaveFocus();
  });
});
