import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  computedColorOf,
} from '../../../lib/test/computed-style.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../../lib/test/served-media-images.ts';
import type { MediaImageView } from '../../../lib/utilities/media/picture-sources.ts';
import { placeholderAppearanceOf } from '../../../lib/utilities/media/placeholder-appearance.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { UserAvatar, type UserAvatarProps } from './user-avatar.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const KEY = '0123456789abcdef'.repeat(2);

const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

const NICKNAME = 'ピッチの作り手';

const IMAGE: MediaImageView = {
  objectKey: KEY,
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
};

const AVATAR_NAME = `${NICKNAME}のプロフィール画像`;

const userOf = (avatar: MediaImageView | null): UserAvatarProps['user'] => ({
  handle: 'pitch_maker',
  nickname: NICKNAME,
  avatar,
});

const renderAvatar = (
  imagesOrigin: string,
  avatar: MediaImageView | null,
  size: UserAvatarProps['size'] = 64,
) =>
  renderInRouter(<UserAvatar user={userOf(avatar)} size={size} />, {
    context: createPageRouterContext('local', { imagesOrigin }),
  });

const placeholder = () => page.getByRole('img', { name: AVATAR_NAME });

const isPlaceholder = (element: Element): boolean =>
  element.getAttribute('data-slot') === 'media-placeholder';

// 画像の書き出し先はアプリのルート直下で、共通部品の補助が返すオリジンは共通部品のディレクトリ基準のため、開発サーバーのルートから配信されるURLを自分で組み立てる
const SERVED_IMAGES_ORIGIN = `${location.origin}/.vitest-attachments/served-media-images`;

let served: ServedMediaImages;

beforeAll(async () => {
  served = await serveMediaImages(KEY);
});

afterAll(async () => {
  await served.remove();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('UserAvatar', () => {
  test('画像があれば、ニックネームを含む名前の丸い画像を表示サイズで描く', async () => {
    await renderAvatar(SERVED_IMAGES_ORIGIN, IMAGE, 64);

    const image = page.getByRole('img', { name: AVATAR_NAME });
    await expect.element(image).toBeVisible();
    const element = image.element() as HTMLImageElement;
    expect(isPlaceholder(element)).toBe(false);
    expect(element.tagName).toBe('IMG');
    expect(element.getAttribute('width')).toBe('64');
    expect(element.classList.contains('rounded-full')).toBe(true);
    await expect.poll(() => element.naturalWidth).toBeGreaterThan(0);
  });

  test('画像が無ければ、ニックネームの頭文字のプレースホルダーを描く', async () => {
    await renderAvatar(SERVED_IMAGES_ORIGIN, null);

    await expect.element(placeholder()).toBeVisible();
    const element = placeholder().element();
    expect(isPlaceholder(element)).toBe(true);
    expect(element.textContent).toBe('ピ');
    expect(element.classList.contains('rounded-full')).toBe(true);
  });

  test('隔離中の画像(objectKeyが空)は、画像を要求せずプレースホルダーを描く', async () => {
    await renderAvatar(SERVED_IMAGES_ORIGIN, { ...IMAGE, objectKey: null });

    await expect.element(placeholder()).toBeVisible();
    expect(isPlaceholder(placeholder().element())).toBe(true);
    expect(document.querySelector('img')).toBeNull();
  });

  test('画像の読み込みに失敗すると、プレースホルダーへ切り替える', async () => {
    await renderAvatar(MISSING_IMAGES_ORIGIN, IMAGE);

    await expect.poll(() => document.querySelector('img')).toBeNull();
    await expect.element(placeholder()).toBeVisible();
    expect(isPlaceholder(placeholder().element())).toBe(true);
  });

  test('プレースホルダーの配色はニックネームではなくハンドルで決まる', async () => {
    await renderAvatar(SERVED_IMAGES_ORIGIN, null, 32);

    const expected = computedColorOf(
      placeholderAppearanceOf({ label: NICKNAME, seed: 'pitch_maker' })
        .background,
    );
    expect(getComputedStyle(placeholder().element()).backgroundColor).toBe(
      expected,
    );
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で画像とプレースホルダーのaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderInRouter(
        <div>
          <UserAvatar user={userOf(IMAGE)} size={32} />
          <UserAvatar
            user={{ ...userOf(null), nickname: 'あ', handle: 'a_user' }}
            size={64}
          />
          <UserAvatar
            user={{ ...userOf(null), nickname: 'Zed', handle: 'zed' }}
            size={128}
          />
        </div>,
        {
          context: createPageRouterContext('local', {
            imagesOrigin: SERVED_IMAGES_ORIGIN,
          }),
        },
      );

      await expect.poll(() => document.querySelectorAll('img').length).toBe(1);
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
