import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ClientProductTrophiesDocument } from '../../graphql/generated/graphql.ts';
import {
  DESKTOP,
  registered,
  renderProductPage,
} from '../product-page/product-page-testing.tsx';
import {
  trophyOf,
  WEEK_37_TROPHY,
  WEEK_45_TROPHY,
  WEEK_48_LAST_YEAR_TROPHY,
  YEAR_2025_TROPHY,
} from './trophy-fixtures.ts';
import type { ProductTrophyView } from './trophy-shelf-model.ts';
import { TrophyShelf } from './trophy-shelf.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const executeGraphQLMock = vi.mocked(executeGraphQL);

const NARROW = { width: 320, height: 900 } as const;

// 業務日付2026-11-17の12:00(業務時刻)。今年の受賞は年を付けずに示す
const NOW = new Date('2026-11-17T20:00:00.000Z');

const NETWORK_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const TROPHY_SECTION = registered(
  'tournament-week.trophies',
  'main',
  10,
  TrophyShelf,
);

function OtherSection() {
  return <p>説明文の区画</p>;
}

const OTHER_SECTION = registered('test.description', 'main', 30, OtherSection);

const ALL_TROPHIES: readonly ProductTrophyView[] = [
  WEEK_37_TROPHY,
  WEEK_48_LAST_YEAR_TROPHY,
  YEAR_2025_TROPHY,
  WEEK_45_TROPHY,
];

type TrophiesResponse = readonly ProductTrophyView[] | null | Error;

// 取得のたびに先頭の結果を返し、最後の結果は返し続ける
const respond = (responses: readonly TrophiesResponse[]): void => {
  const queue = [...responses];
  executeGraphQLMock.mockImplementation((document) => {
    if (document !== ClientProductTrophiesDocument) {
      return Promise.reject(new Error('想定外の文書の取得'));
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(
      next instanceof Error
        ? { ok: false, error: next }
        : { ok: true, data: { productTrophies: next ?? null } },
    ) as ReturnType<typeof executeGraphQL>;
  });
};

const trophyCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientProductTrophiesDocument,
  );

const main = () => page.getByRole('main');

const shelf = () => page.getByRole('region', { name: 'トロフィー' });

const shelfElement = (): HTMLElement => shelf().element() as HTMLElement;

const itemTexts = (): string[] =>
  Array.from(shelfElement().querySelectorAll('li')).map(
    (item) => item.textContent,
  );

const renderShelf = async (
  options: { readonly signedIn?: boolean } = {},
): Promise<void> => {
  await renderProductPage({
    sections: [TROPHY_SECTION, OTHER_SECTION],
    ...options,
  });
};

beforeEach(async () => {
  executeGraphQLMock.mockReset();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

afterEach(() => {
  vi.useRealTimers();
  applyColorScheme('light');
});

describe('TrophyShelfの表示の有無', () => {
  test.each([
    ['受賞が1件も無い', []],
    ['閲覧できないプロダクトでnullが返る', null],
  ] as const)('%sとき、区画を描かない', async (_name, trophies) => {
    respond([trophies]);
    await renderShelf();

    await expect.element(main().getByText('説明文の区画')).toBeVisible();
    await expect.poll(() => trophyCalls().length).toBe(1);
    await expect.element(shelf()).not.toBeInTheDocument();
    await expect
      .element(main().getByRole('heading', { name: 'トロフィー' }))
      .not.toBeInTheDocument();
  });

  test('受賞があると、本文の他の区画より前に見出し「トロフィー」の区画を描く', async () => {
    respond([[WEEK_37_TROPHY]]);
    await renderShelf();

    await expect
      .element(shelf().getByRole('heading', { level: 2, name: 'トロフィー' }))
      .toBeVisible();
    const description = main().getByText('説明文の区画').element();
    expect(
      shelfElement().compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  test('ページのハンドルで照会し、ゲストでも同じハンドルで照会する', async () => {
    respond([[WEEK_37_TROPHY]]);
    await renderShelf({ signedIn: false });

    await expect.element(shelf()).toBeVisible();
    expect(trophyCalls().map(([, variables]) => variables)).toStrictEqual([
      { productHandle: 'Pitch-Notes' },
    ]);
  });
});

describe('TrophyShelfの並びと各トロフィーの表示', () => {
  test('Product of the Yearを先頭に、Product of the Weekを受賞が新しい順に並べる', async () => {
    respond([ALL_TROPHIES]);
    await renderShelf();

    await expect.element(shelf().getByRole('listitem').first()).toBeVisible();
    expect(itemTexts()).toStrictEqual([
      'Product of the Year2025年1月10日受賞ブラケットを見る',
      'Product of the Week2026年第45週(11/2〜11/8)11月13日受賞ブラケットを見る',
      'Product of the Week2026年第37週(9/7〜9/13)9月18日受賞ブラケットを見る',
      'Product of the Week2025年第48週(11/24〜11/30)2025年12月5日受賞ブラケットを見る',
    ]);
  });

  test('受賞日は業務時刻の暦日を<time datetime>で示し、今年でなければ年を付ける', async () => {
    respond([[WEEK_37_TROPHY, WEEK_48_LAST_YEAR_TROPHY]]);
    await renderShelf();

    await expect.element(shelf().getByText('9月18日')).toBeVisible();
    const times = Array.from(shelfElement().querySelectorAll('time')).map(
      (time) => [time.getAttribute('datetime'), time.textContent],
    );
    expect(times).toStrictEqual([
      ['2026-09-18', '9月18日'],
      ['2025-12-05', '2025年12月5日'],
    ]);
  });

  test('ブラケットへのリンクは週の表記を名前に含み、見える文言は「ブラケットを見る」で、サーバーが返すパスの通常のリンクにする', async () => {
    respond([[WEEK_37_TROPHY]]);
    await renderShelf();

    const link = shelf().getByRole('link', {
      name: '2026年第37週(9/7〜9/13)のブラケットを見る',
    });
    await expect
      .element(link)
      .toHaveAttribute('href', '/tournaments/week/2026-W37');
    await expect.element(link).toHaveTextContent('ブラケットを見る', {
      normalizeWhitespace: true,
    });
    expect(link.element().textContent).toBe('ブラケットを見る');
    expect(link.element().tagName).toBe('A');
  });

  test('ブラケットのパスが無いトロフィーはリンクを置かない', async () => {
    respond([[trophyOf({ bracketPath: null })]]);
    await renderShelf();

    await expect.element(shelf().getByText('9月18日')).toBeVisible();
    await expect.element(shelf().getByRole('link')).not.toBeInTheDocument();
  });

  test('トロフィーの絵は支援技術に読ませない', async () => {
    respond([[YEAR_2025_TROPHY, WEEK_37_TROPHY]]);
    await renderShelf();

    await expect.element(shelf().getByRole('listitem').first()).toBeVisible();
    const arts = Array.from(
      shelfElement().querySelectorAll('svg[viewBox="0 0 64 80"]'),
    );
    expect(arts).toHaveLength(2);
    expect(
      Array.from(shelfElement().querySelectorAll('svg')).every(
        (svg) => svg.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
    expect(shelf().getByRole('img').elements()).toHaveLength(0);
  });

  test('キーボードで棚の各リンクへ順に移れる', async () => {
    respond([[YEAR_2025_TROPHY, WEEK_45_TROPHY]]);
    await renderShelf();
    const links = shelf().getByRole('link');
    await expect.element(links.first()).toBeVisible();

    (links.first().element() as HTMLElement).focus();
    await userEvent.keyboard('{Tab}');

    await expect
      .element(
        shelf().getByRole('link', {
          name: '2026年第45週(11/2〜11/8)のブラケットを見る',
        }),
      )
      .toHaveFocus();
  });

  test('画面幅320pxでもページに横スクロールを出さず、棚の中だけを横に送る', async () => {
    await page.viewport(NARROW.width, NARROW.height);
    respond([ALL_TROPHIES]);
    await renderShelf();

    await expect.element(shelf().getByRole('listitem').first()).toBeVisible();
    expect(hasHorizontalScroll()).toBe(false);
    const list = shelf().getByRole('list').element();
    expect(getComputedStyle(list).overflowX).toBe('auto');
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
  });
});

describe('TrophyShelfの取得の失敗', () => {
  test('最初の取得に失敗すると、区画の位置だけに失敗の文言と再試行を示し、他の区画の表示を続ける', async () => {
    respond([NETWORK_ERROR, [WEEK_37_TROPHY]]);
    await renderShelf();

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('サーバーでエラーが発生しました。');
    await expect.element(main().getByText('説明文の区画')).toBeVisible();
    await expect.element(shelf()).not.toBeInTheDocument();
  });

  test('再試行で取得し直し、成功すると棚を描いて見出しへフォーカスを移す', async () => {
    respond([NETWORK_ERROR, [WEEK_37_TROPHY]]);
    await renderShelf();

    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect
      .element(shelf().getByRole('heading', { level: 2, name: 'トロフィー' }))
      .toHaveFocus();
    expect(trophyCalls()).toHaveLength(2);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([
    ['画面幅1280px', DESKTOP],
    ['画面幅320px', NARROW],
  ] as const)('%sでアクセシビリティの検査の違反が0件', async (_name, size) => {
    await page.viewport(size.width, size.height);
    applyColorScheme(scheme);
    respond([ALL_TROPHIES]);
    await renderShelf();

    await expect.element(shelf().getByRole('listitem').first()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
