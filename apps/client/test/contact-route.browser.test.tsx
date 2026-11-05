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
  ClientMyInquiriesDocument,
  type ClientMyInquiriesQuery,
  type ClientMyInquiriesQueryVariables,
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

const BUG_CATEGORY = { id: '01JC0CATEG0RY0000000000001', name: '不具合の報告' };

const OTHER_CATEGORY = { id: '01JC0000000000000000000000', name: 'その他' };

const CATEGORIES = [BUG_CATEGORY, OTHER_CATEGORY];

const SERVER_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

type MyInquiryRow = ClientMyInquiriesQuery['myInquiries']['items'][number];

const inquiryRow = (index: number): MyInquiryRow => ({
  id: `01JC0INQVRY0000000000000${String(index).padStart(2, '0')}`,
  category: index % 2 === 0 ? OTHER_CATEGORY : BUG_CATEGORY,
  status: 'OPEN',
  createdAt: '2026-11-04T01:00:00.000Z',
  lastMessageAt: '2026-11-04T01:00:00.000Z',
});

// 1ページ目は先頭の20件と次のページのカーソル、cursor-2は最後のページの1件
const MY_INQUIRY_PAGES: Readonly<
  Record<string, ClientMyInquiriesQuery['myInquiries']>
> = {
  first: {
    items: Array.from({ length: 20 }, (_, index) => inquiryRow(index + 1)),
    nextCursor: 'cursor-2',
  },
  'cursor-2': { items: [inquiryRow(21)], nextCursor: null },
};

interface Responses {
  readonly composer?: ClientInquiryContactFormQuery['inquiryComposer'];
  readonly contactForm?: 'fail';
  readonly myInquiries?: 'fail';
}

const respond = ({ composer = null, contactForm, myInquiries }: Responses) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: ClientMyInquiriesQueryVariables) => {
      if (document === ClientMyInquiriesDocument) {
        return Promise.resolve(
          myInquiries === 'fail'
            ? { ok: false, error: SERVER_ERROR }
            : {
                ok: true,
                data: {
                  myInquiries: MY_INQUIRY_PAGES[variables.after ?? 'first'],
                },
              },
        );
      }
      return Promise.resolve(
        contactForm === 'fail'
          ? { ok: false, error: SERVER_ERROR }
          : {
              ok: true,
              data: {
                inquiryCategories: CATEGORIES,
                inquiryComposer: composer,
              },
            },
      );
    },
  );
};

// アプリの経路と同じ取得・head・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const renderContact = (cachedViewer?: ClientViewerQuery, path = '/contact') =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/contact',
        validateSearch: ContactRoute.options.validateSearch,
        loaderDeps: ContactRoute.options.loaderDeps,
        loader: ContactRoute.options.loader,
        component: ContactRoute.options.component,
      } as Parameters<typeof createRoute>[0]),
    ],
    ...(cachedViewer === undefined ? {} : { cachedViewer }),
  });

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });
const myInquiries = () =>
  page.getByRole('region', { name: '送信した問い合わせ' });
const myInquiryItems = () => myInquiries().getByRole('listitem');
const pageButton = (name: '前へ' | '次へ') =>
  page
    .getByRole('navigation', { name: '送信した問い合わせのページ送り' })
    .getByRole('button', { name, exact: true });

// 比べやすいよう、ルーターが持つ検索パラメータを素のオブジェクトに写す
const searchOf = (router: {
  readonly state: { readonly location: { readonly search: object } };
}): object => ({ ...router.state.location.search });

const myInquiriesCalls = () =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === ClientMyInquiriesDocument)
    .map(([, variables]: unknown[]) => variables);

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

describe('問い合わせの経路', () => {
  test('未ログインでは、カテゴリの選択肢を取得して未ログインのフォームを表示し、自分の問い合わせの一覧を取得も表示もしない', async () => {
    respond({});

    await renderContact(undefined, '/contact?after=cursor-2');

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
    expect(myInquiries().query()).toBeNull();
  });

  test('停止していないログイン中の利用者には、取得した送信者を示すログインのフォームと、その下に自分の問い合わせの一覧を表示する', async () => {
    respond({ composer: { nickname: VIEWER_NICKNAME, avatar: null } });

    await renderContact(signedInViewerQuery());

    await expect
      .element(page.getByRole('group', { name: '送信者' }))
      .toHaveTextContent(VIEWER_NICKNAME);
    expect(
      page.getByRole('textbox', { name: 'ニックネーム(必須)' }).query(),
    ).toBeNull();
    await expect.element(myInquiryItems().first()).toBeInTheDocument();
    expect(myInquiryItems().elements()).toHaveLength(20);
    const form = page.getByRole('form', { name: 'お問い合わせフォーム' });
    expect(
      form.element().compareDocumentPosition(myInquiries().element()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(myInquiriesCalls()).toStrictEqual([{}]);
  });

  test('停止中の利用者には、案内と未ログインのフォームと、自分の問い合わせの一覧を表示する', async () => {
    respond({});

    await renderContact(signedInViewerQuery({ status: 'SUSPENDED' }));

    await expect
      .element(page.getByRole('note', { name: '停止中のアカウント' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('textbox', { name: 'ニックネーム(必須)' }))
      .toBeVisible();
    await expect.element(myInquiryItems().first()).toBeInTheDocument();
  });

  test('一覧の次へと前へで、検索パラメータのページの位置を変えて20件ずつのページを移る', async () => {
    respond({ composer: { nickname: VIEWER_NICKNAME, avatar: null } });
    const router = await renderContact(signedInViewerQuery());
    await expect.element(myInquiryItems().first()).toBeInTheDocument();

    await pageButton('次へ').click();

    await expect
      .poll(() => searchOf(router))
      .toStrictEqual({
        after: 'cursor-2',
      });
    await expect.poll(() => myInquiryItems().elements().length).toBe(1);
    await expect
      .element(pageButton('次へ'))
      .toHaveAttribute('aria-disabled', 'true');

    await pageButton('前へ').click();

    await expect.poll(() => searchOf(router)).toStrictEqual({});
    await expect.poll(() => myInquiryItems().elements().length).toBe(20);
  });

  test('記録の無い途中のページを開いた時は、前へで1ページ目へ戻る', async () => {
    respond({ composer: { nickname: VIEWER_NICKNAME, avatar: null } });
    const router = await renderContact(
      signedInViewerQuery(),
      '/contact?after=cursor-2',
    );
    await expect.poll(() => myInquiryItems().elements().length).toBe(1);

    await pageButton('前へ').click();

    await expect.poll(() => searchOf(router)).toStrictEqual({});
    await expect.poll(() => myInquiryItems().elements().length).toBe(20);
    expect(myInquiriesCalls()).toStrictEqual([{ after: 'cursor-2' }, {}]);
  });

  test('自分の問い合わせの一覧の取得の失敗は、フォームを表示したまま一覧の位置に示す', async () => {
    respond({
      composer: { nickname: VIEWER_NICKNAME, avatar: null },
      myInquiries: 'fail',
    });

    await renderContact(signedInViewerQuery());

    await expect
      .element(myInquiries().getByRole('alert'))
      .toHaveTextContent(SERVER_ERROR.message);
    await expect
      .element(myInquiries().getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('group', { name: '送信者' }))
      .toBeVisible();
  });

  test('カテゴリの取得の失敗は、想定外のエラーの画面にする', async () => {
    respond({ contactForm: 'fail' });

    await renderContact();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('ページを表示できませんでした。');
    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toBeVisible();
  });
});
