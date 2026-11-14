import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { ClientProductLiveMatchDocument } from '../../graphql/generated/graphql.ts';
import { liveMatchOf, productLiveMatchOf } from './live-match-fixtures.ts';
import { productPageViewOf } from './product-page-fixtures.ts';
import type { ProductPageContext } from './product-page-section-types.ts';
import {
  autoRefreshSwitch,
  breadcrumbs,
  DESKTOP,
  liveMatchRegion,
  NO_LIVE_MATCH,
  pageRoot,
  precedes,
  productHeader,
  rectOf,
  registered,
  renderProductPage,
  sectionElement,
  sectionTexts,
  sidebar,
  TOKYO_JA,
  turnstileWidgets,
} from './product-page-testing.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const NARROW = { width: 800, height: 900 } as const;

const LAPTOP = { width: 1100, height: 900 } as const;

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const BOT_CHECK_FAILED_MESSAGE =
  '認証に失敗しました。ページを再読み込みして再度お試しください。';

const AWAITING = productLiveMatchOf({ awaitingChange: true, match: null });

function NothingSection(): null {
  return null;
}

function ThrowingSection(): never {
  throw new Error('区画の描画の失敗');
}

// 申告の状態を利用者の操作で変えられる、演出を持つ区画
function ReportingSection({ reportAutoUpdating }: ProductPageContext) {
  const [active, setActive] = useState(true);
  useEffect(() => {
    reportAutoUpdating(active);
  }, [active, reportAutoUpdating]);
  return (
    <button
      type="button"
      onClick={() => {
        setActive(false);
      }}
    >
      演出を止める区画
    </button>
  );
}

// 申告の後に描画に失敗する区画
function BreakableReportingSection({ reportAutoUpdating }: ProductPageContext) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    reportAutoUpdating(true);
  }, [reportAutoUpdating]);
  if (broken) {
    throw new Error('区画の描画の失敗');
  }
  return (
    <button
      type="button"
      onClick={() => {
        setBroken(true);
      }}
    >
      区画を壊す
    </button>
  );
}

const ALL_PLACEMENTS = [
  registered('test.bottom', 'bottom', 10),
  registered('test.main-30', 'main', 30),
  registered('test.aside-20', 'aside', 20),
  registered('test.banner-20', 'banner', 20),
  registered('test.main-10', 'main', 10),
  registered('test.aside-10', 'aside', 10),
  registered('test.banner-10', 'banner', 10),
];

const textOf = (id: string, autoRefresh = 'オン', isOwner = '他者'): string =>
  `${id}(Pitch-Notes・Pitch Notes・${isOwner}・自動更新${autoRefresh})`;

const runningAnimations = (): Animation[] =>
  document
    .getAnimations()
    .filter((animation) => animation.playState === 'running');

const animationTargetOf = (animation: Animation): Element | null => {
  const effect = animation.effect;
  return effect instanceof KeyframeEffect ? effect.target : null;
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  executeGraphQL.mockRejectedValue(new Error('想定外の取得です。'));
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  resetFakeTurnstile();
  await emulateBrowserDisplay(TOKYO_JA);
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  await emulateBrowserDisplay(null);
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('ProductPageの配置', () => {
  test('1024px以上は本文とサイドバーの2カラムで、サイドバーをヘッダーの横の高さから幅320〜352pxでスクロールに追従させる', async () => {
    await renderProductPage({
      sections: ALL_PLACEMENTS,
      liveMatch: productLiveMatchOf(),
    });
    await expect.element(sidebar()).toBeVisible();
    const header = rectOf(productHeader().element());
    const aside = sidebar().element();

    expect(rectOf(aside).left).toBeGreaterThan(header.right);
    expect(Math.round(rectOf(aside).top)).toBe(Math.round(header.top));
    expect(rectOf(aside).width).toBe(352);
    const follower = aside.firstElementChild;
    expect(follower === null ? '' : getComputedStyle(follower).position).toBe(
      'sticky',
    );
    expect(rectOf(liveMatchRegion().element()).top).toBeGreaterThan(
      header.bottom,
    );
    expect(rectOf(liveMatchRegion().element()).right).toBeLessThan(
      rectOf(aside).left,
    );

    await page.viewport(LAPTOP.width, LAPTOP.height);

    await expect.poll(() => rectOf(sidebar().element()).width).toBe(320);
  });

  test('1024px未満は1カラムで、サイドバーの内容をヘッダーの直後、開催中のマッチと本文の区画の前に置く', async () => {
    await page.viewport(NARROW.width, NARROW.height);
    await renderProductPage({
      sections: ALL_PLACEMENTS,
      liveMatch: productLiveMatchOf(),
    });
    await expect.element(liveMatchRegion()).toBeVisible();
    const header = rectOf(productHeader().element());
    const aside = rectOf(sidebar().element());

    expect(aside.top).toBeGreaterThan(header.bottom);
    expect(Math.round(aside.left)).toBe(Math.round(header.left));
    expect(aside.bottom).toBeLessThan(rectOf(liveMatchRegion().element()).top);
    expect(aside.bottom).toBeLessThan(
      rectOf(sectionElement(textOf('test.main-10'))).top,
    );
  });

  test('ページ上部の区画を全幅で先頭に置き、本文はパンくず・未掲載の案内・ヘッダー・開催中のマッチ・本文の区画・ページ末尾の区画の順に、置き場所ごとにorderの順で並べる', async () => {
    await renderProductPage({
      sections: ALL_PLACEMENTS,
      view: productPageViewOf({ listed: false, viewerIsOwner: true }),
      liveMatch: productLiveMatchOf(),
    });
    await expect.element(liveMatchRegion()).toBeVisible();
    const note = page.getByRole('note').element();
    const banner = sectionElement(textOf('test.banner-20', 'オン', '本人'));

    expect(sectionTexts()).toStrictEqual([
      textOf('test.banner-10', 'オン', '本人'),
      textOf('test.banner-20', 'オン', '本人'),
      textOf('test.aside-10', 'オン', '本人'),
      textOf('test.aside-20', 'オン', '本人'),
      textOf('test.main-10', 'オン', '本人'),
      textOf('test.main-30', 'オン', '本人'),
      textOf('test.bottom', 'オン', '本人'),
    ]);
    expect(precedes(banner, breadcrumbs().element())).toBe(true);
    expect(precedes(breadcrumbs().element(), note)).toBe(true);
    expect(precedes(note, productHeader().element())).toBe(true);
    expect(
      precedes(productHeader().element(), liveMatchRegion().element()),
    ).toBe(true);
    expect(
      precedes(
        liveMatchRegion().element(),
        sectionElement(textOf('test.main-10', 'オン', '本人')),
      ),
    ).toBe(true);
    expect(rectOf(banner).width).toBeGreaterThan(
      rectOf(productHeader().element()).width,
    );
    await expect
      .element(breadcrumbs().getByRole('link', { name: '開発ツール' }))
      .toHaveAttribute('href', '/p?category=dev-tools');
  });

  test('掲載中のプロダクトと他者の閲覧では未掲載の案内を描かない', async () => {
    await renderProductPage();
    await expect.element(productHeader()).toBeVisible();

    expect(page.getByRole('note').query()).toBeNull();
  });

  test('サイドバーと本文の区画が何も描かないときは、サイドバーの領域と区画の間隔を残さない', async () => {
    await renderProductPage({
      sections: [
        registered('test.aside-nothing', 'aside', 10, NothingSection),
        registered('test.main-nothing', 'main', 10, NothingSection),
        registered('test.main', 'main', 20),
      ],
    });
    await expect.element(page.getByText(textOf('test.main'))).toBeVisible();

    expect(sidebar().query()).toBeNull();
    const header = rectOf(productHeader().element());
    expect(Math.round(rectOf(sectionElement(textOf('test.main'))).width)).toBe(
      Math.round(header.width),
    );
    expect(
      rectOf(sectionElement(textOf('test.main'))).top - header.bottom,
    ).toBeLessThanOrEqual(32);
  });

  test('1つの区画の失敗はその位置に失敗の文言と再試行・問い合わせの導線を示し、他の区画とページの表示を続ける', async () => {
    await renderProductPage({
      sections: [
        registered('test.banner', 'banner', 10),
        registered('test.broken', 'main', 10, ThrowingSection),
        registered('test.main', 'main', 20),
        registered('test.aside', 'aside', 10),
      ],
    });

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    for (const id of ['test.banner', 'test.main', 'test.aside']) {
      await expect.element(page.getByText(textOf(id))).toBeVisible();
    }
    await expect.element(productHeader()).toBeVisible();
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ message: '区画の描画の失敗' }),
      'render',
    );
  });

  test('開催中のマッチの取得の失敗は区画の位置に失敗の文言と再試行を示し、ページの表示を続ける', async () => {
    executeGraphQL.mockImplementation((document: unknown) =>
      document === ClientProductLiveMatchDocument
        ? Promise.resolve({
            ok: false,
            error: new GraphQLClientError({
              code: 'internal_error',
              message: 'サーバーでエラーが発生しました。',
              status: 500,
            }),
          })
        : Promise.reject(new Error('想定外の取得です。')),
    );
    await renderProductPage({
      sections: [registered('test.main', 'main', 10)],
      liveMatchCached: false,
    });

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect.element(productHeader()).toBeVisible();
    await expect.element(page.getByText(textOf('test.main'))).toBeVisible();
  });
});

describe('ProductPageのbot判定', () => {
  test('開催中のマッチがあるときだけ、開催中のマッチの区画をbot判定で包み、区画の中にウィジェットを1つ置く', async () => {
    await renderProductPage({ liveMatch: productLiveMatchOf() });
    await expect.element(liveMatchRegion()).toBeVisible();

    const widgets = turnstileWidgets();
    expect(widgets).toHaveLength(1);
    const [widget] = widgets;
    expect(
      widget !== undefined &&
        precedes(liveMatchRegion().element(), widget) &&
        liveMatchRegion().element().parentElement?.contains(widget),
    ).toBe(true);
  });

  test.each([
    ['開催中のマッチが無い', NO_LIVE_MATCH],
    ['マッチの開始を待っている', AWAITING],
    [
      '結果が確定した',
      productLiveMatchOf({ match: liveMatchOf({ phase: 'FINISHED' }) }),
    ],
  ])('%s時はbot判定のウィジェットを置かない', async (_label, liveMatch) => {
    await renderProductPage({ liveMatch });
    await expect.element(productHeader()).toBeVisible();

    expect(turnstileWidgets()).toHaveLength(0);
    expect(liveMatchRegion().query()).toBeNull();
  });

  test('判定に失敗すると、対戦カードの下に失敗の文言を示す', async () => {
    await renderProductPage({ liveMatch: productLiveMatchOf() });
    await expect.element(liveMatchRegion()).toBeVisible();

    await userEvent.click(
      page.getByRole('button', { name: '判定を失敗させる' }),
    );

    const alert = page.getByRole('alert');
    await expect.element(alert).toHaveTextContent(BOT_CHECK_FAILED_MESSAGE);
    expect(precedes(liveMatchRegion().element(), alert.element())).toBe(true);
    expect(rectOf(alert.element()).top).toBeGreaterThanOrEqual(
      rectOf(liveMatchRegion().element()).bottom,
    );
  });
});

describe('ProductPageの自動更新の切り替え', () => {
  const PLAIN = [
    registered('test.banner', 'banner', 10),
    registered('test.main', 'main', 10),
    registered('test.aside', 'aside', 10),
  ];

  test('開催中のマッチがある間は、ページ上部の区画の下・パンくずの前に、区画とは別に1つだけオンの切り替えを描く', async () => {
    await renderProductPage({
      sections: PLAIN,
      liveMatch: productLiveMatchOf(),
    });

    await expect
      .element(autoRefreshSwitch())
      .toHaveAttribute('aria-checked', 'true');
    expect(page.getByRole('switch').elements()).toHaveLength(1);
    expect(pageRoot().dataset['autoRefresh']).toBe('on');
    expect(
      precedes(
        sectionElement(textOf('test.banner')),
        autoRefreshSwitch().element(),
      ),
    ).toBe(true);
    expect(
      precedes(autoRefreshSwitch().element(), breadcrumbs().element()),
    ).toBe(true);
  });

  test('キーボードでオフにすると区画が受け取る状態が偽になり、ページの根の属性が"off"に変わり、オンに戻せる', async () => {
    await renderProductPage({
      sections: PLAIN,
      liveMatch: productLiveMatchOf(),
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    autoRefreshSwitch().element().focus();
    await userEvent.keyboard(' ');

    await expect
      .element(autoRefreshSwitch())
      .toHaveAttribute('aria-checked', 'false');
    expect(pageRoot().dataset['autoRefresh']).toBe('off');
    expect(sectionTexts()).toStrictEqual([
      textOf('test.banner', 'オフ'),
      textOf('test.aside', 'オフ'),
      textOf('test.main', 'オフ'),
    ]);

    await userEvent.keyboard('{Enter}');

    expect(pageRoot().dataset['autoRefresh']).toBe('on');
    await expect.element(page.getByText(textOf('test.main'))).toBeVisible();
  });

  test('マッチの作成や開始を待つ間は、開催中のマッチが無くても切り替えを描く', async () => {
    await renderProductPage({ sections: PLAIN, liveMatch: AWAITING });

    await expect.element(autoRefreshSwitch()).toBeVisible();
  });

  test('開催中のマッチも変化を待つ状態も無く、申告している区画も無ければ切り替えを描かず、ページの根は"on"のまま', async () => {
    await renderProductPage({ sections: PLAIN });
    await expect.element(page.getByText(textOf('test.main'))).toBeVisible();

    expect(page.getByRole('switch').elements()).toHaveLength(0);
    expect(pageRoot().dataset['autoRefresh']).toBe('on');
  });

  test('開催中のマッチが無くても区画が申告している間は描き、申告を取り下げると消す', async () => {
    await renderProductPage({
      sections: [registered('test.reporting', 'aside', 20, ReportingSection)],
    });

    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(
      page.getByRole('button', { name: '演出を止める区画' }),
    );

    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('申告した区画がエラーの境界に捕まると、その区画の申告を消して切り替えを消す', async () => {
    await renderProductPage({
      sections: [
        registered('test.breakable', 'main', 10, BreakableReportingSection),
      ],
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '区画を壊す' }));

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('申告した区画が失敗しても、開催中のマッチがある間は切り替えを描き続ける', async () => {
    await renderProductPage({
      sections: [
        registered('test.breakable', 'main', 10, BreakableReportingSection),
      ],
      liveMatch: productLiveMatchOf(),
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '区画を壊す' }));

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(autoRefreshSwitch()).toBeVisible();
  });
});

describe('ProductPageの演出', () => {
  test('自動更新がオンの間は開催中のマッチの区画の中だけで演出が動き、オフにすると止まる', async () => {
    await renderProductPage({
      sections: [registered('test.main', 'main', 10)],
      liveMatch: productLiveMatchOf(),
    });
    await expect.element(liveMatchRegion()).toBeVisible();
    const live = liveMatchRegion().element();

    await expect.poll(() => runningAnimations().length).toBeGreaterThan(0);
    expect(
      runningAnimations().every((animation) =>
        live.contains(animationTargetOf(animation)),
      ),
    ).toBe(true);

    await userEvent.click(autoRefreshSwitch());

    await expect.poll(() => runningAnimations()).toStrictEqual([]);
  });

  test('視差効果を減らす設定では、自動更新がオンでも演出を動かさない', async () => {
    await emulateReducedMotion('reduce');
    await renderProductPage({ liveMatch: productLiveMatchOf() });
    await expect.element(liveMatchRegion()).toBeVisible();

    await expect.poll(() => runningAnimations()).toStrictEqual([]);
  });

  test('開催中のマッチが無いページには、動く演出を置かない', async () => {
    await renderProductPage({
      sections: [registered('test.main', 'main', 10)],
      liveMatch: AWAITING,
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await expect.poll(() => runningAnimations()).toStrictEqual([]);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test.each([
    [
      '他者が開催中のマッチを見ている',
      productPageViewOf(),
      productLiveMatchOf(),
    ],
    [
      '本人が未掲載のプロダクトを見ている',
      productPageViewOf({ listed: false, viewerIsOwner: true }),
      NO_LIVE_MATCH,
    ],
  ] as const)(
    '%sページで、アクセシビリティの検査の違反が0件',
    async (_label, view, liveMatch) => {
      await renderProductPage({
        sections: [
          registered('test.banner', 'banner', 10),
          registered('test.main', 'main', 10),
          registered('test.aside', 'aside', 10),
          registered('test.bottom', 'bottom', 10),
        ],
        view,
        liveMatch,
      });
      await expect.element(productHeader()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
