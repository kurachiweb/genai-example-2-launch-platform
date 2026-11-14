import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  isContentClipped,
} from '../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../test/overflow.ts';
import { RecoveryCodeList } from './recovery-code-list.tsx';

// 秘密の値らしい文字列をソースに書かないよう、発行の形(4文字ずつ区切った16文字)のコードを実行時に組み立てる
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const sampleCodes = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) =>
    Array.from({ length: 4 }, (__, group) =>
      Array.from(
        { length: 4 },
        (___, offset) =>
          ALPHABET[(index * 7 + group * 5 + offset * 3) % ALPHABET.length],
      ).join(''),
    ).join('-'),
  );

const CODES = sampleCodes(10);

const codeList = () => page.getByRole('list', { name: 'リカバリコード' });
const copyButton = () => page.getByRole('button', { name: 'すべてコピー' });

const COPIED = 'リカバリコードをコピーしました。';
const COPY_FAILED =
  'コピーできませんでした。リカバリコードを選択してコピーするか、書き留めてください。';
const STORAGE_NOTICE =
  '認証アプリとリカバリコードの両方を失うと、アカウントを復旧できません。リカバリコードは安全な場所に保管してください。各コードは1回だけ使えます。';

const stubClipboardWrite = (implementation: (text: string) => Promise<void>) =>
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(implementation);

afterEach(() => {
  vi.restoreAllMocks();
  applyColorScheme('light');
});

describe('RecoveryCodeList', () => {
  test('名前の付いた一覧に、受け取った順でコードを1件ずつ表示する', async () => {
    await render(<RecoveryCodeList codes={CODES} />);

    const items = codeList().getByRole('listitem').elements();
    expect(items.map((item) => item.textContent)).toStrictEqual([...CODES]);
  });

  test('コードは等幅の字形で表示し、ブラウザの翻訳の対象から外す', async () => {
    await render(<RecoveryCodeList codes={CODES} />);
    const code = page.getByText(CODES[0] ?? '', { exact: true }).element();

    expect(getComputedStyle(code).fontFamily).toMatch(/mono/i);
    expect(code.closest('[translate="no"]')).not.toBeNull();
  });

  test('両方を失うと復旧できない旨の注意と保管の促しを表示する', async () => {
    await render(<RecoveryCodeList codes={CODES} />);

    await expect
      .element(page.getByText(STORAGE_NOTICE, { exact: true }))
      .toBeVisible();
  });

  test('「すべてコピー」で全コードを1行1件の文字列としてクリップボードへ書き込み、結果を通知する', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await render(<RecoveryCodeList codes={CODES} />);
    const status = page.getByRole('status');

    await expect.element(status).toHaveTextContent('');
    await copyButton().click();

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CODES.join('\n'));
    await expect.element(status).toHaveTextContent(COPIED);
    expect(page.getByRole('alert').elements()).toStrictEqual([]);
  });

  test('キーボードでもコピーできる', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await render(<RecoveryCodeList codes={CODES} />);

    await userEvent.tab();
    await expect.element(copyButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CODES.join('\n'));
  });

  test('書き込みに失敗すると、代わりの手段をエラーとして示し、成功の通知を出さない', async () => {
    stubClipboardWrite(() =>
      Promise.reject(new DOMException('拒否', 'NotAllowedError')),
    );
    await render(<RecoveryCodeList codes={CODES} />);

    await copyButton().click();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(COPY_FAILED);
    await expect.element(page.getByRole('status')).toHaveTextContent('');
  });

  test('失敗の後にコピーし直して成功すると、エラーを消して成功を通知する', async () => {
    const writeText = stubClipboardWrite(() =>
      Promise.reject(new DOMException('拒否', 'NotAllowedError')),
    );
    await render(<RecoveryCodeList codes={CODES} />);
    await copyButton().click();
    await expect.element(page.getByRole('alert')).toBeInTheDocument();

    writeText.mockImplementation(() => Promise.resolve());
    await copyButton().click();

    await expect.element(page.getByRole('status')).toHaveTextContent(COPIED);
    expect(page.getByRole('alert').elements()).toStrictEqual([]);
  });

  test('クリップボードを使えない環境では、失敗として代わりの手段を示す', async () => {
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(
      undefined as unknown as Clipboard,
    );
    await render(<RecoveryCodeList codes={CODES} />);

    await copyButton().click();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(COPY_FAILED);
  });

  test('コードが変わると、前のコピーの結果の表示を消す', async () => {
    stubClipboardWrite(() => Promise.resolve());
    const { rerender } = await render(<RecoveryCodeList codes={CODES} />);
    await copyButton().click();
    await expect.element(page.getByRole('status')).toHaveTextContent(COPIED);

    await rerender(<RecoveryCodeList codes={sampleCodes(11).slice(1)} />);

    await expect.element(page.getByRole('status')).toHaveTextContent('');
  });

  test('幅を絞った親の中でも、親から溢れず内容が切れない', async () => {
    const { container } = await render(
      <div className="w-64">
        <RecoveryCodeList codes={CODES} />
      </div>,
    );

    expect(elementsOverflowingContainer(container)).toStrictEqual([]);
    expect(isContentClipped(copyButton().element())).toBe(false);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      stubClipboardWrite(() =>
        Promise.reject(new DOMException('拒否', 'NotAllowedError')),
      );
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <RecoveryCodeList codes={CODES} />
        </div>,
      );
      await copyButton().click();
      await expect.element(page.getByRole('alert')).toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
