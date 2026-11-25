import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../../../lib/test/served-media-images.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import type { RouterContext } from '../../../../lib/start/router-context.ts';
import type { AdminMediaFileView } from '../../../graphql/admin-moderation-shared.ts';
import {
  PUBLIC_LOGO_FILE,
  QUARANTINED_AVATAR_FILE,
} from '../../../../test/moderation-fixtures.ts';
import {
  createPageRouterContext,
  SERVED_IMAGES_ORIGIN,
} from '../../../../test/page-router.tsx';
import { AdminMediaImage } from './admin-media-image.tsx';

// 補助のfixtureが読み込むルーターの文脈の同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// 書き出した画像の置き場所は他のテストのファイルと分ける
const SERVED_KEY = '0123456789abcdef'.repeat(2);

// 画像配信の経路を持たないテストの配信元へ要求させ、読み込みを失敗させる
const MISSING_IMAGES_ORIGIN = `${location.origin}/__missing-media-images`;

// テストの開発サーバーがアプリのルートから配信する同一オリジンの画像
const LOADABLE_QUARANTINED_FILE: AdminMediaFileView = Object.freeze({
  ...QUARANTINED_AVATAR_FILE,
  path: `/.vitest-attachments/served-media-images/${SERVED_KEY}/square-sm.png`,
});

const SERVED_PUBLIC_FILE: AdminMediaFileView = Object.freeze({
  ...PUBLIC_LOGO_FILE,
  image: Object.freeze({ ...PUBLIC_LOGO_FILE.image, objectKey: SERVED_KEY }),
});

// 隔離の直後などで、隔離中なのに変換配信のオブジェクトキーが残っている画像
const QUARANTINED_FILE_WITH_OBJECT_KEY: AdminMediaFileView = Object.freeze({
  ...LOADABLE_QUARANTINED_FILE,
  image: Object.freeze({
    ...LOADABLE_QUARANTINED_FILE.image,
    objectKey: SERVED_KEY,
  }),
});

// 保存が終わっていないなどで、隔離理由が無くても変換配信から配信されない画像
const UNSERVABLE_PUBLIC_FILE: AdminMediaFileView = Object.freeze({
  ...LOADABLE_QUARANTINED_FILE,
  quarantined: false,
  quarantineReasons: Object.freeze([]),
});

let served: ServedMediaImages | undefined;

beforeAll(async () => {
  served = await serveMediaImages(SERVED_KEY);
});

afterAll(async () => {
  await served?.remove();
});

const PLACEHOLDER = Object.freeze({ label: 'Pitch Notes', seed: 'logo' });

const imageOf = (name: string) => page.getByRole('img', { name, exact: true });

function withImagesOrigin(imagesOrigin: string, ui: ReactNode) {
  const router = createRouter({
    routeTree: createRootRouteWithContext<RouterContext>()(),
    history: createMemoryHistory(),
    context: createPageRouterContext('local', { imagesOrigin }),
  });
  return <RouterContextProvider router={router}>{ui}</RouterContextProvider>;
}

describe('公開中の画像', () => {
  test('画像配信のオリジンから<picture>で変換配信の画像を表示する', async () => {
    const { container } = await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <AdminMediaImage
          file={SERVED_PUBLIC_FILE}
          display={{ kind: 'square', size: 64 }}
          alt="Pitch Notesのロゴ"
          placeholder={PLACEHOLDER}
        />,
      ),
    );

    const image = imageOf('Pitch Notesのロゴ');
    await expect.element(image).toBeVisible();
    const element = image.element() as HTMLImageElement;
    expect(element.tagName).toBe('IMG');
    expect(element.getAttribute('src')).toBe(
      `${SERVED_IMAGES_ORIGIN}/${SERVED_KEY}/square-sm.png`,
    );
    expect(element.getAttribute('srcset')).toContain(
      `${SERVED_IMAGES_ORIGIN}/${SERVED_KEY}/`,
    );
    expect(element.getAttribute('loading')).toBe('lazy');
    expect(element.closest('picture')?.dataset.slot).toBe('media-picture');
    const sources = [...container.querySelectorAll('picture source')].map(
      (source) => source.getAttribute('srcset') ?? '',
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(
      sources.every((source) =>
        source.startsWith(`${SERVED_IMAGES_ORIGIN}/${SERVED_KEY}/`),
      ),
    ).toBe(true);
    expect(container.innerHTML).not.toContain('/_bff/files/');
    await expect.poll(() => element.naturalWidth).toBeGreaterThan(0);
  });

  test('変換配信のオブジェクトキーが無ければ、隔離理由が無くても同じオリジンの中継の経路から表示する', async () => {
    const { container } = await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <AdminMediaImage
          file={UNSERVABLE_PUBLIC_FILE}
          display={{ kind: 'square', size: 64 }}
          alt="Pitch Notesのロゴ"
          placeholder={PLACEHOLDER}
        />,
      ),
    );

    const image = imageOf('Pitch Notesのロゴ');
    await expect.element(image).toBeVisible();
    expect(image.element().getAttribute('src')).toBe(
      UNSERVABLE_PUBLIC_FILE.path,
    );
    expect(container.querySelector('picture')).toBeNull();
  });

  test('読み込めない画像は、一覧と他の操作を続けられるよう同じ名前の代わりの表示にする', async () => {
    await render(
      withImagesOrigin(
        MISSING_IMAGES_ORIGIN,
        <>
          <AdminMediaImage
            file={PUBLIC_LOGO_FILE}
            display={{ kind: 'square', size: 64 }}
            alt="Pitch Notesのロゴ"
            placeholder={PLACEHOLDER}
          />
          <button type="button">隔離</button>
        </>,
      ),
    );

    const placeholder = imageOf('Pitch Notesのロゴ');
    await expect
      .poll(() => placeholder.element().getAttribute('data-slot'))
      .toBe('media-placeholder');
    expect(page.getByRole('img').all()).toHaveLength(1);
    await expect
      .element(page.getByRole('button', { name: '隔離' }))
      .toBeEnabled();
  });
});

describe('隔離中の画像', () => {
  test('画像配信ドメインを使わず、ファイルの中継の経路を<img>のsrcにして、表示の寸法を付ける', async () => {
    const { container } = await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <AdminMediaImage
          file={LOADABLE_QUARANTINED_FILE}
          display={{ kind: 'square', size: 64 }}
          alt="サンプル太郎のプロフィール画像"
          placeholder={PLACEHOLDER}
        />,
      ),
    );

    const image = imageOf('サンプル太郎のプロフィール画像');
    await expect.element(image).toBeVisible();
    const element = image.element();
    expect(element.tagName).toBe('IMG');
    expect(element.getAttribute('src')).toBe(LOADABLE_QUARANTINED_FILE.path);
    expect(element.getAttribute('width')).toBe('64');
    expect(element.getAttribute('height')).toBe('64');
    expect(container.querySelector('picture')).toBeNull();
    await expect
      .poll(() => (element as HTMLImageElement).naturalWidth)
      .toBeGreaterThan(0);
    expect(element.isConnected).toBe(true);
  });

  test('変換配信のオブジェクトキーが残っていても、隔離中なら画像配信のオリジンを使わず中継の経路から表示する', async () => {
    const { container } = await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <AdminMediaImage
          file={QUARANTINED_FILE_WITH_OBJECT_KEY}
          display={{ kind: 'square', size: 64 }}
          alt="サンプル太郎のプロフィール画像"
          placeholder={PLACEHOLDER}
        />,
      ),
    );

    const image = imageOf('サンプル太郎のプロフィール画像');
    await expect.element(image).toBeVisible();
    expect(image.element().getAttribute('src')).toBe(
      QUARANTINED_FILE_WITH_OBJECT_KEY.path,
    );
    expect(container.querySelector('picture')).toBeNull();
    expect(container.innerHTML).not.toContain(SERVED_IMAGES_ORIGIN);
  });

  test('読み込めない画像は、一覧と他の操作を続けられるよう同じ名前の代わりの表示にする', async () => {
    await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <>
          <AdminMediaImage
            file={QUARANTINED_AVATAR_FILE}
            display={{ kind: 'square', size: 64 }}
            alt="サンプル太郎のプロフィール画像"
            placeholder={PLACEHOLDER}
          />
          <button type="button">隔離の解除</button>
        </>,
      ),
    );

    const placeholder = imageOf('サンプル太郎のプロフィール画像');
    await expect
      .poll(() => placeholder.element().getAttribute('data-slot'))
      .toBe('media-placeholder');
    expect(page.getByRole('img').all()).toHaveLength(1);
    await expect
      .element(page.getByRole('button', { name: '隔離の解除' }))
      .toBeEnabled();
  });

  test('スクリーンショットの代わりの表示は、画像を表示できない旨を名前と表示に含める', async () => {
    await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <AdminMediaImage
          file={QUARANTINED_AVATAR_FILE}
          display={{ kind: 'screenshot', variant: 'thumb' }}
          alt="スクリーンショット1"
          placeholder={PLACEHOLDER}
        />,
      ),
    );

    await expect
      .element(imageOf('スクリーンショット1(画像を表示できません)'))
      .toHaveTextContent('画像を表示できません');
  });
});

describe('ファイルが無いとき', () => {
  test('削除済みなどでファイルが無ければ、<img>を置かずに代わりの表示にする', async () => {
    const { container } = await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <AdminMediaImage
          file={null}
          display={{ kind: 'square', size: 32 }}
          alt="Pitch Notesのロゴ"
          placeholder={PLACEHOLDER}
        />,
      ),
    );

    await expect.element(imageOf('Pitch Notesのロゴ')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('変換配信と中継の画像と代わりの表示のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      withImagesOrigin(
        SERVED_IMAGES_ORIGIN,
        <>
          <AdminMediaImage
            file={SERVED_PUBLIC_FILE}
            display={{ kind: 'square', size: 64 }}
            alt="ロゴ"
            placeholder={PLACEHOLDER}
          />
          <AdminMediaImage
            file={LOADABLE_QUARANTINED_FILE}
            display={{ kind: 'square', size: 64 }}
            alt="プロフィール画像"
            placeholder={PLACEHOLDER}
          />
          <AdminMediaImage
            file={null}
            display={{ kind: 'screenshot', variant: 'thumb' }}
            alt="スクリーンショット1"
            placeholder={PLACEHOLDER}
          />
        </>,
      ),
    );

    expect(await runAxe(container)).toStrictEqual([]);
    applyColorScheme('light');
  });
});
