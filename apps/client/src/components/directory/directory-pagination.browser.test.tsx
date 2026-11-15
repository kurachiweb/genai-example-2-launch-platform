import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { directoryHref } from './directory-href.ts';
import { DirectoryPagination } from './directory-pagination.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const DESKTOP = { width: 1024, height: 800 } as const;
const MOBILE = { width: 375, height: 800 } as const;

// ページ以外の条件を保ったリンクになることを確かめるための条件
const CONDITIONS: DirectoryQuery = {
  category: 'developer-tools',
  sort: 'upvotes',
};
const CONDITIONS_PATH = '/p?category=developer-tools&sort=upvotes';

const renderPagination = (
  current: number,
  pageCount: number,
  onNavigate?: (page: number) => void,
) => {
  const query: DirectoryQuery = {
    ...CONDITIONS,
    page: current > 1 ? current : undefined,
  };
  return renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <DirectoryPagination
          query={query}
          pageCount={pageCount}
          onNavigate={onNavigate}
        />
      </main>
    </DisplayPreferencesProvider>,
    { path: directoryHref(query) },
  );
};

const NAVIGATION_NAME = 'プロダクト一覧のページ送り';
const navigation = () =>
  page.getByRole('navigation', { name: NAVIGATION_NAME });
const previousLink = () =>
  page.getByRole('link', { name: '前へ', exact: true });
const nextLink = () => page.getByRole('link', { name: '次へ', exact: true });
const previousButton = () =>
  page.getByRole('button', { name: '前へ', exact: true });
const nextButton = () =>
  page.getByRole('button', { name: '次へ', exact: true });
const pageLink = (number: string) =>
  page.getByRole('link', {
    name: `${number}ページ目`,
    exact: true,
    includeHidden: true,
  });

const navigationElement = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>(
    `nav[aria-label="${NAVIGATION_NAME}"]`,
  );
  if (element === null) {
    throw new Error('ページ送りが描かれていません。');
  }
  return element;
};

// 番号の並びを、見えている文言で「1 … 4 5 6 … 62」の形にする
const visibleNumberRow = (): string =>
  Array.from(navigationElement().querySelectorAll('li'), (item) =>
    item.textContent.trim(),
  ).join(' ');

const pageCounter = (): HTMLElement => {
  const element = navigationElement().querySelector<HTMLElement>(
    '[data-page-counter]',
  );
  if (element === null) {
    throw new Error('現在のページと全ページ数の欄が描かれていません。');
  }
  return element;
};

// 支援技術に読ませない部分と、画面に見せない部分をそれぞれ除いた文言
const textWithout = (element: HTMLElement, selector: string): string => {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(selector).forEach((child) => {
    child.remove();
  });
  return clone.textContent;
};

afterEach(() => {
  applyColorScheme('light');
});

describe('DirectoryPagination', () => {
  describe('画面幅が768px以上のとき', () => {
    test('「前へ」「次へ」の間に、先頭・末尾・現在のページの前後1つを並べ、空く間を「…」で省く', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(5, 62);

      await expect.element(navigation()).toBeVisible();
      await expect.element(previousLink()).toBeVisible();
      await expect.element(nextLink()).toBeVisible();
      expect(visibleNumberRow()).toBe('1 … 4 5 6 … 62');
      for (const number of ['1', '4', '5', '6', '62']) {
        await expect.element(pageLink(number)).toBeVisible();
      }
      expect(pageCounter()).not.toBeVisible();
    });

    test('1ページ分だけ空くときは省かずにその番号を出す', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(4, 62);

      expect(visibleNumberRow()).toBe('1 2 3 4 5 … 62');
    });

    test('末尾の側も1ページ分だけ空くときは省かない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(59, 62);

      expect(visibleNumberRow()).toBe('1 … 58 59 60 61 62');
    });

    test('省略の印「…」は支援技術に読ませない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(5, 62);

      const gaps = Array.from(
        navigationElement().querySelectorAll('li'),
      ).filter((item) => item.textContent.trim() === '…');
      expect(gaps).toHaveLength(2);
      for (const gap of gaps) {
        expect(gap.getAttribute('aria-hidden')).toBe('true');
      }
    });

    test('現在のページの番号のリンクだけに現在のページの印を付ける', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(5, 62);

      await expect
        .element(pageLink('5'))
        .toHaveAttribute('aria-current', 'page');
      expect(
        navigationElement().querySelectorAll('[aria-current]'),
      ).toHaveLength(1);
    });

    test('1ページ目の表示中も、1ページ目の番号のリンクだけに現在のページの印を付ける', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(1, 62);

      await expect
        .element(pageLink('1'))
        .toHaveAttribute('aria-current', 'page');
      expect(
        navigationElement().querySelectorAll('[aria-current]'),
      ).toHaveLength(1);
    });

    test('ページの番号は表示設定で3桁区切りにする', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(1000, 1234);

      expect(visibleNumberRow()).toBe('1 … 999 1,000 1,001 … 1,234');
      await expect
        .element(pageLink('1,000'))
        .toHaveAttribute('aria-current', 'page');
    });

    test('番号のリンクは他の条件を保ってページだけを変えたURLを指し、1ページ目は`page`を付けない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      await renderPagination(5, 62);

      await expect
        .element(pageLink('1'))
        .toHaveAttribute('href', CONDITIONS_PATH);
      await expect
        .element(pageLink('4'))
        .toHaveAttribute('href', `${CONDITIONS_PATH}&page=4`);
      await expect
        .element(pageLink('5'))
        .toHaveAttribute('href', `${CONDITIONS_PATH}&page=5`);
      await expect
        .element(pageLink('62'))
        .toHaveAttribute('href', `${CONDITIONS_PATH}&page=62`);
    });

    test('番号のリンクを押すと、そのページへルーターで遷移し、移る先のページを呼び出し元へ知らせる', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      const onNavigate = vi.fn();
      const router = await renderPagination(5, 62, onNavigate);

      await userEvent.click(pageLink('62'));

      await vi.waitFor(() => {
        expect(router.state.location.href).toBe(`${CONDITIONS_PATH}&page=62`);
      });
      expect(onNavigate.mock.calls).toStrictEqual([[62]]);
    });

    test('現在のページの番号を押しても移動を知らせない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      const onNavigate = vi.fn();
      await renderPagination(5, 62, onNavigate);

      await userEvent.click(pageLink('5'));

      expect(onNavigate).not.toHaveBeenCalled();
    });

    test('修飾キー付きの押下(新しいタブで開くなど)はページの移動として知らせない', async () => {
      await page.viewport(DESKTOP.width, DESKTOP.height);
      const onNavigate = vi.fn();
      await renderPagination(5, 62, onNavigate);
      // ブラウザ自身の新しいタブを開く動作は止め、部品の扱いだけを確かめる
      const preventActivation = (event: MouseEvent) => {
        event.preventDefault();
      };
      document.addEventListener('click', preventActivation);

      try {
        pageLink('62')
          .element()
          .dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
            }),
          );
      } finally {
        document.removeEventListener('click', preventActivation);
      }

      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  describe('画面幅が768px未満のとき', () => {
    test('「前へ」「5 / 62」「次へ」とし、番号の並びを出さない', async () => {
      await page.viewport(MOBILE.width, MOBILE.height);
      await renderPagination(5, 62);

      await expect.element(previousLink()).toBeVisible();
      await expect.element(nextLink()).toBeVisible();
      expect(pageCounter()).toBeVisible();
      expect(textWithout(pageCounter(), '.sr-only')).toBe('5 / 62');
      await expect.element(pageLink('5')).not.toBeVisible();
      await expect.element(pageLink('62')).not.toBeVisible();
    });

    test('「5 / 62」は支援技術に「現在のページ」「全」「ページ」を補って読ませる', async () => {
      await page.viewport(MOBILE.width, MOBILE.height);
      await renderPagination(5, 62);

      expect(textWithout(pageCounter(), '[aria-hidden="true"]')).toBe(
        '現在のページ5全62ページ',
      );
    });
  });

  describe('前後のページへの移動', () => {
    test('「前へ」「次へ」は他の条件を保って前後のページを指し、2ページ目からの「前へ」は`page`を付けない', async () => {
      await renderPagination(2, 62);

      await expect
        .element(previousLink())
        .toHaveAttribute('href', CONDITIONS_PATH);
      await expect
        .element(nextLink())
        .toHaveAttribute('href', `${CONDITIONS_PATH}&page=3`);
    });

    test('「次へ」を押すと次のページへルーターで遷移し、移る先のページを呼び出し元へ知らせる', async () => {
      const onNavigate = vi.fn();
      const router = await renderPagination(5, 62, onNavigate);

      await userEvent.click(nextLink());

      await vi.waitFor(() => {
        expect(router.state.location.href).toBe(`${CONDITIONS_PATH}&page=6`);
      });
      expect(onNavigate.mock.calls).toStrictEqual([[6]]);
    });

    test('「前へ」を押すと前のページへルーターで遷移し、移る先のページを呼び出し元へ知らせる', async () => {
      const onNavigate = vi.fn();
      const router = await renderPagination(2, 62, onNavigate);

      await userEvent.click(previousLink());

      await vi.waitFor(() => {
        expect(router.state.location.href).toBe(CONDITIONS_PATH);
      });
      expect(onNavigate.mock.calls).toStrictEqual([[1]]);
    });

    test.each([
      ['768px以上', DESKTOP],
      ['768px未満', MOBILE],
    ] as const)(
      '画面幅が%sのとき、先頭のページでは「前へ」をリンクにせず押せないボタンにする',
      async (_label, viewport) => {
        await page.viewport(viewport.width, viewport.height);
        await renderPagination(1, 62);

        await expect.element(previousButton()).toBeDisabled();
        expect(previousLink().elements()).toHaveLength(0);
        await expect.element(nextLink()).toBeVisible();
      },
    );

    test.each([
      ['768px以上', DESKTOP],
      ['768px未満', MOBILE],
    ] as const)(
      '画面幅が%sのとき、末尾のページでは「次へ」をリンクにせず押せないボタンにする',
      async (_label, viewport) => {
        await page.viewport(viewport.width, viewport.height);
        await renderPagination(62, 62);

        await expect.element(nextButton()).toBeDisabled();
        expect(nextLink().elements()).toHaveLength(0);
        await expect.element(previousLink()).toBeVisible();
      },
    );
  });

  test('1ページに収まるときはページ送りを描かない', async () => {
    await renderPagination(1, 1);

    expect(
      document.querySelector(`nav[aria-label="${NAVIGATION_NAME}"]`),
    ).toBeNull();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['768px以上', DESKTOP, 5],
      ['768px以上の先頭のページ', DESKTOP, 1],
      ['768px未満', MOBILE, 5],
      ['768px未満の末尾のページ', MOBILE, 62],
    ] as const)(
      '画面幅が%sのページ送りのアクセシビリティの検査の違反が0件',
      async (_label, viewport, current) => {
        applyColorScheme(scheme);
        await page.viewport(viewport.width, viewport.height);
        await renderPagination(current, 62);

        await expect.element(navigation()).toBeVisible();
        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
