import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Locator, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { MAIN_CONTENT_ID } from '../../../lib/components/app-shell/main-content.ts';
import { SkipLink } from '../../../lib/components/app-shell/skip-link.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../lib/test/computed-style.ts';
import {
  SITE_LAYOUT_SLOTS,
  type SiteLayoutSlots,
} from '../../composition/layout-slots.ts';
import { SiteLayout } from './site-layout.tsx';

const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;
const MENU_BREAKPOINT_WIDTH = 768;
const NARROWEST_VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 800;

const PRIMARY_LINKS = [
  ['ディレクトリ', '/p'],
  ['ヘルプ', '/help'],
] as const;

const GUEST_LINKS = [
  ['ログイン', '/auth/login'],
  ['登録', '/auth/register'],
] as const;

const POLICY_LINKS = [
  ['利用規約', '/terms'],
  ['プライバシーポリシー', '/privacy'],
  ['法的通知', '/legal'],
  ['料金', '/pricing'],
  ['お問い合わせ', '/contact'],
] as const;

function PageBody() {
  return (
    <>
      <h1>本文の見出し</h1>
      <button type="button">本文の操作</button>
    </>
  );
}

function renderLayout(slots: SiteLayoutSlots = SITE_LAYOUT_SLOTS) {
  return render(
    <TooltipProvider>
      <SkipLink />
      <SiteLayout slots={slots}>
        <PageBody />
      </SiteLayout>
    </TooltipProvider>,
  );
}

const header = () => page.getByRole('banner');
const footer = () => page.getByRole('contentinfo');
const mainNavigation = () => page.getByRole('navigation', { name: 'メイン' });
const menuButton = () => page.getByRole('button', { name: 'メニュー' });
const menu = () => page.getByRole('dialog', { name: 'メニュー' });
const linkIn = (scope: Locator, name: string) =>
  scope.getByRole('link', { name, exact: true });

function onlyElement(selector: string): Element {
  const elements = document.querySelectorAll(selector);
  const [element] = elements;
  if (elements.length !== 1 || element === undefined) {
    throw new Error(`${selector}に一致する要素がちょうど1つではありません。`);
  }
  return element;
}

function isBefore(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function hasHorizontalScroll(): boolean {
  const root = document.documentElement;
  return root.scrollWidth > root.clientWidth;
}

// 親のoverflowで切り取られた子のはみ出しは文書の横スクロールに現れないため、描画された要素ごとに右端が画面の内側にあるかを見る
function elementsOverflowingViewport(rootSelector: string): readonly string[] {
  return Array.from(
    document.querySelectorAll(`:is(${rootSelector}), :is(${rootSelector}) *`),
  )
    .filter((element) => {
      const { width, right } = element.getBoundingClientRect();
      return width > 0 && right > window.innerWidth;
    })
    .map((element) => element.outerHTML.slice(0, 80));
}

async function openMenuWithKeyboard(): Promise<void> {
  menuButton().element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu()).toBeInTheDocument();
}

function TestBanner() {
  return <div role="status">メールアドレスの確認が完了していません。</div>;
}

function SecondTestBanner() {
  return <p>メンテナンスのお知らせ</p>;
}

function TestSponsorAds() {
  return (
    <aside aria-label="スポンサー">
      <a href="#sponsor">スポンサーの広告</a>
    </aside>
  );
}

function TestHelpArticleLink() {
  return (
    <li>
      <a href="#upvote-rules">Upvoteのルール</a>
    </li>
  );
}

function TestPinnedHelpLinks() {
  return (
    <>
      <li>
        <a href="#how-it-works">Launch Stadiumの仕組み</a>
      </li>
      <li>
        <a href="#week-tournament">Weekトーナメントの参加方法</a>
      </li>
    </>
  );
}

function TestUnloadedHelpLinks() {
  return null;
}

function TestAccountLink() {
  return <a href="#account">マイページ</a>;
}

function TestLaunchLink() {
  return <a href="#launch">プロダクトを登録</a>;
}

const FILLED_SLOTS: SiteLayoutSlots = {
  headerAccount: TestAccountLink,
  headerLaunchAction: TestLaunchLink,
  belowHeader: [TestBanner, SecondTestBanner],
  beforeFooter: [TestSponsorAds],
  footerHelpLinks: [
    TestHelpArticleLink,
    TestUnloadedHelpLinks,
    TestPinnedHelpLinks,
  ],
};

const FILLED_HELP_LINK_NAMES = [
  'ヘルプ',
  'Upvoteのルール',
  'Launch Stadiumの仕組み',
  'Weekトーナメントの参加方法',
];

beforeEach(async () => {
  await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
});

afterEach(() => {
  applyColorScheme('light');
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
});

describe('SiteLayout', () => {
  describe('広い画面のヘッダー', () => {
    test('トップページへのロゴ、ディレクトリとヘルプの名前付きのナビゲーションを表示する', async () => {
      await renderLayout();

      await expect
        .element(linkIn(header(), 'Launch Stadium'))
        .toHaveAttribute('href', '/');
      for (const [name, href] of PRIMARY_LINKS) {
        await expect
          .element(linkIn(mainNavigation(), name))
          .toHaveAttribute('href', href);
      }
    });

    test('初版の区画として、ログインへの「ローンチする」とログイン・登録の導線を表示する', async () => {
      await renderLayout();

      await expect
        .element(linkIn(header(), 'ローンチする'))
        .toHaveAttribute('href', '/auth/login');
      for (const [name, href] of GUEST_LINKS) {
        await expect
          .element(linkIn(header(), name))
          .toHaveAttribute('href', href);
      }
    });

    test('ダークモードの切替ボタンで配色を切り替える', async () => {
      await renderLayout();

      await userEvent.click(
        header().getByRole('button', { name: 'ダークモードに切り替え' }),
      );

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      await expect
        .element(
          header().getByRole('button', { name: 'ライトモードに切り替え' }),
        )
        .toBeVisible();
    });

    test('幅768px以上では、メニューのボタンを表示しない', async () => {
      await page.viewport(MENU_BREAKPOINT_WIDTH, VIEWPORT_HEIGHT);
      await renderLayout();

      await expect.element(mainNavigation()).toBeVisible();
      await expect.element(menuButton()).not.toBeInTheDocument();
    });
  });

  describe('幅768px未満のメニュー', () => {
    beforeEach(async () => {
      await page.viewport(MENU_BREAKPOINT_WIDTH - 1, VIEWPORT_HEIGHT);
    });

    test('ヘッダーにはロゴ・切替ボタン・メニューのボタンだけを表示する', async () => {
      await renderLayout();

      await expect.element(linkIn(header(), 'Launch Stadium')).toBeVisible();
      await expect
        .element(
          header().getByRole('button', { name: 'ダークモードに切り替え' }),
        )
        .toBeVisible();
      await expect.element(menuButton()).toBeVisible();
      await expect.element(mainNavigation()).not.toBeInTheDocument();
      for (const name of ['ローンチする', 'ログイン', '登録']) {
        await expect.element(linkIn(header(), name)).not.toBeInTheDocument();
      }
    });

    test('メニューを開くと、ナビゲーション・「ローンチする」・ログインと登録の導線を表示する', async () => {
      await renderLayout();

      await openMenuWithKeyboard();

      const navigation = menu().getByRole('navigation', { name: 'メイン' });
      for (const [name, href] of PRIMARY_LINKS) {
        await expect
          .element(linkIn(navigation, name))
          .toHaveAttribute('href', href);
      }
      await expect
        .element(linkIn(menu(), 'ローンチする'))
        .toHaveAttribute('href', '/auth/login');
      for (const [name, href] of GUEST_LINKS) {
        await expect
          .element(linkIn(menu(), name))
          .toHaveAttribute('href', href);
      }
    });

    test('開いている間はTabのフォーカスがメニューの中で循環し、Escapeで閉じるとメニューのボタンへ戻る', async () => {
      await renderLayout();
      await openMenuWithKeyboard();

      const dialog = menu().element();
      for (let index = 0; index < 8; index += 1) {
        await userEvent.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);

      await userEvent.keyboard('{Escape}');

      await expect.element(menu()).not.toBeInTheDocument();
      await expect.element(menuButton()).toHaveFocus();
    });

    test('メニューの中のリンクを選ぶとメニューを閉じる', async () => {
      await renderLayout(FILLED_SLOTS);
      await openMenuWithKeyboard();

      await userEvent.click(linkIn(menu(), 'マイページ'));

      await expect.element(menu()).not.toBeInTheDocument();
      expect(window.location.hash).toBe('#account');
    });

    test('メニューの中のリンク以外を押しても、メニューを開いたままにする', async () => {
      await renderLayout();
      await openMenuWithKeyboard();

      await userEvent.click(menu().getByRole('heading', { name: 'メニュー' }));

      await expect.element(menu()).toBeVisible();
    });
  });

  describe('フッター', () => {
    test('ヘルプのナビゲーションにヘルプトップへのリンクを表示する', async () => {
      await renderLayout();

      const navigation = footer().getByRole('navigation', { name: 'ヘルプ' });
      await expect
        .element(linkIn(navigation, 'ヘルプ'))
        .toHaveAttribute('href', '/help');
    });

    test('規約・問い合わせのナビゲーションに利用規約・プライバシーポリシー・法的通知・料金・問い合わせへのリンクを表示する', async () => {
      await renderLayout();

      const navigation = footer().getByRole('navigation', {
        name: '規約・問い合わせ',
      });
      for (const [name, href] of POLICY_LINKS) {
        await expect
          .element(linkIn(navigation, name))
          .toHaveAttribute('href', href);
      }
    });
  });

  describe('ランドマーク', () => {
    test('ヘッダー・本文・フッターをそれぞれ1つ持ち、本文はスキップリンクの移動先のidを持つ', async () => {
      await renderLayout();

      const banner = onlyElement('header');
      const main = onlyElement('main');
      const contentInfo = onlyElement('footer');
      expect(main.id).toBe(MAIN_CONTENT_ID);
      expect(isBefore(banner, main)).toBe(true);
      expect(isBefore(main, contentInfo)).toBe(true);
      await expect
        .element(page.getByRole('main').getByRole('heading', { level: 1 }))
        .toHaveTextContent('本文の見出し');
    });

    test('すべてのナビゲーションに名前を付ける', async () => {
      await renderLayout();

      const names = page
        .getByRole('navigation')
        .elements()
        .map((element) => element.getAttribute('aria-label'));
      expect(names).toStrictEqual(['メイン', 'ヘルプ', '規約・問い合わせ']);
    });

    test.each(COLOR_SCHEMES)(
      '配色が%sのとき、スキップリンクをEnterで選ぶと本文へフォーカスが移り、リングの色の輪郭で示す',
      async (scheme) => {
        applyColorScheme(scheme);
        await renderLayout();

        await userEvent.tab();
        await userEvent.keyboard('{Enter}');

        const main = page.getByRole('main');
        await expect.element(main).toHaveFocus();
        expect(outlineOf(main.element())).toStrictEqual(ringOutline());
        expect(hasHorizontalScroll()).toBe(false);
      },
    );
  });

  describe('区画の差し込み', () => {
    test('登録箇所の型のまま差し込んだ部品を、それぞれの区画に登録の順で描画する', async () => {
      await renderLayout(FILLED_SLOTS);

      const banner = onlyElement('header');
      const main = onlyElement('main');
      const contentInfo = onlyElement('footer');
      const firstBanner = page.getByRole('status').element();
      const secondBanner = page.getByText('メンテナンスのお知らせ').element();
      const sponsorAds = page
        .getByRole('complementary', { name: 'スポンサー' })
        .element();

      expect(isBefore(banner, firstBanner)).toBe(true);
      expect(isBefore(firstBanner, secondBanner)).toBe(true);
      expect(isBefore(secondBanner, main)).toBe(true);
      expect(isBefore(main, sponsorAds)).toBe(true);
      expect(isBefore(sponsorAds, contentInfo)).toBe(true);
    });

    test('ヘッダーの導線とログイン中の表示の区画を差し替えた部品で置き換える', async () => {
      await renderLayout(FILLED_SLOTS);

      await expect
        .element(linkIn(header(), 'マイページ'))
        .toHaveAttribute('href', '#account');
      await expect
        .element(linkIn(header(), 'プロダクトを登録'))
        .toHaveAttribute('href', '#launch');
      for (const name of ['ローンチする', 'ログイン', '登録']) {
        await expect.element(linkIn(header(), name)).not.toBeInTheDocument();
      }
    });

    test('フッターのヘルプのリンクの区画の部品が描くliを、ヘルプトップの後に登録の順で一覧の項目として並べる', async () => {
      await renderLayout(FILLED_SLOTS);

      const navigation = footer().getByRole('navigation', { name: 'ヘルプ' });
      const names = navigation
        .getByRole('link')
        .elements()
        .map((element) => element.textContent);
      expect(names).toStrictEqual(FILLED_HELP_LINK_NAMES);
      expect(
        navigation
          .getByRole('listitem')
          .elements()
          .map((element) => element.textContent),
      ).toStrictEqual(FILLED_HELP_LINK_NAMES);
    });

    test('フッターのヘルプのリンクの区画で、liを入れ子にせず、何も描かない部品の空のliを作らない', async () => {
      await renderLayout(FILLED_SLOTS);

      const list = onlyElement('footer nav[aria-label="ヘルプ"] ul');
      expect(list.querySelectorAll('li li')).toHaveLength(0);
      expect(
        Array.from(list.children, (element) => element.tagName),
      ).toStrictEqual(FILLED_HELP_LINK_NAMES.map(() => 'LI'));
      expect(
        Array.from(list.children).filter(
          (element) => element.textContent === '',
        ),
      ).toHaveLength(0);
      expect(await runAxe(footer().element())).toStrictEqual([]);
    });

    test('初版の登録箇所は、帯・フッターの直前・ヘルプのリンクの区画を空にする', () => {
      expect(SITE_LAYOUT_SLOTS.belowHeader).toStrictEqual([]);
      expect(SITE_LAYOUT_SLOTS.beforeFooter).toStrictEqual([]);
      expect(SITE_LAYOUT_SLOTS.footerHelpLinks).toStrictEqual([]);
      expect(Object.isFrozen(SITE_LAYOUT_SLOTS)).toBe(true);
    });
  });

  describe('幅320px', () => {
    beforeEach(async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    });

    test.each([
      ['初版の区画', SITE_LAYOUT_SLOTS],
      ['差し込んだ区画', FILLED_SLOTS],
    ])('%sで横スクロールが出ない', async (_name, slots) => {
      await renderLayout(slots);

      await expect.element(menuButton()).toBeVisible();
      expect(hasHorizontalScroll()).toBe(false);
      expect(elementsOverflowingViewport('header, footer')).toStrictEqual([]);
    });

    test('メニューを開いても横スクロールが出ず、中の導線が幅に収まる', async () => {
      await renderLayout();
      await openMenuWithKeyboard();

      expect(hasHorizontalScroll()).toBe(false);
      const { right } = menu().element().getBoundingClientRect();
      for (const link of menu().getByRole('link').elements()) {
        expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(right);
      }
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('広い画面で、アクセシビリティの検査の違反が0件', async () => {
      await renderLayout(FILLED_SLOTS);

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('幅320pxで、アクセシビリティの検査の違反が0件', async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      await renderLayout();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('開いたメニューで、アクセシビリティの検査の違反が0件', async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      await renderLayout();
      await openMenuWithKeyboard();

      expect(await runAxe(menu().element())).toStrictEqual([]);
    });
  });
});
