import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { OWN_PRODUCT_RATING_MESSAGE } from '../../../common-lib/engagement/engagement-rules.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { productRatingQueryOptions } from '../../graphql/engagement.ts';
import {
  ClientCancelProductRatingDocument,
  ClientProductRatingDocument,
  ClientRateProductDocument,
  type ClientViewerQuery,
  type ProductRatingFragment,
} from '../../graphql/generated/graphql.ts';
import { productPageViewOf } from '../product-page/product-page-fixtures.ts';
import type { ProductPageContext } from '../product-page/product-page-section-types.ts';
import { RatingSection } from './rating-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const VIEW = productPageViewOf();

const PRODUCT_ID = VIEW.id;

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const ratingOf = (
  overrides: Partial<ProductRatingFragment> = {},
): ProductRatingFragment => ({
  productId: PRODUCT_ID,
  average: 4.25,
  count: 1234,
  viewerScore: null,
  ...overrides,
});

const EMPTY_RATING = ratingOf({ average: null, count: 0 });

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const OWN_PRODUCT_ERROR = new GraphQLClientError({
  code: 'rating_own_product',
  message: OWN_PRODUCT_RATING_MESSAGE,
  status: 422,
});

type Responder = (variables: Record<string, unknown>) => unknown;

interface Responders {
  readonly query?: Responder;
  readonly rate?: Responder;
  readonly cancel?: Responder;
}

const resultOf = (value: unknown) =>
  Promise.resolve(
    value instanceof Error
      ? { ok: false, error: value }
      : { ok: true, data: value },
  );

const respondWith = ({ query, rate, cancel }: Responders) => {
  executeGraphQL.mockImplementation(
    (document: unknown, variables: Record<string, unknown>) => {
      if (document === ClientProductRatingDocument && query !== undefined) {
        return resultOf(query(variables));
      }
      if (document === ClientRateProductDocument && rate !== undefined) {
        const value = rate(variables);
        return value instanceof Promise ? value : resultOf(value);
      }
      if (
        document === ClientCancelProductRatingDocument &&
        cancel !== undefined
      ) {
        return resultOf(cancel(variables));
      }
      return Promise.reject(new Error('想定外の操作です。'));
    },
  );
};

const callsOf = (document: unknown) =>
  executeGraphQL.mock.calls
    .filter(([called]) => called === document)
    .map(([, variables]) => variables as Record<string, unknown>);

interface RenderOptions {
  readonly viewerQuery?: ClientViewerQuery;
  readonly isOwner?: boolean;
  readonly rating?: ProductRatingFragment | Error | null;
}

const renderSection = async ({
  viewerQuery = signedInViewerQuery(),
  isOwner = false,
  rating = ratingOf(),
}: RenderOptions = {}): Promise<QueryClient> => {
  respondWith({
    query: () => (rating instanceof Error ? rating : { productRating: rating }),
  });
  const context = createPageRouterContext('local');
  const sectionContext: ProductPageContext = {
    product: {
      id: PRODUCT_ID,
      handle: VIEW.handle,
      name: VIEW.name,
      listed: true,
      ownerHandle: VIEW.owner.handle,
    },
    viewer: { signedIn: viewerQuery.viewer !== null, isOwner },
    page: VIEW,
    autoRefresh: true,
    reportAutoUpdating: vi.fn(),
  };
  await renderInRouter(
    <>
      <main className="bg-background p-4 text-foreground">
        <RatingSection {...sectionContext} />
      </main>
      <Toaster />
    </>,
    { context, cachedViewer: viewerQuery, path: `/p/${VIEW.handle}` },
  );
  return context.queryClient;
};

const section = () => page.getByRole('region', { name: '5段階評価' });

const heading = () => page.getByRole('heading', { name: '5段階評価' });

const ownRating = () => page.getByRole('radiogroup', { name: 'あなたの評価' });

const star = (score: number) =>
  page.getByRole('radio', { name: `5段階中${String(score)}`, exact: true });

const cancelButton = () => page.getByRole('button', { name: '取り消す' });

const toastText = (text: string) => page.getByText(text, { exact: true });

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('RatingSection', () => {
  test('見出し「5段階評価」の区画に、平均値を小数第1位で、評価数を3桁区切りで示し、平均値の星を読ませない', async () => {
    await renderSection();

    await expect.element(heading()).toBeInTheDocument();
    await expect.element(section()).toHaveTextContent('4.3(5段階中)');
    await expect.element(section()).toHaveTextContent('1,234件の評価');
    expect(callsOf(ClientProductRatingDocument)).toStrictEqual([
      { productId: PRODUCT_ID },
    ]);
    expect(
      section().element().querySelector('[data-slot="rating-meter"]'),
    ).toHaveAttribute('aria-hidden', 'true');
  });

  test.each<[string, ClientViewerQuery, boolean, boolean]>([
    ['確認済みの他の利用者', signedInViewerQuery(), false, true],
    ['未ログインの閲覧者', GUEST_VIEWER_QUERY, false, false],
    [
      'メールアドレス未確認の利用者',
      signedInViewerQuery({ emailVerified: false }),
      false,
      false,
    ],
    ['投稿者本人', signedInViewerQuery(), true, false],
  ])(
    '評価が0件なら平均値の代わりに「まだ評価がありません。」を示し、%sに最初の評価を促すかを決める',
    async (_label, viewerQuery, isOwner, invited) => {
      await renderSection({ viewerQuery, isOwner, rating: EMPTY_RATING });

      await expect
        .element(section())
        .toHaveTextContent('まだ評価がありません。');
      expect(section().element().textContent).not.toContain('件の評価');
      if (invited) {
        await expect
          .element(section())
          .toHaveTextContent('最初の評価をしてみませんか?');
      } else {
        expect(section().element().textContent).not.toContain(
          '最初の評価をしてみませんか?',
        );
      }
    },
  );

  test('ログイン中の他の利用者には「あなたの評価」の入力を置き、評価済みなら現在の評価を選んで「取り消す」を置く', async () => {
    await renderSection({ rating: ratingOf({ viewerScore: 3 }) });

    await expect.element(ownRating()).toBeInTheDocument();
    await expect.element(star(3)).toHaveAttribute('aria-checked', 'true');
    await expect.element(star(3)).toBeEnabled();
    await expect.element(cancelButton()).toBeInTheDocument();
  });

  test('未評価なら星を選んでいない入力だけを置き、「取り消す」を置かない', async () => {
    await renderSection();

    await expect.element(ownRating()).toBeInTheDocument();
    for (const score of [1, 2, 3, 4, 5]) {
      await expect
        .element(star(score))
        .toHaveAttribute('aria-checked', 'false');
    }
    expect(cancelButton().query()).toBeNull();
  });

  test.each<[string, ClientViewerQuery]>([
    ['確認済みの投稿者本人', signedInViewerQuery()],
    [
      'メールアドレス未確認の投稿者本人',
      signedInViewerQuery({ emailVerified: false }),
    ],
  ])(
    '%sには入力の代わりに「自身のプロダクトは評価できません。」を示す',
    async (_label, viewerQuery) => {
      await renderSection({ viewerQuery, isOwner: true });

      await expect
        .element(section())
        .toHaveTextContent(OWN_PRODUCT_RATING_MESSAGE);
      expect(ownRating().query()).toBeNull();
      expect(section().element().textContent).not.toContain(UNVERIFIED_REASON);
    },
  );

  test('未ログインの閲覧者には星を選ぶとログインして評価できる旨を示し、星を選ぶとログインの案内を開いて評価を送らない', async () => {
    await renderSection({ viewerQuery: GUEST_VIEWER_QUERY });

    await expect
      .element(section())
      .toHaveTextContent('星を選ぶとログインして評価できます。');
    await userEvent.click(star(4));

    const dialog = page.getByRole('dialog', {
      name: '評価にはログインが必要です',
    });
    await expect.element(dialog).toBeInTheDocument();
    await expect
      .element(dialog)
      .toHaveTextContent(
        'ログインすると、プロダクトを5段階で評価できます。評価は後から変更・取り消しできます。',
      );
    await expect
      .element(dialog.getByRole('link', { name: 'ログイン' }))
      .toHaveAttribute('href', `/auth/login?redirect=%2Fp%2F${VIEW.handle}`);
    expect(callsOf(ClientRateProductDocument)).toStrictEqual([]);

    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(star(4)).toHaveFocus();
    await expect.element(star(4)).toHaveAttribute('aria-checked', 'false');
  });

  test('メールアドレス未確認の利用者には星の入力を無効にし、確認が必要な理由を入力に結び付ける', async () => {
    await renderSection({
      viewerQuery: signedInViewerQuery({ emailVerified: false }),
    });

    for (const score of [1, 2, 3, 4, 5]) {
      await expect.element(star(score)).toBeDisabled();
    }
    await expect
      .element(ownRating())
      .toHaveAccessibleDescription(UNVERIFIED_REASON);
    expect(cancelButton().query()).toBeNull();
  });

  test('メールアドレス未確認でも評価済みなら「取り消す」で取り消せる', async () => {
    await renderSection({
      viewerQuery: signedInViewerQuery({ emailVerified: false }),
      rating: ratingOf({ viewerScore: 2 }),
    });
    respondWith({
      cancel: () => ({
        cancelProductRating: ratingOf({ count: 1233, viewerScore: null }),
      }),
    });

    await userEvent.click(cancelButton());

    await expect
      .element(toastText('評価を取り消しました。'))
      .toBeInTheDocument();
    expect(callsOf(ClientCancelProductRatingDocument)).toStrictEqual([
      { productId: PRODUCT_ID },
    ]);
    await expect.element(section()).toHaveTextContent('1,233件の評価');
    await expect.element(heading()).toHaveFocus();
  });

  test('未評価の利用者が星を選ぶと評価を送り、成功で平均値・評価数・自分の評価を結果で更新して「評価しました。」を示す', async () => {
    const queryClient = await renderSection({ rating: EMPTY_RATING });
    respondWith({
      rate: ({ score }) => ({
        rateProduct: ratingOf({
          average: 4,
          count: 1,
          viewerScore: score as number,
        }),
      }),
    });

    await userEvent.click(star(4));

    await expect.element(toastText('評価しました。')).toBeInTheDocument();
    expect(callsOf(ClientRateProductDocument)).toStrictEqual([
      { productId: PRODUCT_ID, score: 4 },
    ]);
    await expect.element(section()).toHaveTextContent('4.0(5段階中)');
    await expect.element(section()).toHaveTextContent('1件の評価');
    await expect.element(star(4)).toHaveAttribute('aria-checked', 'true');
    await expect.element(cancelButton()).toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey,
      ),
    ).toStrictEqual({
      productRating: ratingOf({ average: 4, count: 1, viewerScore: 4 }),
    });
  });

  test('評価済みの利用者が別の星を選ぶと「評価を変更しました。」を示す', async () => {
    await renderSection({ rating: ratingOf({ viewerScore: 3 }) });
    respondWith({
      rate: ({ score }) => ({
        rateProduct: ratingOf({ average: 4.3, viewerScore: score as number }),
      }),
    });

    await userEvent.click(star(5));

    await expect.element(toastText('評価を変更しました。')).toBeInTheDocument();
    await expect.element(star(5)).toHaveAttribute('aria-checked', 'true');
  });

  test('「取り消す」の成功で評価を外して「評価を取り消しました。」を示し、消えたボタンの代わりに星の入力へフォーカスを移す', async () => {
    await renderSection({ rating: ratingOf({ viewerScore: 3 }) });
    respondWith({
      cancel: () => ({
        cancelProductRating: ratingOf({ count: 1233, viewerScore: null }),
      }),
    });

    await userEvent.click(cancelButton());

    await expect
      .element(toastText('評価を取り消しました。'))
      .toBeInTheDocument();
    await expect.element(star(3)).toHaveAttribute('aria-checked', 'false');
    await expect.element(section()).toHaveTextContent('1,233件の評価');
    expect(cancelButton().query()).toBeNull();
    await expect.element(star(1)).toHaveFocus();
  });

  test('評価の送信中は選んだ星を示し、失敗すると操作の前の評価へ戻して失敗の理由を示す', async () => {
    await renderSection({ rating: ratingOf({ viewerScore: 3 }) });
    const pending = deferred<unknown>();
    respondWith({ rate: () => pending.promise });

    await userEvent.click(star(5));

    await expect.element(star(5)).toHaveAttribute('aria-checked', 'true');
    await expect
      .element(cancelButton())
      .toHaveAttribute('aria-disabled', 'true');
    pending.resolve({ ok: false, error: OWN_PRODUCT_ERROR });

    await expect
      .element(toastText(OWN_PRODUCT_RATING_MESSAGE))
      .toBeInTheDocument();
    await expect.element(star(3)).toHaveAttribute('aria-checked', 'true');
    await expect.element(star(5)).toHaveAttribute('aria-checked', 'false');
    await expect.element(section()).toHaveTextContent('1,234件の評価');
  });

  test('評価の値の誤りは、詳細の文言を示す', async () => {
    await renderSection();
    respondWith({
      rate: () =>
        new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容に誤りがあります。',
          status: 400,
          details: [
            {
              field: 'score',
              code: 'invalid_value',
              message: '評価は1〜5で選んでください。',
            },
          ],
        }),
    });

    await userEvent.click(star(2));

    await expect
      .element(toastText('評価は1〜5で選んでください。'))
      .toBeInTheDocument();
    await expect.element(star(2)).toHaveAttribute('aria-checked', 'false');
  });

  test('取り消しに失敗すると評価と「取り消す」を残して失敗の理由を示す', async () => {
    await renderSection({ rating: ratingOf({ viewerScore: 3 }) });
    respondWith({ cancel: () => INTERNAL_ERROR });

    await userEvent.click(cancelButton());

    await expect
      .element(toastText('サーバーでエラーが発生しました。'))
      .toBeInTheDocument();
    await expect.element(star(3)).toHaveAttribute('aria-checked', 'true');
    await expect.element(cancelButton()).toBeInTheDocument();
  });

  test('送信中に矢印キーで続けて選び直すと、送信の後に最後に選んだ値だけを送り、通知は1回にする', async () => {
    await renderSection({ rating: ratingOf({ viewerScore: 2 }) });
    const first = deferred<unknown>();
    respondWith({
      rate: ({ score }) =>
        score === 3
          ? first.promise
          : {
              rateProduct: ratingOf({ viewerScore: score as number }),
            },
    });

    await userEvent.click(star(2));
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');

    await expect.element(star(5)).toHaveAttribute('aria-checked', 'true');
    await expect.element(star(5)).toHaveFocus();
    expect(callsOf(ClientRateProductDocument)).toStrictEqual([
      { productId: PRODUCT_ID, score: 3 },
    ]);
    first.resolve({
      ok: true,
      data: { rateProduct: ratingOf({ viewerScore: 3 }) },
    });

    await expect.element(toastText('評価を変更しました。')).toBeInTheDocument();
    expect(callsOf(ClientRateProductDocument)).toStrictEqual([
      { productId: PRODUCT_ID, score: 3 },
      { productId: PRODUCT_ID, score: 5 },
    ]);
    await expect.element(star(5)).toHaveAttribute('aria-checked', 'true');
    expect(page.getByText('評価を変更しました。').elements()).toHaveLength(1);
  });

  test('読み込み中は評価欄の形を保ったスケルトンを示し、読み込み中であることを伝える', async () => {
    executeGraphQL.mockImplementation(() => new Promise(() => undefined));
    const context = createPageRouterContext('local');
    await renderInRouter(
      <RatingSection
        product={{
          id: PRODUCT_ID,
          handle: VIEW.handle,
          name: VIEW.name,
          listed: true,
          ownerHandle: VIEW.owner.handle,
        }}
        viewer={{ signedIn: true, isOwner: false }}
        page={VIEW}
        autoRefresh
        reportAutoUpdating={vi.fn()}
      />,
      { context, cachedViewer: signedInViewerQuery() },
    );

    await expect.element(heading()).toBeInTheDocument();
    await expect
      .element(section().getByRole('status'))
      .toHaveTextContent('評価を読み込み中');
  });

  test('取得に失敗すると欄の中だけに失敗の文言と再試行を示し、再試行で見出しへフォーカスを移して取り直す', async () => {
    await renderSection({ rating: INTERNAL_ERROR });

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent('評価を読み込めませんでした。');
    respondWith({ query: () => ({ productRating: ratingOf() }) });
    await userEvent.click(section().getByRole('button', { name: '再試行' }));

    await expect.element(heading()).toHaveFocus();
    await expect.element(section()).toHaveTextContent('1,234件の評価');
    expect(section().getByRole('alert').query()).toBeNull();
  });

  test('閲覧できないプロダクト(null)なら何も描かない', async () => {
    await renderSection({ rating: null });

    await vi.waitFor(() => {
      expect(callsOf(ClientProductRatingDocument)).toHaveLength(1);
    });
    await expect.element(heading()).not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each<[string, RenderOptions]>([
      ['評価済みの利用者', { rating: ratingOf({ viewerScore: 4 }) }],
      [
        '評価が0件の未確認の利用者',
        {
          viewerQuery: signedInViewerQuery({ emailVerified: false }),
          rating: EMPTY_RATING,
        },
      ],
      ['未ログインの閲覧者', { viewerQuery: GUEST_VIEWER_QUERY }],
      ['投稿者本人', { isOwner: true }],
      ['取得の失敗', { rating: INTERNAL_ERROR }],
    ])(
      '%sの評価欄のアクセシビリティの検査の違反が0件',
      async (_label, options) => {
        applyColorScheme(scheme);
        await renderSection(options);
        await expect.element(heading()).toBeInTheDocument();
        await expect
          .element(section().getByText(/件の評価|まだ評価|読み込めません/u))
          .toBeInTheDocument();

        expect(await runAxe(section().element())).toStrictEqual([]);
      },
    );
  });
});
