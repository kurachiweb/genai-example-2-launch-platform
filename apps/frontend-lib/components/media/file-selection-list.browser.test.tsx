import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  createDocumentFile,
  createImageFile,
  createSvgFile,
} from '../../test/media-files.ts';
import {
  type FileSelectionItem,
  FileSelectionList,
} from './file-selection-list.tsx';

const LIST_LABEL = '選択したファイル';

const MEGABYTE = 1024 * 1024;

function liveRegionOf(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]');
  if (region === null) {
    throw new Error('読み上げの領域が描画されていません。');
  }
  return region;
}

const listItems = () =>
  page.getByRole('list', { name: LIST_LABEL }).getByRole('listitem');

async function sampleItems(): Promise<readonly FileSelectionItem[]> {
  return [
    {
      file: await createImageFile('photo.png', 'image/png', {
        width: 80,
        height: 40,
      }),
    },
    {
      file: createDocumentFile(
        'guide.pdf',
        'application/pdf',
        Math.round(1.2 * MEGABYTE),
      ),
    },
    { file: createDocumentFile('notes.txt', 'text/plain', 2048) },
    { file: createSvgFile('logo.svg'), status: 'アップロード済み' },
  ];
}

afterEach(() => {
  applyColorScheme('light');
});

describe('FileSelectionList', () => {
  test('各ファイルの名前・形式・サイズと、画像のサムネイルを一覧で示す', async () => {
    const { container } = await render(
      <FileSelectionList items={await sampleItems()} />,
    );

    await expect.element(listItems().nth(0)).toHaveTextContent('photo.png');
    await expect.element(listItems().nth(0)).toHaveTextContent(/PNG・\d/u);
    await expect.element(listItems().nth(1)).toHaveTextContent('guide.pdf');
    await expect.element(listItems().nth(1)).toHaveTextContent('PDF・1.2MB');
    await expect.element(listItems().nth(2)).toHaveTextContent('テキスト・2kB');
    await expect.element(listItems().nth(3)).toHaveTextContent('SVG・');
    expect(listItems().elements()).toHaveLength(4);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
  });

  test('ファイルごとの状態の文言を添える', async () => {
    await render(<FileSelectionList items={await sampleItems()} />);

    await expect
      .element(listItems().nth(3))
      .toHaveTextContent('アップロード済み');
  });

  test('形式を判別できないファイルは「不明な形式」と示す', async () => {
    await render(
      <FileSelectionList
        items={[
          { file: createDocumentFile('archive.zip', 'application/zip', 10) },
        ]}
      />,
    );

    await expect.element(listItems().nth(0)).toHaveTextContent('不明な形式・');
  });

  test('ファイルが無い間は一覧を置かず、読み上げの領域だけを置いておく', async () => {
    const { container } = await render(<FileSelectionList items={[]} />);

    expect(container.querySelector('ul')).toBeNull();
    expect(liveRegionOf(container).textContent).toBe('');
  });

  test('選んだファイルが変わると、ファイル名と件数を読み上げる', async () => {
    const { container, rerender } = await render(
      <FileSelectionList items={[]} />,
    );
    const region = liveRegionOf(container);
    const items = await sampleItems();

    await rerender(<FileSelectionList items={items.slice(0, 2)} />);
    expect(region.textContent).toBe(
      'photo.png、guide.pdfの2件を選択しました。',
    );

    await rerender(<FileSelectionList items={[...items.slice(0, 2)]} />);
    expect(region.textContent).toBe(
      'photo.png、guide.pdfの2件を選択しました。',
    );

    await rerender(<FileSelectionList items={items.slice(3)} />);
    expect(region.textContent).toBe('logo.svgを選択しました。');

    await rerender(<FileSelectionList items={[]} />);
    expect(region.textContent).toBe('');
  });

  test('最初から選んだファイルがあっても、表示した時点では読み上げない', async () => {
    const { container } = await render(
      <FileSelectionList items={await sampleItems()} />,
    );

    expect(liveRegionOf(container).textContent).toBe('');
  });

  test('長いファイル名でも親の幅からはみ出さない', async () => {
    const { container } = await render(
      <div className="w-64">
        <FileSelectionList
          items={[
            {
              file: createDocumentFile(
                `${'a'.repeat(120)}.pdf`,
                'application/pdf',
                10,
              ),
            },
          ]}
        />
      </div>,
    );
    const wrapper = container.firstElementChild;
    const list = container.querySelector('ul');

    expect(list?.scrollWidth).toBeLessThanOrEqual(
      wrapper?.clientWidth ?? Number.POSITIVE_INFINITY,
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <FileSelectionList items={await sampleItems()} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
