import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../../lib/test/served-media-images.ts';
import {
  createPageRouterContext,
  renderInRouter,
  SERVED_IMAGES_ORIGIN,
} from '../../../test/page-router.tsx';
import {
  type ProductScreenshot,
  ScreenshotGallery,
} from './screenshot-gallery.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const OBJECT_KEY = 'fedcba9876543210'.repeat(2);

const PRODUCT_NAME = 'Pitch Notes';

const DESKTOP = { width: 1280, height: 900 } as const;

const MOBILE = { width: 390, height: 844 } as const;

// 画像配信の経路を持たないテストの配信元へ要求させ、読み込みを失敗させる
const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

// 基本のスタイルのフォーカスの輪郭の外側への広がり(outline-offsetとoutline-widthの和)
const FOCUS_OUTLINE_EXTENT_PX = 4;

let served: ServedMediaImages;

const screenshotsOf = (count: number): readonly ProductScreenshot[] =>
  Array.from({ length: count }, (_, index) => ({
    fileId: `01JD0SCREENSHOT00000000${String(index).padStart(3, '0')}`,
    image: {
      id: `01JD0MEDIA0000000000000${String(index).padStart(3, '0')}`,
      objectKey: OBJECT_KEY,
      fallbackFormat: 'PNG',
      width: index % 2 === 0 ? 1600 : 800,
      height: 1000,
    },
  }));

const renderGallery = (
  screenshots: readonly ProductScreenshot[],
  imagesOrigin: string = SERVED_IMAGES_ORIGIN,
) =>
  renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <div className="mx-auto max-w-3xl">
        <ScreenshotGallery
          productName={PRODUCT_NAME}
          screenshots={screenshots}
        />
      </div>
    </main>,
    {
      context: createPageRouterContext('local', {
        imagesOrigin,
      }),
    },
  );

const list = () =>
  page.getByRole('list', {
    name: 'スクリーンショット一覧(横にスクロールできます)',
  });

const thumbnailButton = (position: number) =>
  page.getByRole('button', {
    name: `スクリーンショット${position.toString()}枚目を拡大`,
    exact: true,
  });

const lightbox = () =>
  page.getByRole('dialog', { name: `${PRODUCT_NAME}のスクリーンショット` });

const scrollerOf = (): HTMLElement => list().element() as HTMLElement;

const listItemOf = (position: number): HTMLElement => {
  const item = scrollerOf().children.item(position - 1);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`${position.toString()}枚目の項目が描画されていません。`);
  }
  return item;
};

const unavailableScreenshotsOf = (
  count: number,
  image: 'quarantined' | 'unset',
): readonly ProductScreenshot[] =>
  screenshotsOf(count).map((screenshot) => ({
    ...screenshot,
    image:
      image === 'unset' || screenshot.image === null
        ? null
        : { ...screenshot.image, objectKey: null },
  }));

beforeAll(async () => {
  served = await serveMediaImages(OBJECT_KEY);
});

afterAll(async () => {
  await served.remove();
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe('ScreenshotGallery', () => {
  test('0枚なら区画ごと描かない', async () => {
    await renderGallery([]);

    await expect.element(page.getByRole('main')).toBeInTheDocument();
    expect(document.querySelector('main > div')?.childElementCount).toBe(0);
    expect(
      page.getByRole('heading', { name: 'スクリーンショット' }).elements(),
    ).toStrictEqual([]);
  });

  test('見出しと枚数、一覧の名前、拡大のボタンと代替テキストを示す', async () => {
    await renderGallery(screenshotsOf(3));

    await expect
      .element(page.getByRole('region', { name: 'スクリーンショット' }))
      .toBeVisible();
    await expect
      .element(
        page.getByRole('heading', { level: 2, name: 'スクリーンショット' }),
      )
      .toBeVisible();
    await expect.element(page.getByText('3枚', { exact: true })).toBeVisible();
    await expect.element(list()).toBeVisible();
    expect(list().getByRole('listitem').elements()).toHaveLength(3);
    for (const position of [1, 2, 3]) {
      const image = listItemOf(position).querySelector('img');
      expect(image?.getAttribute('alt')).toBe(
        `${PRODUCT_NAME}のスクリーンショット${position.toString()}枚目`,
      );
      expect(image?.getAttribute('src')).toContain('/screenshot-thumb.');
      await expect.poll(() => image?.naturalWidth).toBeGreaterThan(0);
    }
  });

  test('サムネイルを高さをそろえて1行に並べ、はみ出す分は一覧の中で横にスクロールする', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    await renderGallery(screenshotsOf(10));
    await expect.element(thumbnailButton(10)).toBeInTheDocument();

    const buttons = Array.from(
      scrollerOf().querySelectorAll<HTMLElement>('button'),
    );
    const heights = new Set(
      buttons.map((button) =>
        Math.round(button.getBoundingClientRect().height),
      ),
    );
    const tops = new Set(
      buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
    );
    expect(buttons).toHaveLength(10);
    expect(heights.size).toBe(1);
    expect(tops.size).toBe(1);
    expect(getComputedStyle(scrollerOf()).overflowX).toBe('auto');
    expect(scrollerOf().scrollWidth).toBeGreaterThan(scrollerOf().clientWidth);
    expect(hasHorizontalScroll()).toBe(false);
  });

  test('640px以上では一覧の左右のスクロールのボタンで端を見ながら送る', async () => {
    await emulateReducedMotion('reduce');
    await renderGallery(screenshotsOf(10));
    const previous = page.getByRole('button', {
      name: '前のスクリーンショットへスクロール',
    });
    const next = page.getByRole('button', {
      name: '次のスクリーンショットへスクロール',
    });

    await expect.element(previous).toBeDisabled();
    await expect.element(next).toBeEnabled();
    await userEvent.click(next);

    await expect.poll(() => scrollerOf().scrollLeft).toBeGreaterThan(0);
    await expect.element(previous).toBeEnabled();
  });

  test('末尾に着いても押したボタンのフォーカスを保ち、離れてから押せない状態にする', async () => {
    await emulateReducedMotion('reduce');
    await renderGallery(screenshotsOf(10));
    const next = page.getByRole('button', {
      name: '次のスクリーンショットへスクロール',
    });
    next.element().focus();

    await expect
      .poll(async () => {
        if (next.element().getAttribute('aria-disabled') !== 'true') {
          await userEvent.keyboard('{Enter}');
        }
        return next.element().getAttribute('aria-disabled');
      })
      .toBe('true');

    await expect.element(next).toHaveFocus();
    await expect.element(next).not.toHaveAttribute('disabled');
    await userEvent.tab({ shift: true });
    await expect.element(next).toBeDisabled();
  });

  test('1枚だけなら一覧のスクロールのボタンを置かない', async () => {
    await renderGallery(screenshotsOf(1));

    await expect.element(thumbnailButton(1)).toBeVisible();
    expect(
      page
        .getByRole('button', { name: /スクリーンショットへスクロール$/ })
        .elements(),
    ).toStrictEqual([]);
  });

  test('サムネイルを押すとその位置の大きな画像をライトボックスで開く', async () => {
    await renderGallery(screenshotsOf(10));

    await userEvent.click(thumbnailButton(3));

    await expect.element(lightbox()).toBeVisible();
    await expect
      .element(lightbox().getByText('3 / 10', { exact: true }))
      .toBeVisible();
    const image = lightbox().getByRole('img', {
      name: `${PRODUCT_NAME}のスクリーンショット3枚目`,
    });
    await expect.element(image).toBeVisible();
    const element = image.element() as HTMLImageElement;
    expect(element.tagName).toBe('IMG');
    expect(element.getAttribute('src')).toContain('/screenshot-full.');
    await expect.poll(() => element.naturalWidth).toBeGreaterThan(0);
  });

  test('ライトボックスで移動してからEscapeで閉じても、開いたサムネイルへフォーカスを戻す', async () => {
    await renderGallery(screenshotsOf(10));
    thumbnailButton(3).element().focus();

    await userEvent.keyboard('{Enter}');
    await expect.element(lightbox()).toBeVisible();
    await userEvent.keyboard('{ArrowRight}');
    await expect
      .element(lightbox().getByText('4 / 10', { exact: true }))
      .toBeVisible();
    await userEvent.keyboard('{Escape}');

    await expect.element(lightbox()).not.toBeInTheDocument();
    await expect.element(thumbnailButton(3)).toHaveFocus();
  });

  test('「閉じる」で閉じても、開いたサムネイルへフォーカスを戻す', async () => {
    await renderGallery(screenshotsOf(4));

    await userEvent.click(thumbnailButton(2));
    await userEvent.click(lightbox().getByRole('button', { name: '閉じる' }));

    await expect.element(lightbox()).not.toBeInTheDocument();
    await expect.element(thumbnailButton(2)).toHaveFocus();
  });

  test('キーボードでサムネイルへ移ると、拡大のボタンにサムネイルを囲むフォーカスの輪郭が一覧に切り取られずに付く', async () => {
    await renderGallery(screenshotsOf(3));
    await expect.element(thumbnailButton(1)).toBeVisible();

    await userEvent.tab();

    await expect.element(thumbnailButton(1)).toHaveFocus();
    const button = thumbnailButton(1).element();
    expect(outlineOf(button)).toStrictEqual(ringOutline());
    const buttonBox = button.getBoundingClientRect();
    const frameBox = listItemOf(1).getBoundingClientRect();
    expect(buttonBox.width).toBe(frameBox.width);
    expect(buttonBox.height).toBe(frameBox.height);
    const scroller = scrollerOf();
    const scrollerBox = scroller.getBoundingClientRect();
    const clipLeft = scrollerBox.left + scroller.clientLeft;
    const clipTop = scrollerBox.top + scroller.clientTop;
    expect(buttonBox.left - FOCUS_OUTLINE_EXTENT_PX).toBeGreaterThanOrEqual(
      clipLeft,
    );
    expect(buttonBox.top - FOCUS_OUTLINE_EXTENT_PX).toBeGreaterThanOrEqual(
      clipTop,
    );
    expect(buttonBox.bottom + FOCUS_OUTLINE_EXTENT_PX).toBeLessThanOrEqual(
      clipTop + scroller.clientHeight,
    );
  });

  describe.each([
    [
      '隔離中の画像(objectKeyがnull)',
      () => unavailableScreenshotsOf(3, 'quarantined'),
      SERVED_IMAGES_ORIGIN,
    ],
    [
      '未設定の画像(imageがnull)',
      () => unavailableScreenshotsOf(3, 'unset'),
      SERVED_IMAGES_ORIGIN,
    ],
    ['読み込みに失敗した画像', () => screenshotsOf(3), MISSING_IMAGES_ORIGIN],
  ] as const)('%sのサムネイル', (_case, screenshotsFor, imagesOrigin) => {
    const unavailableImage = () =>
      page.getByRole('img', {
        name: `${PRODUCT_NAME}のスクリーンショット1枚目(画像を表示できません)`,
        exact: true,
      });

    test('ボタンの名前は拡大の操作のまま、代わりの表示を代替テキスト付きの画像として読ませる', async () => {
      await renderGallery(screenshotsFor(), imagesOrigin);

      await expect.element(unavailableImage()).toBeVisible();
      await expect.element(thumbnailButton(1)).toBeVisible();
      expect(listItemOf(1).querySelector('img')).toBeNull();
      expect(thumbnailButton(1).element().textContent).toBe('');
    });

    test.each(COLOR_SCHEMES)(
      '%sの配色でaxeの違反が0件である',
      async (scheme) => {
        applyColorScheme(scheme);
        await renderGallery(screenshotsFor(), imagesOrigin);
        await expect.element(unavailableImage()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で一覧とライトボックスのaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderGallery(screenshotsOf(10));
      await expect.element(thumbnailButton(1)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(thumbnailButton(1));
      await expect.element(lightbox()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
