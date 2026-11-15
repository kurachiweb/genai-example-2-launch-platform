import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { DirectoryItem } from './directory-item.tsx';
import {
  BYE_WIN,
  directoryItemOf,
  EARLY_WIN,
  WEEK_AWARD,
  YEAR_AWARD,
} from './directory-item-fixtures.ts';
import type { DirectoryItemData } from './directory-item-types.ts';
import type { DirectoryItemMetric } from './directory-section-types.ts';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const NOW = new Date('2026-11-10T08:00:00.000Z');

const LIST_PATH = '/p?q=note&from=2026-09-01&to=2026-09-30&sort=upvotes&page=3';

const LIST_QUERY: DirectoryQuery = {
  q: 'note',
  from: '2026-09-01',
  to: '2026-09-30',
  sort: 'upvotes',
  page: 3,
};

const DESKTOP = { width: 1280, height: 900 } as const;
const TABLET = { width: 900, height: 900 } as const;
const MOBILE = { width: 375, height: 900 } as const;
// Vitestのブラウザテストの既定の表示領域
const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

const metricOf = (key: string, order: number): DirectoryItemMetric => ({
  key,
  order,
  component: ({ value, productName, productHandle }) => (
    <span data-metric={key} data-product={productHandle}>
      {`${productName}の${key}は${value.toString()}`}
    </span>
  ),
});

interface RenderOptions {
  readonly query?: DirectoryQuery;
  readonly searchTerms?: readonly string[];
  readonly metricRegistrations?: readonly DirectoryItemMetric[];
  readonly path?: string;
}

const renderItem = (
  item: DirectoryItemData,
  {
    query = LIST_QUERY,
    searchTerms = [],
    metricRegistrations = [],
    path = LIST_PATH,
  }: RenderOptions = {},
) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <main className="bg-background p-4 text-foreground">
          <DirectoryItem
            item={item}
            query={query}
            searchTerms={searchTerms}
            metricRegistrations={metricRegistrations}
          />
        </main>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { path },
  );

const article = () => page.getByRole('article', { name: 'Pitch Notes' });
const nameLink = () =>
  page.getByRole('link', { name: 'Pitch Notes', exact: true });
const categoryLink = () =>
  page.getByRole('link', { name: 'カテゴリ「開発ツール」で絞り込む' });
const ownerLink = () =>
  page.getByRole('link', { name: /^投稿者:\s*スカウトの健$/u });
const siteLink = () =>
  page.getByRole('link', {
    name: /^Pitch Notesの\s*サイトを開く\s*\(新しいタブで開きます\)$/u,
  });
const editLink = () => page.getByRole('link', { name: 'Pitch Notesを編集' });
const winHeading = () => page.getByRole('heading', { name: '予選勝利' });

const centerOf = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

// 項目全体に広げたリンクの上で、その位置を押した時に操作を受け取る要素
const topmostLinkAt = (element: Element): Element | null => {
  const { x, y } = centerOf(element);
  return document.elementFromPoint(x, y)?.closest('a') ?? null;
};

const rectOf = (element: Element) => element.getBoundingClientRect();

const winSummaryOf = (): Element => {
  const summary = winHeading().element().closest('[data-slot="win-summary"]');
  if (summary === null) {
    throw new Error('勝利した予選マッチの枠がありません。');
  }
  return summary;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('DirectoryItem', () => {
  test('名称を見出しにした項目で、名称のリンクを詳細ページへ導き、項目の余白を押しても詳細ページへ遷移する', async () => {
    const router = await renderItem(directoryItemOf());

    await expect.element(article()).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 3, name: 'Pitch Notes' }))
      .toBeVisible();
    await expect.element(nameLink()).toHaveAttribute('href', '/p/pitch-notes');
    const tagline = page.getByText(
      'ピッチの台本を書いて練習できるノートアプリ。',
    );
    expect(topmostLinkAt(tagline.element())).toBe(nameLink().element());

    // タグラインの位置は名称のリンクが受け取るため、その位置を押したことを再現する
    await userEvent.click(tagline, { force: true });

    await expect
      .poll(() => router.state.location.pathname)
      .toBe('/p/pitch-notes');
  });

  test('カテゴリ・投稿者・「サイトを開く」は項目全体のリンクの前面にあり、個別に押せてキーボードでも順に操作できる', async () => {
    await renderItem(directoryItemOf());

    await expect.element(article()).toBeVisible();
    for (const control of [categoryLink(), ownerLink(), siteLink()]) {
      expect(topmostLinkAt(control.element())).toBe(control.element());
    }

    nameLink().element().focus();
    await userEvent.tab();
    await expect.element(categoryLink()).toHaveFocus();
    await userEvent.tab();
    await expect.element(ownerLink()).toHaveFocus();
    await userEvent.tab();
    await expect.element(siteLink()).toHaveFocus();
  });

  test('カテゴリのリンクは、ページを除く他の条件を保ったまま、そのカテゴリで絞り込んだ一覧へ導く', async () => {
    const router = await renderItem(directoryItemOf());

    await expect
      .element(categoryLink())
      .toHaveAttribute(
        'href',
        '/p?q=note&category=developer-tools&from=2026-09-01&to=2026-09-30&sort=upvotes',
      );
    await expect.element(categoryLink()).toHaveTextContent('開発ツール');

    await userEvent.click(categoryLink());

    await expect
      .poll(() => ({ ...router.state.location.search }))
      .toEqual({
        q: 'note',
        category: 'developer-tools',
        from: '2026-09-01',
        to: '2026-09-30',
        sort: 'upvotes',
      });
  });

  test.each([
    ['そのカテゴリの1ページ目', '/p?category=developer-tools', undefined],
    ['そのカテゴリの2ページ目', '/p?category=developer-tools&page=2', 2],
  ] as const)(
    '%sを表示中でも、カテゴリのリンクを現在のページとして示さない',
    async (_name, path, pageNumber) => {
      await renderItem(directoryItemOf(), {
        path,
        query: { category: 'developer-tools', page: pageNumber },
      });

      await expect
        .element(categoryLink())
        .toHaveAttribute('href', '/p?category=developer-tools');
      await expect.element(categoryLink()).not.toHaveAttribute('aria-current');
    },
  );

  test('投稿者のリンクは、アバターとニックネームを示し、支援技術にだけ「投稿者:」を伝え、公開プロフィールへ導く', async () => {
    const router = await renderItem(directoryItemOf());

    await expect.element(ownerLink()).toHaveAttribute('href', '/@scout-ken');
    await expect.element(ownerLink()).toHaveTextContent('スカウトの健');
    const prefix = ownerLink().element().querySelector('.sr-only');
    expect(prefix?.textContent).toBe('投稿者:');
    expect(
      ownerLink()
        .element()
        .querySelector('[aria-hidden="true"] [data-slot="media-placeholder"]'),
    ).not.toBeNull();
    expect(page.getByText('あなたのプロダクト').elements()).toHaveLength(0);
    expect(editLink().elements()).toHaveLength(0);

    await userEvent.click(ownerLink());

    await expect.poll(() => router.state.location.pathname).toBe('/@scout-ken');
  });

  test('表示できない投稿者は示さない', async () => {
    await renderItem(directoryItemOf({ owner: null }));

    await expect.element(article()).toBeVisible();
    expect(page.getByText(/投稿者/u).elements()).toHaveLength(0);
  });

  test('閲覧者自身のプロダクトは、投稿者の代わりに「あなたのプロダクト」のバッジを付け、編集の画面への「編集」を置く', async () => {
    await renderItem(directoryItemOf({ isViewerOwn: true }));

    await expect
      .element(page.getByText('あなたのプロダクト', { exact: true }))
      .toBeVisible();
    expect(ownerLink().elements()).toHaveLength(0);
    await expect
      .element(editLink())
      .toHaveAttribute('href', '/my/products/pitch-notes/edit');
    await expect.element(editLink()).toHaveTextContent('編集');
    expect(topmostLinkAt(editLink().element())).toBe(editLink().element());
  });

  test('「サイトを開く」は外部WebサイトURLを別タブにrel="noopener"で開く', async () => {
    await renderItem(directoryItemOf());

    await expect
      .element(siteLink())
      .toHaveAttribute('href', 'https://pitch-notes.example/');
    await expect.element(siteLink()).toHaveAttribute('target', '_blank');
    await expect.element(siteLink()).toHaveAttribute('rel', 'noopener');
  });

  test('外部WebサイトURLが空なら「サイトを開く」を出さない', async () => {
    await renderItem(directoryItemOf({ websiteUrl: '' }));

    await expect.element(article()).toBeVisible();
    expect(page.getByText('サイトを開く').elements()).toHaveLength(0);
  });

  test('名称・タグラインの検索語との一致箇所を強調し、検索語が無ければ強調しない', async () => {
    const tagline = 'Pitch practice notebook for founders';
    await renderItem(directoryItemOf({ tagline }), {
      searchTerms: ['pitch', 'note'],
    });

    const heading = page.getByRole('heading', { level: 3 }).element();
    expect(
      [...heading.querySelectorAll('mark')].map((mark) => mark.textContent),
    ).toStrictEqual(['Pitch', 'Note']);
    await expect.element(nameLink()).toBeVisible();
    const taglineElement = [...article().element().querySelectorAll('p')].find(
      (paragraph) => paragraph.textContent === tagline,
    );
    expect(
      [...(taglineElement?.querySelectorAll('mark') ?? [])].map(
        (mark) => mark.textContent,
      ),
    ).toStrictEqual(['Pitch', 'note']);
  });

  test('検索語が無ければ名称・タグラインを強調しない', async () => {
    await renderItem(directoryItemOf());

    await expect.element(article()).toBeVisible();
    expect(article().element().querySelectorAll('mark')).toHaveLength(0);
  });

  test('勝利した予選マッチを示し、今年のローンチ日は年を省く', async () => {
    await renderItem(directoryItemOf());

    await expect.element(winHeading()).toBeVisible();
    const time = winSummaryOf().querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-09-15');
    expect(time?.textContent).toBe('9月15日');
    await expect.element(page.getByText('Upvote数1,234票')).toBeVisible();
  });

  test.each([
    ['対戦相手がいない不戦勝', BYE_WIN, '対戦相手がいないため'],
    ['確定時点の票数の不戦勝', EARLY_WIN, '確定時点でUpvote数1,234票'],
  ] as const)('%sは「不戦勝」と理由を示す', async (_name, win, description) => {
    await renderItem(directoryItemOf({ win }));

    await expect
      .element(page.getByText('不戦勝', { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(description, { exact: true }))
      .toBeVisible();
  });

  test('受賞はYearを先頭にゴールドのバッジで示し、複数回は回数を添える', async () => {
    await renderItem(directoryItemOf({ awards: [WEEK_AWARD, YEAR_AWARD] }));

    const badges = article().getByRole('button');
    await expect.element(badges.first()).toBeVisible();
    expect(badges.elements().map((badge) => badge.textContent)).toStrictEqual([
      'Product of the Year',
      'Product of the Week ×3',
    ]);
    expect(topmostLinkAt(badges.first().element())).toBeNull();
  });

  test('受賞のバッジの右の空いた位置は、名称のリンクが受け取る', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    await renderItem(directoryItemOf({ awards: [YEAR_AWARD] }));

    const badge = article().getByRole('button').first();
    await expect.element(badge).toBeVisible();
    const badgeRect = rectOf(badge.element());
    const winRect = rectOf(winSummaryOf());
    const x = (badgeRect.right + winRect.left) / 2;
    const y = badgeRect.top + badgeRect.height / 2;

    expect(document.elementFromPoint(x, y)?.closest('a')).toBe(
      nameLink().element(),
    );
  });

  test('項目の値は、登録された値だけを登録の順に描き、登録の無い値と値の無い登録は描かない', async () => {
    await renderItem(
      directoryItemOf({
        metrics: [
          { key: 'comments', value: 12 },
          { key: 'reviews', value: 3 },
          { key: 'unregistered', value: 9 },
        ],
      }),
      {
        metricRegistrations: [
          metricOf('comments', 20),
          metricOf('missing', 5),
          metricOf('reviews', 10),
        ],
      },
    );

    await expect.element(article()).toBeVisible();
    const rendered = [
      ...article().element().querySelectorAll('[data-metric]'),
    ].map((metric) => metric.textContent);
    expect(rendered).toStrictEqual([
      'Pitch Notesのreviewsは3',
      'Pitch Notesのcommentsは12',
    ]);
    expect(
      article()
        .element()
        .querySelector('[data-metric]')
        ?.getAttribute('data-product'),
    ).toBe('pitch-notes');
  });

  test('画面幅1024px以上では、プロダクト情報・勝利した予選マッチ・操作ボタンを3列に並べる', async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    await renderItem(directoryItemOf({ isViewerOwn: true }));

    await expect.element(winHeading()).toBeVisible();
    const name = rectOf(nameLink().element());
    const win = rectOf(winSummaryOf());
    const site = rectOf(siteLink().element());
    const edit = rectOf(editLink().element());
    expect(win.left).toBeGreaterThanOrEqual(name.right);
    expect(site.left).toBeGreaterThanOrEqual(win.right);
    expect(edit.left).toBeGreaterThanOrEqual(win.right);
    expect(site.top).toBeLessThan(win.bottom);
  });

  test('画面幅768px以上1024px未満では2列にし、操作ボタンを勝利した予選マッチの下に置く', async () => {
    await page.viewport(TABLET.width, TABLET.height);
    await renderItem(directoryItemOf({ isViewerOwn: true }));

    await expect.element(winHeading()).toBeVisible();
    const name = rectOf(nameLink().element());
    const win = rectOf(winSummaryOf());
    const site = rectOf(siteLink().element());
    expect(win.left).toBeGreaterThanOrEqual(name.right);
    expect(site.top).toBeGreaterThanOrEqual(win.bottom);
    expect(site.left).toBeGreaterThanOrEqual(win.left);
  });

  test('画面幅768px未満では縦に積む', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    await renderItem(directoryItemOf({ isViewerOwn: true }));

    await expect.element(winHeading()).toBeVisible();
    const tagline = rectOf(
      page.getByText('ピッチの台本を書いて練習できるノートアプリ。').element(),
    );
    const win = rectOf(winSummaryOf());
    const site = rectOf(siteLink().element());
    expect(win.top).toBeGreaterThanOrEqual(tagline.bottom);
    expect(site.top).toBeGreaterThanOrEqual(win.bottom);
    expect(article().element().scrollWidth).toBeLessThanOrEqual(
      article().element().clientWidth,
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      [
        '他の投稿者のプロダクトで受賞・検索語・項目の値がある',
        directoryItemOf({
          awards: [YEAR_AWARD, WEEK_AWARD],
          metrics: [{ key: 'comments', value: 12 }],
        }),
      ],
      [
        '閲覧者自身のプロダクトで不戦勝',
        directoryItemOf({ isViewerOwn: true, win: EARLY_WIN }),
      ],
    ] as const)(
      '%sとき、アクセシビリティの検査の違反が0件',
      async (_name, item) => {
        applyColorScheme(scheme);
        await renderItem(item, {
          searchTerms: ['pitch'],
          metricRegistrations: [metricOf('comments', 10)],
        });
        await expect.element(winHeading()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
