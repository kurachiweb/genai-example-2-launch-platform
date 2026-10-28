import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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
  ADMIN_LAYOUT_SLOTS,
  type AdminLayoutSlots,
} from '../../composition/layout-slots.ts';
import { AdminLayout } from './admin-layout.tsx';

const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;
const NARROWEST_VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 800;

const LAYOUT_ROOT_TEST_ID = 'admin-layout-root';

function PageBody() {
  return (
    <>
      <h1>本文の見出し</h1>
      <button type="button">本文の操作</button>
    </>
  );
}

function renderLayout(slots: AdminLayoutSlots = ADMIN_LAYOUT_SLOTS) {
  return render(
    <TooltipProvider>
      <SkipLink />
      <div data-testid={LAYOUT_ROOT_TEST_ID}>
        <AdminLayout slots={slots}>
          <PageBody />
        </AdminLayout>
      </div>
    </TooltipProvider>,
  );
}

const header = () => page.getByRole('banner');
const layoutRoot = () => page.getByTestId(LAYOUT_ROOT_TEST_ID).element();

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

// 文字も画像も操作も持たない要素は、区画が空のときに残った入れ物(空のnav・ul・余白だけのdivなど)とみなす
function emptyElementsIn(root: Element): readonly string[] {
  return Array.from(root.querySelectorAll('*'))
    .filter((element) => element.closest('svg') === null)
    .filter(
      (element) =>
        element.textContent.trim() === '' &&
        element.querySelector('svg, img, a, button, input') === null,
    )
    .map((element) => element.outerHTML.slice(0, 80));
}

const TEST_NAVIGATION_LINK_CLASS_NAME = 'block px-3 py-2';

function TestNavigation() {
  return (
    <nav aria-label="管理メニュー" className="md:w-56">
      <ul>
        <li>
          <a href="#users" className={TEST_NAVIGATION_LINK_CLASS_NAME}>
            ユーザー
          </a>
        </li>
        <li>
          <a href="#audit-logs" className={TEST_NAVIGATION_LINK_CLASS_NAME}>
            監査ログ
          </a>
        </li>
      </ul>
    </nav>
  );
}

function TestAccountLink() {
  return <a href="#account">自分のアカウント</a>;
}

const FILLED_SLOTS: AdminLayoutSlots = {
  navigation: TestNavigation,
  headerAccount: TestAccountLink,
};

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

describe('AdminLayout', () => {
  describe('ヘッダー', () => {
    test('サービス名と管理画面であることを示す「Launch Stadium管理」を、トップページへのリンクとして表示する', async () => {
      await renderLayout();

      await expect
        .element(
          header().getByRole('link', {
            name: 'Launch Stadium管理',
            exact: true,
          }),
        )
        .toHaveAttribute('href', '/');
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
  });

  describe('ランドマーク', () => {
    test('ヘッダーと本文をそれぞれ1つ持ち、本文はスキップリンクの移動先のidを持つ', async () => {
      await renderLayout();

      const banner = onlyElement('header');
      const main = onlyElement('main');
      expect(main.id).toBe(MAIN_CONTENT_ID);
      expect(isBefore(banner, main)).toBe(true);
      await expect
        .element(page.getByRole('main').getByRole('heading', { level: 1 }))
        .toHaveTextContent('本文の見出し');
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

  describe('区画', () => {
    test('初版の登録箇所は、メニューとログイン中の表示の区画を空にする', () => {
      expect(ADMIN_LAYOUT_SLOTS).toStrictEqual({
        navigation: null,
        headerAccount: null,
      });
      expect(Object.isFrozen(ADMIN_LAYOUT_SLOTS)).toBe(true);
    });

    test('区画が空のとき、ナビゲーションも中身の無い入れ物も描画しない', async () => {
      await renderLayout();

      await expect.element(page.getByRole('main')).toBeInTheDocument();
      expect(page.getByRole('navigation').elements()).toHaveLength(0);
      expect(emptyElementsIn(layoutRoot())).toStrictEqual([]);
    });

    test('メニューの区画へ差し込んだ部品を、ヘッダーと本文の間に描画する', async () => {
      await renderLayout(FILLED_SLOTS);

      const navigation = page.getByRole('navigation', { name: '管理メニュー' });
      await expect
        .element(navigation.getByRole('link', { name: 'ユーザー' }))
        .toHaveAttribute('href', '#users');
      const banner = onlyElement('header');
      const main = onlyElement('main');
      expect(isBefore(banner, navigation.element())).toBe(true);
      expect(isBefore(navigation.element(), main)).toBe(true);
      expect(banner.contains(navigation.element())).toBe(false);
      expect(main.contains(navigation.element())).toBe(false);
    });

    test('ログイン中の表示の区画へ差し込んだ部品を、ヘッダーの中に描画する', async () => {
      await renderLayout(FILLED_SLOTS);

      await expect
        .element(header().getByRole('link', { name: '自分のアカウント' }))
        .toHaveAttribute('href', '#account');
    });

    test('区画を埋めたときも、中身の無い入れ物を描画しない', async () => {
      await renderLayout(FILLED_SLOTS);

      await expect.element(page.getByRole('main')).toBeInTheDocument();
      expect(emptyElementsIn(layoutRoot())).toStrictEqual([]);
    });
  });

  describe('幅320px', () => {
    beforeEach(async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    });

    test.each([
      ['初版の区画', ADMIN_LAYOUT_SLOTS],
      ['差し込んだ区画', FILLED_SLOTS],
    ])('%sで横スクロールが出ない', async (_name, slots) => {
      await renderLayout(slots);

      await expect.element(page.getByRole('main')).toBeVisible();
      expect(hasHorizontalScroll()).toBe(false);
      for (const element of header().element().querySelectorAll('*')) {
        expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(
          window.innerWidth,
        );
      }
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([
      ['初版の区画', ADMIN_LAYOUT_SLOTS],
      ['差し込んだ区画', FILLED_SLOTS],
    ])(
      '広い画面の%sで、アクセシビリティの検査の違反が0件',
      async (_name, slots) => {
        await renderLayout(slots);

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );

    test.each([
      ['初版の区画', ADMIN_LAYOUT_SLOTS],
      ['差し込んだ区画', FILLED_SLOTS],
    ])(
      '幅320pxの%sで、アクセシビリティの検査の違反が0件',
      async (_name, slots) => {
        await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
        await renderLayout(slots);

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
