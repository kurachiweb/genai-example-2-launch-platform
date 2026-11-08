import { use, useId } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../lib/test/computed-style.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { publicProfileOf } from './public-profile-fixtures.ts';
import {
  deferred,
  renderPublicProfilePage,
  tabOf,
} from './public-profile-page-testing.tsx';
import { ProfileTabs } from './profile-tabs.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const LAUNCHES = tabOf({
  id: 'launches',
  label: 'ローンチ履歴',
  order: 10,
  count: 12,
});

const UPVOTES = tabOf({
  id: 'upvotes',
  label: 'Upvote履歴',
  order: 20,
  count: 1234,
});

const tabList = () => page.getByRole('tablist', { name: 'プロフィールの内容' });

const tabNamed = (name: string | RegExp) => page.getByRole('tab', { name });

const TALL_PANEL_HEIGHT_PX = 2400;

const tallTab = (id: string, label: string, order: number) =>
  tabOf({
    id,
    label,
    order,
    count: 3,
    Panel: () => (
      <div style={{ height: TALL_PANEL_HEIGHT_PX }}>{label}の長い一覧</div>
    ),
  });

beforeEach(async () => {
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await page.viewport(1280, 800);
});

afterEach(async () => {
  vi.restoreAllMocks();
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  window.scrollTo(0, 0);
});

describe('ProfileTabs', () => {
  test('登録の順序の小さい順に、件数を添えた下線型のタブを並べ、先頭を選択する', async () => {
    await renderPublicProfilePage(publicProfileOf(), {
      tabs: [UPVOTES, LAUNCHES],
    });

    await expect.element(tabList()).toBeVisible();
    const tabs = page.getByRole('tab');
    await expect.poll(() => tabs.elements().length).toBe(2);
    await expect.element(tabs.first()).toHaveTextContent('ローンチ履歴');
    await expect.element(tabs.nth(1)).toHaveTextContent('Upvote履歴');
    await expect
      .element(tabNamed(/ローンチ履歴/))
      .toHaveAttribute('aria-selected', 'true');
    await expect
      .element(tabNamed(/Upvote履歴/))
      .toHaveAttribute('aria-selected', 'false');
    await expect.element(tabList()).toHaveAttribute('data-variant', 'line');
  });

  test('件数を画面には数字だけで示し、読み上げでは件数の後に「件」を続ける', async () => {
    await renderPublicProfilePage(publicProfileOf(), {
      tabs: [LAUNCHES, UPVOTES],
    });

    await expect.element(tabNamed(/ローンチ履歴\s*12\s*件/)).toBeVisible();
    await expect.element(tabNamed(/Upvote履歴\s*1234\s*件/)).toBeVisible();
    const visibleUnit = tabNamed(/ローンチ履歴/)
      .element()
      .querySelector('.sr-only');
    expect(visibleUnit?.textContent).toBe('件');
  });

  test('件数の部品が無いタブには件数を添えない', async () => {
    await renderPublicProfilePage(publicProfileOf(), {
      tabs: [tabOf({ id: 'launches', label: 'ローンチ履歴', order: 10 })],
    });

    await expect
      .element(tabNamed('ローンチ履歴'))
      .toHaveTextContent(/^ローンチ履歴$/);
  });

  test('登録されたタブが0件なら何も描かない', async () => {
    const { container } = await render(
      <ProfileTabs
        tabs={[]}
        context={{
          handle: 'maker_ai',
          nickname: 'AIの作り手',
          isOwner: false,
          suspended: false,
        }}
        tab={undefined}
        onTabChange={vi.fn()}
      />,
    );

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  test('選択中のタブのパネルだけを描く', async () => {
    await renderPublicProfilePage(publicProfileOf(), {
      tabs: [LAUNCHES, UPVOTES],
    });

    await expect.element(page.getByText('ローンチ履歴の内容')).toBeVisible();
    await expect
      .element(page.getByText('Upvote履歴の内容'))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole('tabpanel'))
      .toHaveTextContent('ローンチ履歴の内容');
  });

  describe('tabのクエリ', () => {
    test('先頭のタブはクエリを省略し、他のタブへ切り替えるとtabに保持する', async () => {
      const router = await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, UPVOTES],
      });
      await expect.element(tabList()).toBeVisible();
      expect(router.state.location.searchStr).toBe('');

      await userEvent.click(tabNamed(/Upvote履歴/));

      await expect.element(page.getByText('Upvote履歴の内容')).toBeVisible();
      expect(router.state.location.search).toEqual({ tab: 'upvotes' });
      expect(router.state.location.searchStr).toBe('?tab=upvotes');

      await userEvent.click(tabNamed(/ローンチ履歴/));

      await expect.element(page.getByText('ローンチ履歴の内容')).toBeVisible();
      expect(router.state.location.searchStr).toBe('');
    });

    test('URLのtabのタブを選択して開く', async () => {
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, UPVOTES],
        path: '/?tab=upvotes',
      });

      await expect
        .element(tabNamed(/Upvote履歴/))
        .toHaveAttribute('aria-selected', 'true');
      await expect.element(page.getByText('Upvote履歴の内容')).toBeVisible();
    });

    test('登録されていない値は先頭のタブとして扱う', async () => {
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, UPVOTES],
        path: '/?tab=unknown',
      });

      await expect
        .element(tabNamed(/ローンチ履歴/))
        .toHaveAttribute('aria-selected', 'true');
      await expect.element(page.getByText('ローンチ履歴の内容')).toBeVisible();
    });

    test('ブラウザの戻る・進むで選択を復元する', async () => {
      const router = await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, UPVOTES],
      });
      await expect.element(tabList()).toBeVisible();
      await userEvent.click(tabNamed(/Upvote履歴/));
      await expect
        .element(tabNamed(/Upvote履歴/))
        .toHaveAttribute('aria-selected', 'true');

      router.history.back();

      await expect
        .element(tabNamed(/ローンチ履歴/))
        .toHaveAttribute('aria-selected', 'true');
      await expect.element(page.getByText('ローンチ履歴の内容')).toBeVisible();

      router.history.forward();

      await expect
        .element(tabNamed(/Upvote履歴/))
        .toHaveAttribute('aria-selected', 'true');
      await expect.element(page.getByText('Upvote履歴の内容')).toBeVisible();
    });

    test('矢印キーで隣のタブを選択するとクエリも変わる', async () => {
      const router = await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, UPVOTES],
      });
      await expect.element(tabList()).toBeVisible();
      (tabNamed(/ローンチ履歴/).element() as HTMLElement).focus();

      await userEvent.keyboard('{ArrowRight}');

      await expect
        .element(tabNamed(/Upvote履歴/))
        .toHaveAttribute('aria-selected', 'true');
      expect(router.state.location.searchStr).toBe('?tab=upvotes');
    });
  });

  describe('追従の状態での切り替え', () => {
    const TABS = [
      tallTab('launches', 'ローンチ履歴', 10),
      tallTab('upvotes', 'Upvote履歴', 20),
    ];
    const SITE_HEADER_PX = 56;

    test('タブバーが追従している状態で切り替えると、タブの位置まで表示を戻す', async () => {
      await emulateReducedMotion('reduce');
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();
      const restingTop = tabList().element().getBoundingClientRect().top;
      expect(restingTop).toBeGreaterThan(SITE_HEADER_PX);
      window.scrollTo(0, 1000);
      await expect.poll(() => window.scrollY).toBe(1000);

      await userEvent.click(tabNamed(/Upvote履歴/));

      await expect
        .poll(() => window.scrollY)
        .toBeCloseTo(restingTop - SITE_HEADER_PX, 0);
      await expect
        .element(page.getByText('Upvote履歴の長い一覧'))
        .toBeVisible();
    });

    test('視差効果を減らす設定が無ければ、滑らかにタブの位置まで表示を戻す', async () => {
      await emulateReducedMotion('no-preference');
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();
      const restingTop = tabList().element().getBoundingClientRect().top;
      window.scrollTo(0, 1000);
      await expect.poll(() => window.scrollY).toBe(1000);

      await userEvent.click(tabNamed(/Upvote履歴/));

      await expect
        .poll(() => window.scrollY)
        .toBeCloseTo(restingTop - SITE_HEADER_PX, 0);
    });

    test('追従していない状態で切り替えてもスクロールしない', async () => {
      await emulateReducedMotion('reduce');
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();
      window.scrollTo(0, 10);
      await expect.poll(() => window.scrollY).toBe(10);

      await userEvent.click(tabNamed(/Upvote履歴/));

      await expect
        .element(page.getByText('Upvote履歴の長い一覧'))
        .toBeVisible();
      expect(window.scrollY).toBe(10);
    });
  });

  describe('切り替え中の読み込み表示', () => {
    test('切り替え中はパネルの部分だけを読み込み中にし、人物情報とタブは保つ', async () => {
      const gate = deferred();
      const slowUpvotes = tabOf({
        id: 'upvotes',
        label: 'Upvote履歴',
        order: 20,
        count: 1234,
        Panel: () => {
          use(gate.promise);
          return <p>Upvote履歴の取得結果</p>;
        },
      });
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, slowUpvotes],
      });
      await expect.element(page.getByText('ローンチ履歴の内容')).toBeVisible();

      await userEvent.click(tabNamed(/Upvote履歴/));

      const loading = page.getByRole('status');
      await expect.element(loading).toHaveTextContent('読み込み中');
      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toBeVisible();
      await expect.element(tabList()).toBeVisible();
      await expect
        .element(tabNamed(/Upvote履歴/))
        .toHaveAttribute('aria-selected', 'true');
      await expect
        .element(page.getByText('ローンチ履歴の内容'))
        .not.toBeInTheDocument();

      gate.resolve();

      await expect
        .element(page.getByText('Upvote履歴の取得結果'))
        .toBeVisible();
      await expect.element(loading).not.toBeInTheDocument();
    });

    test('読み込み中の表示でもaxeの違反が0件である', async () => {
      const gate = deferred();
      const slowUpvotes = tabOf({
        id: 'upvotes',
        label: 'Upvote履歴',
        order: 20,
        Panel: () => {
          use(gate.promise);
          return <p>取得結果</p>;
        },
      });
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, slowUpvotes],
      });
      await expect.element(tabList()).toBeVisible();
      await userEvent.click(tabNamed(/Upvote履歴/));
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent('読み込み中');

      expect(await runAxe(document.body)).toStrictEqual([]);
      gate.resolve();
    });

    test('件数の取得中はタブの文言だけを示し、取得できたら件数を添える', async () => {
      const gate = deferred();
      const slowCount = tabOf({
        id: 'launches',
        label: 'ローンチ履歴',
        order: 10,
        Panel: () => <p>ローンチ履歴の内容</p>,
      });
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [
          {
            ...slowCount,
            Count: () => {
              use(gate.promise);
              return <>7</>;
            },
          },
        ],
      });

      await expect.element(tabNamed(/ローンチ履歴/)).toBeVisible();
      await expect.element(tabNamed(/ローンチ履歴/)).not.toHaveTextContent('7');

      gate.resolve();

      await expect.element(tabNamed(/ローンチ履歴\s*7\s*件/)).toBeVisible();
    });
  });

  describe('パネルの取得の失敗', () => {
    test('失敗はパネルの位置に留め、人物情報とタブを保って再試行できる', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let failing = true;
      const flaky = tabOf({
        id: 'launches',
        label: 'ローンチ履歴',
        order: 10,
        Panel: () => {
          if (failing) {
            throw new Error('取得に失敗');
          }
          return <p>ローンチ履歴の再取得結果</p>;
        },
      });
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [flaky, UPVOTES],
      });

      await expect.element(page.getByRole('alert')).toBeVisible();
      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toBeVisible();
      await expect.element(tabList()).toBeVisible();

      await userEvent.click(tabNamed(/Upvote履歴/));
      await expect.element(page.getByText('Upvote履歴の内容')).toBeVisible();
      await userEvent.click(tabNamed(/ローンチ履歴/));
      await expect.element(page.getByRole('alert')).toBeVisible();

      failing = false;
      await userEvent.click(page.getByRole('button', { name: '再試行' }));

      await expect
        .element(page.getByText('ローンチ履歴の再取得結果'))
        .toBeVisible();
    });
  });

  describe('再試行の後のフォーカス', () => {
    test('失敗→再試行→保留するパネルが解決するまで、フォーカスを文書の先頭へ落とさず、描き終えた見出しへ移す', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let failing = true;
      const gate = deferred();
      const slow = tabOf({
        id: 'launches',
        label: 'ローンチ履歴',
        order: 10,
        Panel: function SlowPanel() {
          const headingId = useId();
          if (failing) {
            throw new Error('取得に失敗');
          }
          use(gate.promise);
          return (
            <section aria-labelledby={headingId}>
              <h3 id={headingId}>ローンチの一覧</h3>
            </section>
          );
        },
      });
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [slow, UPVOTES],
      });
      await expect.element(page.getByRole('alert')).toBeVisible();
      failing = false;

      await userEvent.click(page.getByRole('button', { name: '再試行' }));

      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent('読み込み中');
      expect(document.activeElement).not.toBe(document.body);

      gate.resolve();

      await expect
        .element(
          page.getByRole('heading', { level: 3, name: 'ローンチの一覧' }),
        )
        .toHaveFocus();
    });
  });

  describe('件数の取得の失敗', () => {
    const tabWithCount = (Count: () => never) => ({
      ...tabOf({ id: 'launches', label: 'ローンチ履歴', order: 10 }),
      Count,
    });

    test('素の例外はエラートラッキングへ1回送り、件数のピルだけを描かず、タブは見えて操作できる', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const failure = new Error('件数の描画の失敗');
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [
          tabWithCount(() => {
            throw failure;
          }),
          UPVOTES,
        ],
      });

      await expect.element(tabNamed('ローンチ履歴')).toBeVisible();
      expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
        failure,
        'render',
      );
      expect(
        tabNamed('ローンチ履歴').element().querySelector('.rounded-full'),
      ).toBeNull();
      await expect.element(tabNamed(/Upvote履歴\s*1234\s*件/)).toBeVisible();

      await userEvent.click(tabNamed(/Upvote履歴/));

      await expect.element(page.getByText('Upvote履歴の内容')).toBeVisible();
    });

    test('GraphQLの失敗は取得の補助が送っているため、送り直さない', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const unavailable = new GraphQLClientError({
        code: 'upstream_unavailable',
        message: '現在ご利用いただけません。',
        status: 503,
      });
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [
          tabWithCount(() => {
            throw unavailable;
          }),
        ],
      });

      await expect.element(tabNamed('ローンチ履歴')).toBeVisible();
      expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();
      expect(
        tabNamed('ローンチ履歴').element().querySelector('.rounded-full'),
      ).toBeNull();
    });
  });

  describe('フォーカスの輪郭', () => {
    const OUTLINE_REACH_PX = 4;

    const tabUntilFocused = async (element: Element): Promise<void> => {
      for (
        let step = 0;
        step < 40 && document.activeElement !== element;
        step += 1
      ) {
        await userEvent.tab();
      }
      expect(document.activeElement).toBe(element);
    };

    // 輪郭(幅2pxとオフセット2px)の外縁が、overflowで切り取る祖先と画面の内側に収まるか
    const isOutlineClipped = (element: Element): boolean => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      const reach = {
        left: left - OUTLINE_REACH_PX,
        right: right + OUTLINE_REACH_PX,
        top: top - OUTLINE_REACH_PX,
        bottom: bottom + OUTLINE_REACH_PX,
      };
      const clippers = [];
      for (
        let node = element.parentElement;
        node !== null;
        node = node.parentElement
      ) {
        const { overflowX, overflowY } = getComputedStyle(node);
        if (overflowX !== 'visible' || overflowY !== 'visible') {
          clippers.push(node.getBoundingClientRect());
        }
      }
      return (
        reach.left < 0 ||
        reach.right > window.innerWidth ||
        clippers.some(
          (box) =>
            reach.left < box.left ||
            reach.right > box.right ||
            reach.top < box.top ||
            reach.bottom > box.bottom,
        )
      );
    };

    test.each([
      { name: 'PC', width: 1280 },
      { name: 'モバイル', width: 375 },
    ])(
      '$name($width px)で、キーボードで移ったフォーカスのタブの輪郭がリングの色で示され、切り取られない',
      async ({ width }) => {
        await page.viewport(width, 800);
        await renderPublicProfilePage(publicProfileOf(), {
          tabs: [LAUNCHES, UPVOTES],
        });
        await expect.element(tabList()).toBeVisible();
        const trigger = tabNamed(/ローンチ履歴/).element();

        await tabUntilFocused(trigger);

        await expect
          .poll(() => outlineOf(trigger))
          .toStrictEqual(ringOutline());
        expect(isOutlineClipped(trigger)).toBe(false);
      },
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('選択中と未選択のタブと件数のaxeの違反が0件である', async () => {
      applyColorScheme(scheme);
      await renderPublicProfilePage(publicProfileOf(), {
        tabs: [LAUNCHES, UPVOTES],
      });
      await expect.element(tabList()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
