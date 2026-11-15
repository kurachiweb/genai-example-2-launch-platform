import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import type { AppRuntime, RouterContext } from '../../start/router-context.ts';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import type { MediaImageView } from '../../utilities/media/picture-sources.ts';
import { AdminAvatar, type AdminAvatarProps } from './admin-avatar.tsx';

const IMAGES_ORIGIN = 'https://images.example';

// 画像配信の経路を持たないテストの配信元へ要求させ、読み込みを失敗させる
const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

const KEY = '0123456789abcdef'.repeat(2);

const NICKNAME = 'サンプル管理者';

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
      stripePublishableKey: undefined,
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

function avatarOf(props: Partial<AdminAvatarProps> = {}): ReactElement {
  return <AdminAvatar image={IMAGE} nickname={NICKNAME} size={32} {...props} />;
}

const placeholderIn = (container: HTMLElement): HTMLElement | null =>
  container.querySelector('[data-slot="media-placeholder"]');

afterEach(() => {
  applyColorScheme('light');
});

describe('AdminAvatar', () => {
  test('画像があれば、画像配信のオリジンの正方形の画像を表示サイズの丸い枠で描く', () => {
    const body = new DOMParser().parseFromString(
      renderToString(withImagesOrigin(IMAGES_ORIGIN, avatarOf({ size: 64 }))),
      'text/html',
    ).body;
    const img = body.querySelector('img');

    expect(img?.getAttribute('src')).toBe(
      `${IMAGES_ORIGIN}/${KEY}/square-sm.png`,
    );
    expect(img?.getAttribute('width')).toBe('64');
    expect(img?.getAttribute('height')).toBe('64');
    expect(img?.classList.contains('rounded-full')).toBe(true);
    expect(img?.getAttribute('alt')).toBe('');
  });

  test.each<[string, MediaImageView | null]>([
    ['未登録', null],
    ['表示できない(隔離中など)', { ...IMAGE, objectKey: null }],
  ])(
    '画像が%sのときは、ニックネームの先頭1文字の丸い既定のアイコンを表示サイズで描く',
    async (_name, image) => {
      const { container } = await render(
        withImagesOrigin(IMAGES_ORIGIN, avatarOf({ image, size: 64 })),
      );
      const placeholder = placeholderIn(container);

      expect(container.querySelector('img')).toBeNull();
      expect(placeholder).not.toBeNull();
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

  test('ニックネームを隣に書く飾りの画像として、既定では既定のアイコンも支援技術に読ませない', async () => {
    const { container } = await render(
      withImagesOrigin(IMAGES_ORIGIN, avatarOf({ image: null })),
    );

    expect(placeholderIn(container)?.getAttribute('aria-hidden')).toBe('true');
  });

  test('代替テキストを渡すと、既定のアイコンをその名前の画像として伝える', async () => {
    await render(
      withImagesOrigin(
        IMAGES_ORIGIN,
        avatarOf({ image: null, alt: `${NICKNAME}のプロフィール画像` }),
      ),
    );

    await expect
      .element(
        page.getByRole('img', {
          name: `${NICKNAME}のプロフィール画像`,
          exact: true,
        }),
      )
      .toHaveTextContent('サ');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('既定のアイコンで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        withImagesOrigin(
          IMAGES_ORIGIN,
          <div className="flex items-center gap-2 p-4">
            {avatarOf({ image: null })}
            {avatarOf({
              image: null,
              size: 64,
              alt: `${NICKNAME}のプロフィール画像`,
            })}
            <span>{NICKNAME}</span>
          </div>,
        ),
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
