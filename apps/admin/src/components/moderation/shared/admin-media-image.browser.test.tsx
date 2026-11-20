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
import {
  PUBLIC_LOGO_FILE,
  QUARANTINED_AVATAR_FILE,
} from '../../../../test/moderation-fixtures.ts';
import { AdminMediaImage } from './admin-media-image.tsx';

// 補助のfixtureが読み込むルーターの文脈の同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// 書き出した画像の置き場所は他のテストのファイルと分ける
const SERVED_KEY = '0123456789abcdef'.repeat(2);

// テストの開発サーバーがアプリのルートから配信する同一オリジンの画像
const LOADABLE_FILE = Object.freeze({
  ...QUARANTINED_AVATAR_FILE,
  path: `/.vitest-attachments/served-media-images/${SERVED_KEY}/square-sm.png`,
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

describe('同一オリジンの画像', () => {
  test('画像配信ドメインを使わず、ファイルの中継の経路を<img>のsrcにして、表示の寸法を付ける', async () => {
    await render(
      <AdminMediaImage
        file={LOADABLE_FILE}
        display={{ kind: 'square', size: 64 }}
        alt="サンプル太郎のプロフィール画像"
        placeholder={PLACEHOLDER}
      />,
    );

    const image = imageOf('サンプル太郎のプロフィール画像');
    await expect.element(image).toBeVisible();
    const element = image.element();
    expect(element.tagName).toBe('IMG');
    expect(element.getAttribute('src')).toBe(LOADABLE_FILE.path);
    expect(element.getAttribute('width')).toBe('64');
    expect(element.getAttribute('height')).toBe('64');
    await expect
      .poll(() => (element as HTMLImageElement).naturalWidth)
      .toBeGreaterThan(0);
    expect(element.isConnected).toBe(true);
  });

  test('読み込めない画像は、一覧と他の操作を続けられるよう同じ名前の代わりの表示にする', async () => {
    await render(
      <>
        <AdminMediaImage
          file={PUBLIC_LOGO_FILE}
          display={{ kind: 'square', size: 64 }}
          alt="Pitch Notesのロゴ"
          placeholder={PLACEHOLDER}
        />
        <button type="button">隔離</button>
      </>,
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

  test('スクリーンショットの代わりの表示は、画像を表示できない旨を名前と表示に含める', async () => {
    await render(
      <AdminMediaImage
        file={PUBLIC_LOGO_FILE}
        display={{ kind: 'screenshot', variant: 'thumb' }}
        alt="スクリーンショット1"
        placeholder={PLACEHOLDER}
      />,
    );

    await expect
      .element(imageOf('スクリーンショット1(画像を表示できません)'))
      .toHaveTextContent('画像を表示できません');
  });

  test('削除済みなどでファイルが無ければ、<img>を置かずに代わりの表示にする', async () => {
    const { container } = await render(
      <AdminMediaImage
        file={null}
        display={{ kind: 'square', size: 32 }}
        alt="Pitch Notesのロゴ"
        placeholder={PLACEHOLDER}
      />,
    );

    await expect.element(imageOf('Pitch Notesのロゴ')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('画像と代わりの表示のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <>
        <AdminMediaImage
          file={LOADABLE_FILE}
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
    );

    expect(await runAxe(container)).toStrictEqual([]);
    applyColorScheme('light');
  });
});
