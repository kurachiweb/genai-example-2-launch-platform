import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../test/overflow.ts';
import {
  InquiryAttachmentList,
  type InquiryAttachmentView,
} from './inquiry-attachment-list.tsx';

const MEGABYTE = 1024 * 1024;

const SCREENSHOT: InquiryAttachmentView = {
  id: 'file-1',
  originalFileName: 'screenshot.png',
  contentType: 'image/png',
  byteSize: Math.round(1.5 * MEGABYTE),
};

const SPECIFICATION: InquiryAttachmentView = {
  id: 'file-2',
  originalFileName: 'specification.pdf',
  contentType: 'application/pdf',
  byteSize: 2048,
};

afterEach(() => {
  applyColorScheme('light');
});

describe('InquiryAttachmentList', () => {
  test('添付ごとに、元のファイル名とサイズのダウンロードのリンクを示す', async () => {
    await render(
      <InquiryAttachmentList attachments={[SCREENSHOT, SPECIFICATION]} />,
    );

    await expect
      .element(
        page.getByRole('link', { name: 'screenshot.png(1.5MB)', exact: true }),
      )
      .toHaveAttribute('href', '/_bff/files/file-1');
    await expect
      .element(
        page.getByRole('link', {
          name: 'specification.pdf(2kB)',
          exact: true,
        }),
      )
      .toHaveAttribute('href', '/_bff/files/file-2');
  });

  test('名前の付いた一覧に、添付の順で並べる', async () => {
    await render(
      <InquiryAttachmentList attachments={[SPECIFICATION, SCREENSHOT]} />,
    );
    const list = page.getByRole('list', { name: '添付ファイル', exact: true });

    await expect.element(list).toBeInTheDocument();
    expect(
      list
        .getByRole('listitem')
        .elements()
        .map((item) => item.querySelector('a')?.getAttribute('href')),
    ).toStrictEqual(['/_bff/files/file-2', '/_bff/files/file-1']);
  });

  test.each<[string, string]>([
    ['image/png', 'PNG'],
    ['application/pdf', 'PDF'],
    ['text/plain; charset=utf-8', 'テキスト'],
    ['application/zip', '不明な形式'],
  ])('形式%sは、リンクの隣に「%s」と示す', async (contentType, label) => {
    await render(
      <InquiryAttachmentList attachments={[{ ...SCREENSHOT, contentType }]} />,
    );

    await expect.element(page.getByRole('listitem')).toHaveTextContent(label);
    await expect
      .element(
        page.getByRole('link', { name: 'screenshot.png(1.5MB)', exact: true }),
      )
      .not.toHaveTextContent(label);
  });

  test('画像の形式でもインライン表示せず、画像の要素を置かない', async () => {
    const { container } = await render(
      <InquiryAttachmentList attachments={[SCREENSHOT]} />,
    );

    expect(container.querySelector('img, picture, iframe, object')).toBeNull();
    expect(page.getByRole('link').element().hasAttribute('download')).toBe(
      false,
    );
  });

  test('添付が無ければ何も描画しない', async () => {
    const { container } = await render(
      <InquiryAttachmentList attachments={[]} />,
    );

    expect(container.childElementCount).toBe(0);
  });

  test('長いファイル名は枠の中で折り返す', async () => {
    const { container } = await render(
      <div className="w-48">
        <InquiryAttachmentList
          attachments={[
            {
              ...SPECIFICATION,
              originalFileName: `${'very-long-file-name-'.repeat(6)}.pdf`,
            },
          ]}
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
          <InquiryAttachmentList attachments={[SCREENSHOT, SPECIFICATION]} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
