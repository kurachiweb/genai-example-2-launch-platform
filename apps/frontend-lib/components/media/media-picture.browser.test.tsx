import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import type { AppRuntime, RouterContext } from '../../start/router-context.ts';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../test/served-media-images.ts';
import type { MediaImageView } from '../../utilities/media/picture-sources.ts';
import { placeholderAppearanceOf } from '../../utilities/media/placeholder-appearance.ts';
import { MediaPicture, type MediaPictureProps } from './media-picture.tsx';

const IMAGES_ORIGIN = 'https://images.example';

// 画像配信の経路を持たないテストの配信元へ要求させ、読み込みを失敗させる
const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

const KEY = '0123456789abcdef'.repeat(2);

const PLACEHOLDER = { label: 'pitch notes', seed: 'product-1' } as const;

function runtimeContextOf(
  imagesOrigin: string,
): Pick<RouterContext, 'runtime'> {
  const runtime: AppRuntime = {
    publicConfig: {
      environment: 'staging',
      turnstileSiteKey: '1x00000000000000000000BB',
      clientSiteOrigin: 'https://client.example',
      imagesOrigin,
      sentry: { dsn: undefined, environment: 'staging', tracesSampleRate: 0.1 },
      webAnalyticsToken: undefined,
    },
    display: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
  };
  return { runtime: { get: () => runtime, set: () => undefined } };
}

function withImagesOrigin(imagesOrigin: string, ui: ReactElement) {
  const router = createRouter({
    routeTree: createRootRouteWithContext<object>()(),
    history: createMemoryHistory(),
    context: runtimeContextOf(imagesOrigin),
  });
  return <RouterContextProvider router={router}>{ui}</RouterContextProvider>;
}

const imageOf = (
  fallbackFormat: MediaImageView['fallbackFormat'],
  width: number | null = null,
  height: number | null = null,
  objectKey: string | null = KEY,
): MediaImageView => ({ objectKey, fallbackFormat, width, height });

const urlOf = (variant: string, extension: string): string =>
  `${IMAGES_ORIGIN}/${KEY}/${variant}.${extension}`;

function pictureOf(props: Partial<MediaPictureProps> = {}): ReactElement {
  return (
    <MediaPicture
      image={imageOf('JPG', 1000, 800)}
      display={{ kind: 'square', size: 32 }}
      alt="Pitch Notesのロゴ"
      placeholder={PLACEHOLDER}
      {...props}
    />
  );
}

// サーバー側の描画の結果を、画像を読み込まない文書で調べる
function serverMarkupOf(ui: ReactElement): HTMLElement {
  return new DOMParser().parseFromString(
    renderToString(withImagesOrigin(IMAGES_ORIGIN, ui)),
    'text/html',
  ).body;
}

function requiredElement(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (element === null) {
    throw new Error(`${selector}が描画されていません。`);
  }
  return element;
}

const sourcesOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll('picture > source'), (source) => ({
    type: source.getAttribute('type'),
    srcSet: source.getAttribute('srcset'),
  }));

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;

const hydratedRoots: Root[] = [];

// vitest-browser-reactのrenderは自分のactの後にactの環境の指定を戻すため、Reactのactを直接呼ぶたびに指定し直す
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

function insertServerMarkup(ui: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement('div'));
  container.replaceChildren(
    ...new DOMParser().parseFromString(renderToString(ui), 'text/html').body
      .childNodes,
  );
  return container;
}

async function hydrate(
  container: HTMLElement,
  ui: ReactElement,
): Promise<void> {
  await actInTestEnvironment(async () => {
    hydratedRoots.push(hydrateRoot(container, ui));
    await Promise.resolve();
  });
}

const isLoadedImage = (element: Element | null): boolean =>
  element instanceof HTMLImageElement &&
  element.complete &&
  element.naturalWidth > 0;

// 読み込み後の判定(画像の展開の確認など)が終わるまで、描画の更新を待つ
async function settleAfterLoad(): Promise<void> {
  await actInTestEnvironment(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  });
}

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  document.body.replaceChildren();
  applyColorScheme('light');
});

describe('MediaPicture', () => {
  describe('画像の候補', () => {
    test('正方形は、AVIF・WebPの順の候補と、1x・2xのJPEGのフォールバックを表示サイズの幅・高さで描く', () => {
      const body = serverMarkupOf(pictureOf());
      const img = requiredElement(body, 'picture > img');

      expect(sourcesOf(body)).toStrictEqual([
        {
          type: 'image/avif',
          srcSet: `${urlOf('square-xs', 'avif')} 1x, ${urlOf('square-sm', 'avif')} 2x`,
        },
        {
          type: 'image/webp',
          srcSet: `${urlOf('square-xs', 'webp')} 1x, ${urlOf('square-sm', 'webp')} 2x`,
        },
      ]);
      expect(img.getAttribute('src')).toBe(urlOf('square-xs', 'jpg'));
      expect(img.getAttribute('srcset')).toBe(
        `${urlOf('square-xs', 'jpg')} 1x, ${urlOf('square-sm', 'jpg')} 2x`,
      );
      expect(img.getAttribute('width')).toBe('32');
      expect(img.getAttribute('height')).toBe('32');
      expect(img.getAttribute('alt')).toBe('Pitch Notesのロゴ');
    });

    test('スクリーンショットの一覧は、原本の縦横比から求めた1xの寸法と、PNGのフォールバックで描く', () => {
      const body = serverMarkupOf(
        pictureOf({
          image: imageOf('PNG', 1000, 2000),
          display: { kind: 'screenshot', variant: 'thumb' },
        }),
      );
      const img = requiredElement(body, 'picture > img');

      expect(sourcesOf(body).map(({ type }) => type)).toStrictEqual([
        'image/avif',
        'image/webp',
      ]);
      expect(img.getAttribute('src')).toBe(urlOf('screenshot-thumb', 'png'));
      expect(img.getAttribute('srcset')).toBe(
        `${urlOf('screenshot-thumb', 'png')} 1x, ${urlOf('screenshot-thumb-2x', 'png')} 2x`,
      );
      expect(img.getAttribute('width')).toBe('240');
      expect(img.getAttribute('height')).toBe('480');
    });

    test('AVIFを提供しないバリアントは、WebPの候補だけにする', () => {
      const body = serverMarkupOf(
        pictureOf({
          image: imageOf('JPG', 3840, 2160),
          display: { kind: 'screenshot', variant: 'full' },
        }),
      );
      const img = requiredElement(body, 'picture > img');

      expect(sourcesOf(body)).toStrictEqual([
        { type: 'image/webp', srcSet: urlOf('screenshot-full', 'webp') },
      ]);
      expect(img.getAttribute('src')).toBe(urlOf('screenshot-full', 'jpg'));
      expect(img.hasAttribute('srcset')).toBe(false);
      expect(img.getAttribute('width')).toBe('1920');
      expect(img.getAttribute('height')).toBe('1080');
    });

    test('SVGは<picture>・<object>・<iframe>を使わず、<img>だけで描く', () => {
      const body = serverMarkupOf(
        pictureOf({
          image: imageOf('SVG'),
          display: { kind: 'square', size: 128 },
        }),
      );
      const img = requiredElement(body, 'img');

      expect(body.querySelector('picture, source, object, iframe, svg')).toBe(
        null,
      );
      expect(img.getAttribute('src')).toBe(urlOf('square-md', 'svg'));
      expect(img.hasAttribute('srcset')).toBe(false);
      expect(img.getAttribute('width')).toBe('128');
      expect(img.getAttribute('height')).toBe('128');
    });

    test('画像配信のオリジンをルーターの文脈の公開の設定から読む', () => {
      const html = renderToString(
        withImagesOrigin('https://cdn.images.example', pictureOf()),
      );

      expect(html).toContain(
        `src="https://cdn.images.example/${KEY}/square-xs.jpg"`,
      );
    });

    test('呼び出し元が画面外と指定すると遅延読み込みにし、指定が無ければ読み込みの方法を指定しない', () => {
      const lazy = requiredElement(
        serverMarkupOf(pictureOf({ loading: 'lazy' })),
        'img',
      );
      const eager = requiredElement(serverMarkupOf(pictureOf()), 'img');

      expect(lazy.getAttribute('loading')).toBe('lazy');
      expect(eager.hasAttribute('loading')).toBe(false);
    });

    test('呼び出し元のクラス名を<img>に付ける', () => {
      const img = requiredElement(
        serverMarkupOf(pictureOf({ className: 'rounded-full' })),
        'img',
      );

      expect(img.classList.contains('rounded-full')).toBe(true);
    });
  });

  describe('プレースホルダー', () => {
    test.each<[string, MediaImageView | null]>([
      ['未設定', null],
      ['隔離中', imageOf('JPG', 1000, 800, null)],
    ])(
      '%sの画像は、名前の先頭1文字の正方形を表示サイズで描く',
      async (_name, image) => {
        const { container } = await render(
          withImagesOrigin(
            IMAGES_ORIGIN,
            pictureOf({ image, display: { kind: 'square', size: 64 } }),
          ),
        );
        const placeholder = page.getByRole('img', {
          name: 'Pitch Notesのロゴ',
          exact: true,
        });
        const appearance = placeholderAppearanceOf(PLACEHOLDER);
        const element = placeholder.element() as HTMLElement;

        await expect.element(placeholder).toHaveTextContent('P');
        expect(container.querySelector('img')).toBeNull();
        expect(element.getBoundingClientRect().width).toBe(64);
        expect(element.getBoundingClientRect().height).toBe(64);
        expect(element.style.backgroundColor).toBe(appearance.background);
        expect(element.style.color).toBe(appearance.foreground);
        expect(getComputedStyle(element).backgroundColor).not.toBe(
          'rgba(0, 0, 0, 0)',
        );
      },
    );

    test('スクリーンショットは、薄灰色の背景に「画像を表示できません」を原本の縦横比の寸法で描く', async () => {
      await render(
        withImagesOrigin(
          IMAGES_ORIGIN,
          pictureOf({
            image: imageOf('PNG', 360, 240, null),
            display: { kind: 'screenshot', variant: 'thumb' },
            alt: 'Pitch Notesのスクリーンショット',
          }),
        ),
      );
      const placeholder = page.getByRole('img', {
        name: 'Pitch Notesのスクリーンショット(画像を表示できません)',
        exact: true,
      });

      await expect
        .element(placeholder)
        .toHaveTextContent('画像を表示できません');
      const element = placeholder.element() as HTMLElement;
      expect(element.getBoundingClientRect().width).toBe(360);
      expect(element.getBoundingClientRect().height).toBe(240);
      expect(element.classList.contains('bg-muted')).toBe(true);
    });

    test('呼び出し元のクラス名で、プレースホルダーも画像と同じ大きさに変えられる', async () => {
      await render(
        withImagesOrigin(
          IMAGES_ORIGIN,
          <div className="w-60">
            {pictureOf({
              image: null,
              display: { kind: 'screenshot', variant: 'thumb' },
              className: 'w-full',
            })}
          </div>,
        ),
      );
      const element = page
        .getByRole('img', { name: 'Pitch Notesのロゴ(画像を表示できません)' })
        .element();

      expect(element.getBoundingClientRect().width).toBe(240);
      expect(element.getBoundingClientRect().height).toBe(240);
    });

    test('代替テキストが空の飾りの画像は、プレースホルダーも支援技術に読ませない', async () => {
      const { container } = await render(
        withImagesOrigin(IMAGES_ORIGIN, pictureOf({ image: null, alt: '' })),
      );
      const placeholder = requiredElement(
        container,
        '[data-slot="media-placeholder"]',
      );

      expect(placeholder.getAttribute('aria-hidden')).toBe('true');
      expect(placeholder.hasAttribute('role')).toBe(false);
    });

    test.each([
      ['正方形', { kind: 'square', size: 32 }, 'Pitch Notesのロゴ'],
      [
        'スクリーンショット',
        { kind: 'screenshot', variant: 'thumb' },
        'Pitch Notesのロゴ(画像を表示できません)',
      ],
    ] as const)(
      '%sの画像の読み込みに失敗すると、プレースホルダーに切り替える',
      async (_name, display, name) => {
        const { container } = await render(
          withImagesOrigin(
            MISSING_IMAGES_ORIGIN,
            pictureOf({ image: imageOf('PNG', 1920, 1080), display }),
          ),
        );

        await expect
          .poll(() =>
            container.querySelector('[data-slot="media-placeholder"]'),
          )
          .not.toBeNull();
        await expect
          .element(page.getByRole('img', { name, exact: true }))
          .toBeVisible();
        expect(container.querySelector('img, picture')).toBeNull();
      },
    );

    test('サーバー側の描画の後、ハイドレーションの前に読み込みに失敗していても、プレースホルダーに切り替える', async () => {
      const ui = withImagesOrigin(MISSING_IMAGES_ORIGIN, pictureOf());
      const container = insertServerMarkup(ui);
      const img = requiredElement(container, 'img');
      await expect
        .poll(() => img instanceof HTMLImageElement && img.complete)
        .toBe(true);

      await hydrate(container, ui);

      await expect
        .element(page.getByRole('img', { name: 'Pitch Notesのロゴ' }))
        .toHaveTextContent('P');
      expect(container.querySelector('img')).toBeNull();
    });
  });

  describe('読み込みに成功した画像', () => {
    const SERVED_KEY = 'fedcba9876543210'.repeat(2);
    let served: ServedMediaImages;

    beforeAll(async () => {
      served = await serveMediaImages(SERVED_KEY);
    });

    afterAll(async () => {
      await served.remove();
    });

    const servedPictureOf = (props: Partial<MediaPictureProps> = {}) =>
      withImagesOrigin(
        served.origin,
        pictureOf({ image: imageOf('JPG', 1000, 800, SERVED_KEY), ...props }),
      );

    test.each<[string, Partial<MediaPictureProps>, string]>([
      ['正方形', {}, 'picture > img'],
      [
        'スクリーンショット',
        {
          image: imageOf('PNG', 1920, 1080, SERVED_KEY),
          display: { kind: 'screenshot', variant: 'thumb' },
        },
        'picture > img',
      ],
      [
        '寸法の無いSVG',
        {
          image: imageOf('SVG', null, null, SERVED_KEY),
          display: { kind: 'square', size: 128 },
        },
        'img',
      ],
    ])(
      '%sは、クライアントで描画して読み込んだ後も画像のまま表示する',
      async (_name, props, selector) => {
        const { container } = await render(servedPictureOf(props));

        await expect
          .poll(() => isLoadedImage(container.querySelector(selector)))
          .toBe(true);
        await settleAfterLoad();
        expect(isLoadedImage(container.querySelector(selector))).toBe(true);
        expect(
          container.querySelector('[data-slot="media-placeholder"]'),
        ).toBeNull();
      },
    );

    test.each<[string, Partial<MediaPictureProps>]>([
      ['正方形', {}],
      [
        '寸法の無いSVG',
        {
          image: imageOf('SVG', null, null, SERVED_KEY),
          display: { kind: 'square', size: 128 },
        },
      ],
    ])(
      '%sは、ハイドレーションの前に読み込み終えていても、ハイドレーションの後に画像のまま表示する',
      async (_name, props) => {
        const ui = servedPictureOf(props);
        const container = insertServerMarkup(ui);
        await expect
          .poll(() => isLoadedImage(container.querySelector('img')))
          .toBe(true);

        await hydrate(container, ui);
        await settleAfterLoad();

        expect(isLoadedImage(container.querySelector('img'))).toBe(true);
        expect(
          container.querySelector('[data-slot="media-placeholder"]'),
        ).toBeNull();
      },
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('画像とプレースホルダーのアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        withImagesOrigin(
          IMAGES_ORIGIN,
          <div className="flex flex-col gap-4 bg-background p-4 text-foreground">
            {pictureOf({ image: null })}
            {pictureOf({
              image: imageOf('PNG', 1920, 1080, null),
              display: { kind: 'screenshot', variant: 'thumb' },
              alt: 'Pitch Notesのスクリーンショット',
            })}
            {pictureOf({ image: null, alt: '' })}
          </div>,
        ),
      );
      const delivered = container.appendChild(document.createElement('div'));
      delivered.replaceChildren(
        ...serverMarkupOf(
          <>
            {pictureOf()}
            {pictureOf({ image: imageOf('SVG') })}
          </>,
        ).childNodes,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
