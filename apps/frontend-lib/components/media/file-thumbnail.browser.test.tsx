import { afterEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  createDocumentFile,
  createImageFile,
  createSvgFile,
} from '../../test/media-files.ts';
import { FileThumbnail } from './file-thumbnail.tsx';

function spyObjectUrls(): {
  readonly created: () => readonly string[];
  readonly revoked: () => readonly string[];
} {
  const create = vi.spyOn(URL, 'createObjectURL');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  return {
    created: () => create.mock.results.map(({ value }) => String(value)),
    revoked: () => revoke.mock.calls.map(([url]) => url),
  };
}

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector('canvas');
  if (canvas === null) {
    throw new Error('サムネイルが描画されていません。');
  }
  return canvas;
}

const centerAlphaOf = (canvas: HTMLCanvasElement): number => {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('サムネイルの描画の文脈を取れません。');
  }
  const [, , , alpha = 0] = context.getImageData(
    Math.floor(canvas.width / 2),
    Math.floor(canvas.height / 2),
    1,
    1,
  ).data;
  return alpha;
};

afterEach(() => {
  vi.restoreAllMocks();
  applyColorScheme('light');
});

describe('FileThumbnail', () => {
  test('画像は最初のコマを静止画として描き、動く画像要素を置かない', async () => {
    const { container } = await render(
      <FileThumbnail
        file={await createImageFile('photo.png', 'image/png', {
          width: 120,
          height: 60,
        })}
      />,
    );
    const canvas = canvasOf(container);

    await expect.poll(() => centerAlphaOf(canvas)).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
  });

  test('SVGもサムネイルとして描く', async () => {
    const { container } = await render(
      <FileThumbnail file={createSvgFile('logo.svg')} />,
    );

    await expect
      .poll(() => centerAlphaOf(canvasOf(container)))
      .toBeGreaterThan(0);
  });

  test('描き終えたらオブジェクトURLを破棄する', async () => {
    const urls = spyObjectUrls();
    const { container } = await render(
      <FileThumbnail
        file={await createImageFile('photo.jpg', 'image/jpeg', {
          width: 40,
          height: 40,
        })}
      />,
    );

    await expect
      .poll(() => centerAlphaOf(canvasOf(container)))
      .toBeGreaterThan(0);
    expect(urls.created().length).toBeGreaterThan(0);
    expect(new Set(urls.revoked())).toStrictEqual(new Set(urls.created()));
  });

  test('描く前に外しても、ファイルを替えても、作ったオブジェクトURLを全て破棄する', async () => {
    const urls = spyObjectUrls();
    const first = await createImageFile('first.png', 'image/png', {
      width: 40,
      height: 40,
    });
    const second = await createImageFile('second.webp', 'image/webp', {
      width: 40,
      height: 40,
    });
    const { rerender, unmount } = await render(<FileThumbnail file={first} />);

    await rerender(<FileThumbnail file={second} />);
    await unmount();

    expect(urls.created().length).toBeGreaterThanOrEqual(2);
    expect(new Set(urls.revoked())).toStrictEqual(new Set(urls.created()));
  });

  test('読み込めない画像でもオブジェクトURLを破棄する', async () => {
    const urls = spyObjectUrls();
    await render(
      <FileThumbnail
        file={createDocumentFile('broken.png', 'image/png', 16)}
      />,
    );

    await expect.poll(() => urls.revoked().length).toBeGreaterThan(0);
    expect(new Set(urls.revoked())).toStrictEqual(new Set(urls.created()));
  });

  test('画像でないファイルはアイコンを示し、オブジェクトURLを作らない', async () => {
    const urls = spyObjectUrls();
    const { container } = await render(
      <FileThumbnail
        file={createDocumentFile('guide.pdf', 'application/pdf', 16)}
      />,
    );

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(urls.created()).toStrictEqual([]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('画像と画像でないファイルのどちらでもアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex gap-2 bg-background p-4">
          <FileThumbnail file={createSvgFile('logo.svg')} />
          <FileThumbnail
            file={createDocumentFile('notes.txt', 'text/plain', 4)}
          />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
