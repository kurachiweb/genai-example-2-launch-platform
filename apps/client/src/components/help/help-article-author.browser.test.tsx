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
} from '../../../lib/test/computed-style.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../../lib/test/served-media-images.ts';
import {
  createPageRouterContext,
  renderInRouter,
  SERVED_IMAGES_ORIGIN,
} from '../../../test/page-router.tsx';
import type { HelpArticleAuthorView } from '../../graphql/help-center.ts';
import { HelpArticleAuthor } from './help-article-author.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const OBJECT_KEY = '89abcdef01234567'.repeat(2);

const AUTHOR: NonNullable<HelpArticleAuthorView> = {
  nickname: '運営チームの佐藤',
  title: 'サポート担当',
  avatar: {
    id: 'media-1',
    objectKey: OBJECT_KEY,
    fallbackFormat: 'JPG',
    width: 400,
    height: 400,
  },
};

const renderAuthor = (author: HelpArticleAuthorView) =>
  renderInRouter(
    <div id="author-root" className="bg-background p-4 text-foreground">
      <HelpArticleAuthor author={author} />
    </div>,
    {
      context: createPageRouterContext('local', {
        imagesOrigin: SERVED_IMAGES_ORIGIN,
      }),
    },
  );

const rootText = () => document.getElementById('author-root')?.textContent;

const placeholder = () =>
  document.querySelector('[data-slot="media-placeholder"]');

let served: ServedMediaImages;

beforeAll(async () => {
  served = await serveMediaImages(OBJECT_KEY);
});

afterAll(async () => {
  await served.remove();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpArticleAuthor', () => {
  test('作成者のプロフィール画像(square-xs)・ニックネーム・肩書きを示す', async () => {
    await renderAuthor(AUTHOR);

    await expect.element(page.getByText('運営チームの佐藤')).toBeVisible();
    await expect.element(page.getByText('サポート担当')).toBeVisible();
    const image = () => document.querySelector('img');
    await expect.poll(() => image()?.naturalWidth).toBeGreaterThan(0);
    expect(image()?.getAttribute('src')).toBe(
      `${SERVED_IMAGES_ORIGIN}/${OBJECT_KEY}/square-xs.jpg`,
    );
    expect(image()?.getAttribute('alt')).toBe('');
    expect(placeholder()).toBeNull();
  });

  test('肩書きが無ければニックネームだけを示す', async () => {
    await renderAuthor({ ...AUTHOR, title: null });

    await expect.element(page.getByText('運営チームの佐藤')).toBeVisible();
    expect(rootText()).toBe('運営チームの佐藤');
  });

  test('プロフィール画像が未設定なら、ニックネームから作る既定の画像を示す', async () => {
    await renderAuthor({ ...AUTHOR, avatar: null });

    await expect.element(page.getByText('運営チームの佐藤')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(placeholder()?.textContent).toBe('運');
  });

  test('作成者の管理者が削除済みなら、「削除済みの管理者」と既定の画像を示す', async () => {
    await renderAuthor(null);

    await expect.element(page.getByText('削除済みの管理者')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
    expect(placeholder()?.getAttribute('aria-hidden')).toBe('true');
    expect(rootText()).toBe(
      `${placeholder()?.textContent ?? ''}削除済みの管理者`,
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      { name: '作成者', author: AUTHOR },
      { name: '削除済みの管理者', author: null },
    ])(
      '$nameの表示で、アクセシビリティの検査の違反が0件',
      async ({ author }) => {
        applyColorScheme(scheme);
        await renderAuthor(author);
        await expect
          .element(page.getByText(author?.nickname ?? '削除済みの管理者'))
          .toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
