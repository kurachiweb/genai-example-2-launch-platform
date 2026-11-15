import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import type { ProductScreenshot } from './screenshot-gallery.tsx';
import { ScreenshotLightbox } from './screenshot-lightbox.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PRODUCT_NAME = 'Pitch Notes';

// 画像配信の経路を持たないテストの配信元へ要求させ、読み込みを失敗させる
const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

const SWIPE_START_X = 400;

const screenshotsOf = (count: number): readonly ProductScreenshot[] =>
  Array.from({ length: count }, (_, index) => ({
    fileId: `01JD0SCREENSHOT00000000${String(index).padStart(3, '0')}`,
    image: {
      id: `01JD0MEDIA0000000000000${String(index).padStart(3, '0')}`,
      objectKey: `${String(index).padStart(2, '0')}${'0123456789abcdef'.repeat(2).slice(2)}`,
      fallbackFormat: 'PNG',
      width: 1600,
      height: 1000,
    },
  }));

function ControlledLightbox({
  screenshots,
  initialIndex,
}: {
  readonly screenshots: readonly ProductScreenshot[];
  readonly initialIndex: number;
}) {
  const [index, setIndex] = useState<number | null>(initialIndex);
  return (
    <ScreenshotLightbox
      productName={PRODUCT_NAME}
      screenshots={screenshots}
      index={index}
      onIndexChange={setIndex}
    />
  );
}

const renderLightbox = (count: number, initialIndex = 0) =>
  renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <ControlledLightbox
        screenshots={screenshotsOf(count)}
        initialIndex={initialIndex}
      />
    </main>,
    {
      context: createPageRouterContext('local', {
        imagesOrigin: MISSING_IMAGES_ORIGIN,
      }),
    },
  );

const lightbox = () =>
  page.getByRole('dialog', { name: `${PRODUCT_NAME}のスクリーンショット` });

const position = (text: string) => lightbox().getByText(text, { exact: true });

const previousButton = () =>
  lightbox().getByRole('button', { name: '前のスクリーンショット' });

const nextButton = () =>
  lightbox().getByRole('button', { name: '次のスクリーンショット' });

const stageOf = (): HTMLElement => {
  const stage = document.querySelector<HTMLElement>(
    '[data-slot="screenshot-lightbox-stage"]',
  );
  if (stage === null) {
    throw new Error('ライトボックスの画像の領域が描画されていません。');
  }
  return stage;
};

// タッチの指の動きと同じく、押した位置から横へ動かして離すポインターの事象を送る
const swipe = (deltaX: number): void => {
  const stage = stageOf();
  const common = { bubbles: true, pointerId: 1, pointerType: 'touch' };
  stage.dispatchEvent(
    new PointerEvent('pointerdown', { ...common, clientX: SWIPE_START_X }),
  );
  stage.dispatchEvent(
    new PointerEvent('pointerup', {
      ...common,
      clientX: SWIPE_START_X + deltaX,
    }),
  );
};

afterEach(() => {
  applyColorScheme('light');
});

describe('ScreenshotLightbox', () => {
  test('題名と「3 / 10」の位置を示し、位置の変化を支援技術へ伝える', async () => {
    await renderLightbox(10, 2);

    await expect.element(lightbox()).toBeVisible();
    await expect.element(position('3 / 10')).toBeVisible();
    expect(position('3 / 10').element().getAttribute('aria-live')).toBe(
      'polite',
    );
    await expect
      .element(
        lightbox().getByRole('img', {
          name: `${PRODUCT_NAME}のスクリーンショット3枚目(画像を表示できません)`,
        }),
      )
      .toBeVisible();
  });

  test('前後のボタンで移動し、両端では反対の端へ回る', async () => {
    await renderLightbox(10, 0);

    await userEvent.click(nextButton());
    await expect.element(position('2 / 10')).toBeVisible();
    await userEvent.click(previousButton());
    await expect.element(position('1 / 10')).toBeVisible();
    await userEvent.click(previousButton());
    await expect.element(position('10 / 10')).toBeVisible();
    await userEvent.click(nextButton());
    await expect.element(position('1 / 10')).toBeVisible();
  });

  test('左右キーで移動する', async () => {
    await renderLightbox(10, 4);
    await expect.element(position('5 / 10')).toBeVisible();

    await userEvent.keyboard('{ArrowRight}');
    await expect.element(position('6 / 10')).toBeVisible();
    await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(position('4 / 10')).toBeVisible();
  });

  test('左へのスワイプで次へ、右へのスワイプで前へ移り、わずかな動きでは移らない', async () => {
    await renderLightbox(10, 4);
    await expect.element(position('5 / 10')).toBeVisible();

    swipe(-120);
    await expect.element(position('6 / 10')).toBeVisible();
    swipe(120);
    await expect.element(position('5 / 10')).toBeVisible();
    swipe(120);
    await expect.element(position('4 / 10')).toBeVisible();
    swipe(-20);
    swipe(20);
    await expect.element(position('4 / 10')).toBeVisible();
  });

  test('1枚だけなら前後のボタンを置かず、キーとスワイプでも移らない', async () => {
    await renderLightbox(1, 0);
    await expect.element(position('1 / 1')).toBeVisible();

    expect(previousButton().elements()).toStrictEqual([]);
    expect(nextButton().elements()).toStrictEqual([]);
    await userEvent.keyboard('{ArrowRight}');
    swipe(-120);
    await expect.element(position('1 / 1')).toBeVisible();
  });

  test('「閉じる」で閉じる', async () => {
    await renderLightbox(3, 0);

    await userEvent.click(lightbox().getByRole('button', { name: '閉じる' }));
    await expect.element(lightbox()).not.toBeInTheDocument();
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);
    await renderLightbox(10, 2);
    await expect.element(position('3 / 10')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
