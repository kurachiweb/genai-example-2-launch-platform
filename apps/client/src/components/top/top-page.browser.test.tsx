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
import { renderInRouter } from '../../../test/page-router.tsx';
import { TopPage, type TopPageProps } from './top-page.tsx';
import type {
  TopPagePlacement,
  TopPageSection,
  TopPageSectionContext,
} from './top-page-section-types.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const DESKTOP = { width: 1280, height: 900 } as const;

const NARROW = { width: 800, height: 900 } as const;

const LIVE_BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: '2026-11-10',
  phase: 'LIVE',
  serverTime: '2026-11-10T03:00:00.000Z',
});

const RESULT_BOARD: TopPageSectionContext['board'] = Object.freeze({
  date: '2026-11-10',
  phase: 'RESULT',
  serverTime: '2026-11-10T14:45:00.000Z',
});

const HERO_TITLE = '1対1のマッチでローンチ。必ず半分は勝者になる。';

const SWITCH_DESCRIPTION =
  'オンの間は30秒ごとにUpvote数を取り直し、残り時間と演出を動かします。';

const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

// 受け取った文脈を文言に出し、区画の並びの確かめに使う目印を付ける
const labeledSection = (label: string): TopPageSection['component'] =>
  function LabeledSection({ board, viewer, autoRefresh }) {
    return (
      <p data-test-section="" className="rounded-xl border p-3">
        {`${label}(${board.phase}・${viewer.signedIn ? 'ログイン中' : '未ログイン'}・自動更新${autoRefresh ? 'オン' : 'オフ'})`}
      </p>
    );
  };

const registered = (
  id: string,
  placement: TopPagePlacement,
  order: number,
  component: TopPageSection['component'] = labeledSection(id),
): TopPageSection => ({ id, placement, order, component });

function NothingSection(): null {
  return null;
}

// 申告の状態を利用者の操作で変えられる、演出を持つ区画
function ReportingSection({ reportAutoUpdating }: TopPageSectionContext) {
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
function BreakableReportingSection({
  reportAutoUpdating,
}: TopPageSectionContext) {
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

function ThrowingSection(): never {
  throw new Error('区画の描画の失敗');
}

type PageOptions = Partial<TopPageProps>;

const propsOf = ({
  sections = [],
  board = RESULT_BOARD,
  signedIn = true,
  hasQualifierMatches = false,
}: PageOptions): TopPageProps => ({
  sections,
  board,
  signedIn,
  hasQualifierMatches,
});

const renderPage = (options: PageOptions = {}) =>
  renderInRouter(
    <main className="bg-background text-foreground">
      <TopPage {...propsOf(options)} />
    </main>,
  );

// 区画を外す操作をページの外に置き、区画のアンマウントを再現する
function DetachableSectionsPage(props: TopPageProps) {
  const [sections, setSections] = useState(props.sections);
  return (
    <main className="bg-background text-foreground">
      <button
        type="button"
        onClick={() => {
          setSections([]);
        }}
      >
        区画を外す
      </button>
      <TopPage {...props} sections={sections} />
    </main>
  );
}

const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });

const switches = () => page.getByRole('switch').elements();

const pageRoot = (): HTMLElement => {
  const root = document.querySelector<HTMLElement>('[data-auto-refresh]');
  if (root === null) {
    throw new Error('ページの根がありません。');
  }
  return root;
};

const sectionTexts = (): string[] =>
  Array.from(document.querySelectorAll('[data-test-section]')).map(
    (element) => element.textContent,
  );

const sectionElement = (text: string): HTMLElement =>
  page.getByText(text, { exact: true }).element() as HTMLElement;

const precedes = (before: Element, after: Element): boolean =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

const rectOf = (element: Element): DOMRect => element.getBoundingClientRect();

beforeEach(async () => {
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

afterEach(async () => {
  applyColorScheme('light');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('TopPageの区画の並び', () => {
  const ALL_PLACEMENTS = [
    registered('test.bottom', 'bottom', 10),
    registered('test.main-30', 'main', 30),
    registered('test.aside', 'aside', 10),
    registered('test.banner-20', 'banner', 20),
    registered('test.showcase', 'showcase', 10),
    registered('test.main-10', 'main', 10),
    registered('test.banner-10', 'banner', 10),
  ];

  test('登録の順によらず、上部の行・未ログインの案内・全幅の注目・本文・横の列・フッター直上の順に、置き場所ごとにorderの順で並べる', async () => {
    await renderPage({ sections: ALL_PLACEMENTS, signedIn: false });

    await expect
      .element(page.getByRole('region', { name: HERO_TITLE }))
      .toBeVisible();
    expect(sectionTexts()).toStrictEqual([
      'test.banner-10(RESULT・未ログイン・自動更新オン)',
      'test.banner-20(RESULT・未ログイン・自動更新オン)',
      'test.showcase(RESULT・未ログイン・自動更新オン)',
      'test.main-10(RESULT・未ログイン・自動更新オン)',
      'test.main-30(RESULT・未ログイン・自動更新オン)',
      'test.aside(RESULT・未ログイン・自動更新オン)',
      'test.bottom(RESULT・未ログイン・自動更新オン)',
    ]);
    const hero = page.getByRole('region', { name: HERO_TITLE }).element();
    expect(
      precedes(
        sectionElement('test.banner-20(RESULT・未ログイン・自動更新オン)'),
        hero,
      ),
    ).toBe(true);
    expect(
      precedes(
        hero,
        sectionElement('test.showcase(RESULT・未ログイン・自動更新オン)'),
      ),
    ).toBe(true);
  });

  test('ページの見出しを1つ置き、ログイン中は未ログインの案内を出さない', async () => {
    await renderPage({ sections: ALL_PLACEMENTS, board: LIVE_BOARD });

    await expect
      .element(page.getByRole('heading', { level: 1, name: 'Launch Stadium' }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText('test.main-10(LIVE・ログイン中・自動更新オン)'))
      .toBeVisible();
    expect(page.getByRole('region', { name: HERO_TITLE }).elements()).toEqual(
      [],
    );
  });

  test('画面幅1024px以上は横の列を本文の列の横に、未満は本文の下に置く', async () => {
    await renderPage({ sections: ALL_PLACEMENTS });
    const main = () =>
      sectionElement('test.main-10(RESULT・ログイン中・自動更新オン)');
    const aside = () =>
      sectionElement('test.aside(RESULT・ログイン中・自動更新オン)');
    await expect.element(aside()).toBeVisible();

    expect(Math.round(rectOf(aside()).top)).toBe(
      Math.round(rectOf(main()).top),
    );
    expect(rectOf(aside()).left).toBeGreaterThan(rectOf(main()).right);

    await page.viewport(NARROW.width, NARROW.height);

    const lastMain = sectionElement(
      'test.main-30(RESULT・ログイン中・自動更新オン)',
    );
    await expect
      .poll(() => rectOf(aside()).top)
      .toBeGreaterThan(rectOf(lastMain).bottom);
  });

  test('該当の無い区画は何も描かず、上部の行の位置も占めない', async () => {
    await renderPage({
      sections: [
        registered('test.nothing', 'banner', 5, NothingSection),
        registered('test.banner', 'banner', 10),
        registered('test.main-nothing', 'main', 5, NothingSection),
        registered('test.main', 'main', 10),
      ],
    });
    const banner = sectionElement(
      'test.banner(RESULT・ログイン中・自動更新オン)',
    );
    const main = sectionElement('test.main(RESULT・ログイン中・自動更新オン)');
    await expect.element(banner).toBeVisible();

    expect(sectionTexts()).toHaveLength(2);
    expect(Math.round(rectOf(banner).left)).toBe(Math.round(rectOf(main).left));
  });

  test('1つの区画の失敗はその位置に失敗の文言と再試行・問い合わせの導線を示し、他の区画の表示を続ける', async () => {
    await renderPage({
      sections: [
        registered('test.banner', 'banner', 10),
        registered('test.broken', 'main', 10, ThrowingSection),
        registered('test.main', 'main', 20),
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
    await expect
      .element(page.getByText('test.main(RESULT・ログイン中・自動更新オン)'))
      .toBeVisible();
    await expect
      .element(page.getByText('test.banner(RESULT・ログイン中・自動更新オン)'))
      .toBeVisible();
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ message: '区画の描画の失敗' }),
      'render',
    );
  });
});

describe('TopPageの自動更新の切り替え', () => {
  const BANNERS = [
    registered('test.banner-10', 'banner', 10),
    registered('test.banner-20', 'banner', 20),
    registered('test.main', 'main', 10),
  ];

  test('上部の行の先頭に、登録した区画とは別に1つだけ、名前と秒数の説明を持つオンのスイッチを描く', async () => {
    await renderPage({
      sections: [
        ...BANNERS,
        registered('test.reporting', 'main', 20, ReportingSection),
      ],
      board: LIVE_BOARD,
      hasQualifierMatches: true,
    });

    await expect
      .element(autoRefreshSwitch())
      .toHaveAttribute('aria-checked', 'true');
    await expect
      .element(autoRefreshSwitch())
      .toHaveAccessibleDescription(SWITCH_DESCRIPTION);
    expect(switches()).toHaveLength(1);
    expect(pageRoot().dataset['autoRefresh']).toBe('on');
    const firstBanner = sectionElement(
      'test.banner-10(LIVE・ログイン中・自動更新オン)',
    );
    expect(precedes(autoRefreshSwitch().element(), firstBanner)).toBe(true);
    expect(rectOf(autoRefreshSwitch().element()).top).toBeLessThan(
      rectOf(firstBanner).bottom,
    );
  });

  test('キーボードでオフにすると区画が受け取る状態が偽になり、ページの根の属性が"off"に変わり、オンに戻せる', async () => {
    await renderPage({
      sections: BANNERS,
      board: LIVE_BOARD,
      hasQualifierMatches: true,
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    autoRefreshSwitch().element().focus();
    await userEvent.keyboard(' ');

    await expect
      .element(autoRefreshSwitch())
      .toHaveAttribute('aria-checked', 'false');
    expect(pageRoot().dataset['autoRefresh']).toBe('off');
    expect(sectionTexts()).toStrictEqual([
      'test.banner-10(LIVE・ログイン中・自動更新オフ)',
      'test.banner-20(LIVE・ログイン中・自動更新オフ)',
      'test.main(LIVE・ログイン中・自動更新オフ)',
    ]);

    await userEvent.keyboard('{Enter}');

    await expect
      .element(autoRefreshSwitch())
      .toHaveAttribute('aria-checked', 'true');
    expect(pageRoot().dataset['autoRefresh']).toBe('on');
    await expect
      .element(page.getByText('test.main(LIVE・ログイン中・自動更新オン)'))
      .toBeVisible();
  });

  test.each([
    ['マッチ中の時間帯', LIVE_BOARD, false],
    ['結果の時間帯で予選の対戦カードがある間', RESULT_BOARD, true],
  ] as const)(
    '%sは、申告している区画が無くても切り替えを描く',
    async (_, board, hasQualifierMatches) => {
      await renderPage({ sections: BANNERS, board, hasQualifierMatches });

      await expect.element(autoRefreshSwitch()).toBeVisible();
    },
  );

  test('結果の時間帯で対戦カードが無く、申告している区画も無ければ切り替えを描かず、ページの根は"on"のまま', async () => {
    await renderPage({ sections: BANNERS });
    await expect
      .element(page.getByText('test.main(RESULT・ログイン中・自動更新オン)'))
      .toBeVisible();

    expect(switches()).toHaveLength(0);
    expect(pageRoot().dataset['autoRefresh']).toBe('on');
  });

  test('結果の時間帯で対戦カードが無くても、区画が申告している間は描き、申告を取り下げると消す', async () => {
    await renderPage({
      sections: [registered('test.reporting', 'main', 10, ReportingSection)],
    });

    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(
      page.getByRole('button', { name: '演出を止める区画' }),
    );

    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('申告した区画がエラーの境界に捕まると、その区画の申告を消して切り替えを消す', async () => {
    await renderPage({
      sections: [
        registered('test.breakable', 'main', 10, BreakableReportingSection),
      ],
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '区画を壊す' }));

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('申告した区画がページから外れると、その区画の申告を消して切り替えを消す', async () => {
    await renderInRouter(
      <DetachableSectionsPage
        {...propsOf({
          sections: [
            registered('test.reporting', 'main', 10, ReportingSection),
          ],
        })}
      />,
    );
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '区画を外す' }));

    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
  });

  test('1つの区画の申告が消えても、他の区画が申告している間は描き続ける', async () => {
    await renderPage({
      sections: [
        registered('test.breakable', 'main', 10, BreakableReportingSection),
        registered('test.reporting', 'main', 20, ReportingSection),
      ],
    });
    await expect.element(autoRefreshSwitch()).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: '区画を壊す' }));

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect.element(autoRefreshSwitch()).toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  beforeEach(() => {
    applyColorScheme(scheme);
  });

  test.each([
    ['未ログインで自動更新がオン', false, false],
    ['ログイン中で自動更新がオフ', true, true],
  ] as const)(
    '%sのページで、アクセシビリティの検査の違反が0件',
    async (_, signedIn, turnOff) => {
      await renderPage({
        sections: [
          registered('test.banner', 'banner', 10),
          registered('test.showcase', 'showcase', 10),
          registered('test.main', 'main', 10),
          registered('test.aside', 'aside', 10),
          registered('test.bottom', 'bottom', 10),
        ],
        board: LIVE_BOARD,
        signedIn,
        hasQualifierMatches: true,
      });
      await expect.element(autoRefreshSwitch()).toBeVisible();
      if (turnOff) {
        await userEvent.click(autoRefreshSwitch());
        await expect
          .element(autoRefreshSwitch())
          .toHaveAttribute('aria-checked', 'false');
      }

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('区画の失敗を含むページで、アクセシビリティの検査の違反が0件', async () => {
    await renderPage({
      sections: [
        registered('test.broken', 'main', 10, ThrowingSection),
        registered('test.main', 'main', 20),
      ],
      board: LIVE_BOARD,
      signedIn: false,
    });
    await expect.element(page.getByRole('alert')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
