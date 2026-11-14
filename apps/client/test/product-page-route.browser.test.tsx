import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { productLiveMatchOf } from '../src/components/product-page/live-match-fixtures.ts';
import { historyLaunchOf } from '../src/components/product-page/match-history-fixtures.ts';
import { productPageViewOf } from '../src/components/product-page/product-page-fixtures.ts';
import {
  ClientProductLiveMatchDocument,
  ClientProductPageDocument,
} from '../src/graphql/generated/graphql.ts';
import {
  PRODUCT_PAGE_QUERY_PREFIX,
  type ProductPageLoaderData,
} from '../src/graphql/product-page.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as ProductPageRoute } from '../src/routes/p/$handle.tsx';
import {
  callsOf,
  ok,
  renderProductRoute,
  respondProductRoute,
} from './product-page-route-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const NOT_FOUND_TITLE = 'ページが見つかりません。';

const ERROR_MESSAGE =
  'プロダクト情報を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const INTERNAL_ERROR = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const VIEW = productPageViewOf({ launches: [historyLaunchOf()] });

type PageHead = (input: {
  loaderData: ProductPageLoaderData | undefined;
}) => ReturnType<typeof buildSitePageHead>;

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });

const expectNotFound = async (): Promise<void> => {
  await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
  await expect
    .element(main().getByRole('link', { name: 'トップページへ' }))
    .toHaveAttribute('href', '/');
  await expect
    .element(main().getByRole('link', { name: 'ディレクトリを見る' }))
    .toHaveAttribute('href', '/p');
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  await emulateBrowserDisplay(null);
});

describe('プロダクト詳細の経路', () => {
  test('掲載中のプロダクトを開き、名称を見出しにして本specの区画を描き、URLのハンドルで開催中のマッチを読む', async () => {
    respondProductRoute(executeGraphQL, {
      pages: { 'pitch-notes': VIEW },
      liveMatches: [productLiveMatchOf()],
    });

    await renderProductRoute('/p/pitch-notes');

    await expect.element(pageTitle()).toHaveTextContent('Pitch Notes');
    await expect
      .element(main().getByRole('region', { name: /を戦っています$/u }))
      .toBeVisible();
    await expect
      .element(main().getByRole('heading', { name: '説明', level: 2 }))
      .toBeVisible();
    await expect
      .element(
        main().getByRole('heading', {
          name: /^マッチ履歴とコメント/u,
          level: 2,
        }),
      )
      .toBeVisible();
    expect(callsOf(executeGraphQL, ClientProductPageDocument)).toHaveLength(1);
    expect(
      callsOf(executeGraphQL, ClientProductLiveMatchDocument),
    ).toHaveLength(1);
    expect(
      callsOf(executeGraphQL, ClientProductLiveMatchDocument)[0]?.[1],
    ).toEqual({ productHandle: 'pitch-notes' });
  });

  test.each(['a b', 'a.b', '-abc', 'a'.repeat(51)])(
    'ハンドルの形式違反(%p)は照会せずに、トップページとディレクトリへの導線を持つ存在しないページの画面にする',
    async (handle) => {
      await renderProductRoute(`/p/${encodeURIComponent(handle)}`);

      await expectNotFound();
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  test('存在しない・閲覧できないハンドル(null)は、同じ存在しないページの画面にする', async () => {
    respondProductRoute(executeGraphQL, { pages: {} });

    await renderProductRoute('/p/nothing-here');

    await expectNotFound();
    expect(callsOf(executeGraphQL, ClientProductPageDocument)).toHaveLength(1);
  });

  test('旧ハンドルのURLは、クエリを保ったまま現在のハンドルのURLへ転送し、現在のハンドルで表示する', async () => {
    respondProductRoute(executeGraphQL, {
      pages: {
        'old-notes': {
          __typename: 'ProductPageRedirect',
          handle: 'Pitch-Notes',
        },
        'Pitch-Notes': VIEW,
      },
    });

    const router = await renderProductRoute(
      '/p/old-notes?utm_source=share&ref=campaign',
    );

    await expect.element(pageTitle()).toHaveTextContent('Pitch Notes');
    expect(router.state.location.pathname).toBe('/p/Pitch-Notes');
    expect(router.state.location.search).toEqual({
      utm_source: 'share',
      ref: 'campaign',
    });
  });

  test('開催中のマッチの取得の失敗ではページを失敗にせず、区画の位置で再試行させる', async () => {
    respondProductRoute(executeGraphQL, {
      pages: { 'Pitch-Notes': VIEW },
      liveMatches: [INTERNAL_ERROR, productLiveMatchOf()],
    });

    await renderProductRoute('/p/Pitch-Notes');

    await expect.element(pageTitle()).toHaveTextContent('Pitch Notes');
    await expect.element(main().getByRole('alert')).toBeVisible();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect
      .element(main().getByRole('region', { name: /を戦っています$/u }))
      .toBeVisible();
  });

  test('初回の読み込み中は、読み込み中の旨を伝えるスケルトンを出す', async () => {
    executeGraphQL.mockReturnValue(new Promise<never>(() => undefined));

    await renderProductRoute('/p/Pitch-Notes', { pendingMs: 0 });

    await expect
      .element(main().getByRole('status'))
      .toHaveTextContent('プロダクト情報を読み込み中');
    expect(pageTitle().query()).toBeNull();
  });

  test('詳細ページの取得の失敗はページ全体を再試行と問い合わせの導線に置き換え、再試行で表示し直して見出しへフォーカスを移す', async () => {
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === ClientProductLiveMatchDocument) {
        return Promise.resolve(ok({ productLiveMatch: null }));
      }
      return Promise.resolve(INTERNAL_ERROR);
    });

    await renderProductRoute('/p/Pitch-Notes');

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    await expect
      .element(main().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');

    respondProductRoute(executeGraphQL, { pages: { 'Pitch-Notes': VIEW } });
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(pageTitle()).toHaveTextContent('Pitch Notes');
    await expect.element(pageTitle()).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });

  test('表示中に取り直した詳細ページが表示できなくなったら、存在しないページの画面にする', async () => {
    respondProductRoute(executeGraphQL, { pages: { 'Pitch-Notes': VIEW } });
    const router = await renderProductRoute('/p/Pitch-Notes');
    await expect.element(pageTitle()).toHaveTextContent('Pitch Notes');

    respondProductRoute(executeGraphQL, { pages: {} });
    await router.options.context.queryClient.invalidateQueries({
      queryKey: PRODUCT_PAGE_QUERY_PREFIX,
    });

    await expectNotFound();
  });
});

describe('プロダクト詳細のhead', () => {
  const head = ProductPageRoute.options.head as PageHead | undefined;

  test('タイトルに名称、説明にタグライン、正規のURLに現在のハンドルのパスを出す', () => {
    const result = head?.({
      loaderData: {
        handle: 'Pitch-Notes',
        name: 'Pitch Notes',
        tagline: 'ピッチの台本を書いて練習できるノートアプリ',
        listed: true,
      },
    });

    expect(result?.meta).toStrictEqual([
      { title: 'Pitch Notes | Launch Stadium' },
      {
        name: 'description',
        content: 'ピッチの台本を書いて練習できるノートアプリ',
      },
    ]);
    expect(result?.links).toStrictEqual([
      { rel: 'canonical', href: '/p/Pitch-Notes' },
    ]);
  });

  test('投稿者本人に未掲載のプロダクトを表示するときは、検索エンジンの登録を拒否する', () => {
    const result = head?.({
      loaderData: {
        handle: 'Pitch-Notes',
        name: 'Pitch Notes',
        tagline: 'ピッチの台本を書いて練習できるノートアプリ',
        listed: false,
      },
    });

    expect(result?.meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  test('取得の前や失敗ではサイト名だけにし、正規のURLを付けない', () => {
    const result = head?.({ loaderData: undefined });

    expect(result?.meta).toStrictEqual([{ title: 'Launch Stadium' }]);
    expect(result?.links).toStrictEqual([]);
  });
});
