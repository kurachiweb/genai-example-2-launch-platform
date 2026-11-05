import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import type { AppRuntime, RouterContext } from '../../start/router-context.ts';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import type { MediaImageView } from '../../utilities/media/picture-sources.ts';
import {
  InquirerAvatar,
  type InquirerAvatarProps,
} from './inquirer-avatar.tsx';

const IMAGES_ORIGIN = 'https://images.example';

// 画像配信の経路を持たないテストの配信元へ要求させ、読み込みを失敗させる
const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

const KEY = 'fedcba9876543210'.repeat(2);

const NICKNAME = 'サンプル利用者';

const IMAGE: MediaImageView = {
  objectKey: KEY,
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
};

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

function avatarOf(props: Partial<InquirerAvatarProps> = {}): ReactElement {
  return (
    <InquirerAvatar image={IMAGE} nickname={NICKNAME} size="xs" {...props} />
  );
}

const placeholderIn = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('[data-slot="media-placeholder"]');

afterEach(() => {
  applyColorScheme('light');
});

describe('InquirerAvatar', () => {
  test.each<[InquirerAvatarProps['size'], number, string]>([
    ['xs', 32, 'square-xs'],
    ['sm', 64, 'square-sm'],
  ])(
    '画像があれば、大きさ%sは%dピクセルの丸い枠に%sの画像を描く',
    (size, pixels, variant) => {
      const body = new DOMParser().parseFromString(
        renderToString(withImagesOrigin(IMAGES_ORIGIN, avatarOf({ size }))),
        'text/html',
      ).body;
      const img = body.querySelector('img');

      expect(img?.getAttribute('src')).toBe(
        `${IMAGES_ORIGIN}/${KEY}/${variant}.png`,
      );
      expect(img?.getAttribute('width')).toBe(String(pixels));
      expect(img?.getAttribute('height')).toBe(String(pixels));
      expect(img?.classList.contains('rounded-full')).toBe(true);
    },
  );

  test.each<[string, MediaImageView | null]>([
    ['未登録', null],
    ['表示できない(隔離中など)', { ...IMAGE, objectKey: null }],
  ])(
    '画像が%sのときは、ニックネームの先頭1文字の丸い既定のアイコンを描く',
    async (_name, image) => {
      const { container } = await render(
        withImagesOrigin(IMAGES_ORIGIN, avatarOf({ image, size: 'sm' })),
      );
      const placeholder = placeholderIn(container);

      expect(container.querySelector('img')).toBeNull();
      expect(placeholder?.textContent).toBe('サ');
      expect(placeholder?.classList.contains('rounded-full')).toBe(true);
      expect(placeholder?.getBoundingClientRect().width).toBe(64);
      expect(placeholder?.getBoundingClientRect().height).toBe(64);
    },
  );

  test('画像の読み込みに失敗すると、既定のアイコンに切り替える', async () => {
    const { container } = await render(
      withImagesOrigin(MISSING_IMAGES_ORIGIN, avatarOf()),
    );

    await expect.poll(() => placeholderIn(container)).not.toBeNull();
    expect(placeholderIn(container)?.textContent).toBe('サ');
    expect(container.querySelector('img, picture')).toBeNull();
  });

  test('ニックネームを隣に書く飾りの画像として、画像も既定のアイコンも支援技術に読ませない', async () => {
    const body = new DOMParser().parseFromString(
      renderToString(withImagesOrigin(IMAGES_ORIGIN, avatarOf())),
      'text/html',
    ).body;
    const { container } = await render(
      withImagesOrigin(IMAGES_ORIGIN, avatarOf({ image: null })),
    );

    expect(body.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(placeholderIn(container)?.getAttribute('aria-hidden')).toBe('true');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('既定のアイコンで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        withImagesOrigin(
          IMAGES_ORIGIN,
          <div className="flex items-center gap-2 bg-background p-4 text-foreground">
            {avatarOf({ image: null })}
            {avatarOf({ image: null, size: 'sm' })}
            <span>{NICKNAME}</span>
          </div>,
        ),
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
