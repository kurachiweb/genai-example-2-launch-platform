import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../test/overflow.ts';
import { PrivateFileLink } from './private-file-link.tsx';

const MEGABYTE = 1024 * 1024;

afterEach(() => {
  applyColorScheme('light');
});

describe('PrivateFileLink', () => {
  test('共通のダウンロードの経路へのリンクに、ファイル名とサイズを示す', async () => {
    await render(
      <PrivateFileLink
        fileId="file-1"
        fileName="specification.pdf"
        byteSize={Math.round(3.4 * MEGABYTE)}
      />,
    );
    const link = page.getByRole('link', {
      name: 'specification.pdf(3.4MB)',
      exact: true,
    });

    await expect.element(link).toHaveAttribute('href', '/_bff/files/file-1');
  });

  test('保存の仕方はサーバーの応答に任せ、download属性と別のタブを指定しない', async () => {
    await render(
      <PrivateFileLink fileId="file-1" fileName="notes.txt" byteSize={2048} />,
    );
    const link = page.getByRole('link').element();

    expect(link.hasAttribute('download')).toBe(false);
    expect(link.hasAttribute('target')).toBe(false);
  });

  test('識別子を経路の1区画として符号化する', async () => {
    await render(
      <PrivateFileLink fileId="a/b?c" fileName="notes.txt" byteSize={1} />,
    );

    await expect
      .element(page.getByRole('link'))
      .toHaveAttribute('href', '/_bff/files/a%2Fb%3Fc');
  });

  test('長いファイル名は枠の中で折り返す', async () => {
    const { container } = await render(
      <div className="w-48">
        <PrivateFileLink
          fileId="file-1"
          fileName={`${'very-long-file-name-'.repeat(6)}.pdf`}
          byteSize={512}
        />
      </div>,
    );

    expect(elementsOverflowingContainer(container)).toStrictEqual([]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <PrivateFileLink
            fileId="file-1"
            fileName="specification.pdf"
            byteSize={MEGABYTE}
          />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
