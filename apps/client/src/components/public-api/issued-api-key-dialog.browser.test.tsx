import { StrictMode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { IssuedApiKeyDialog } from './issued-api-key-dialog.tsx';

const TITLE = '新しいAPIキー';
const STORAGE_NOTICE =
  'このキーは今しか表示されません。安全な場所に保管してください。';
const COPIED = 'APIキーをコピーしました。';
const COPY_FAILED = 'APIキーをコピーできませんでした。';

const FIRST_KEY = 'lsk_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const SECOND_KEY = 'lsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefg';

const OPEN_FIRST = '1つ目を発行';
const OPEN_SECOND = '2つ目を発行';

interface HarnessProps {
  readonly onClose?: () => void;
}

function Harness({ onClose }: HarnessProps) {
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <main className="bg-background p-4 text-foreground">
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setPlainKey(FIRST_KEY);
          }}
        >
          {OPEN_FIRST}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlainKey(SECOND_KEY);
          }}
        >
          {OPEN_SECOND}
        </button>
        <IssuedApiKeyDialog
          plainKey={plainKey}
          onClose={() => {
            onClose?.();
            setPlainKey(null);
          }}
          returnFocusRef={openerRef}
        />
      </main>
      <Toaster />
    </>
  );
}

const dialog = () => page.getByRole('dialog');

const keyInput = () => dialog().getByRole('textbox', { name: 'APIキー' });

const copyButton = () =>
  dialog().getByRole('button', { name: 'コピー', exact: true });

const closeButton = () =>
  dialog().getByRole('button', { name: '閉じる', exact: true });

const openDialog = async (
  props: HarnessProps = {},
  label: string = OPEN_FIRST,
): Promise<void> => {
  await render(<Harness {...props} />);
  await userEvent.click(page.getByRole('button', { name: label }));
  await expect.element(dialog()).toBeVisible();
};

const stubClipboardWrite = (implementation: (text: string) => Promise<void>) =>
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(implementation);

const expectNoPlainKeyInDocument = (plainKey: string): void => {
  expect(document.documentElement.outerHTML).not.toContain(plainKey);
  const values = Array.from(document.querySelectorAll('input')).map(
    (input) => input.value,
  );
  expect(values).not.toContain(plainKey);
};

afterEach(() => {
  vi.restoreAllMocks();
  toast.dismiss();
  applyColorScheme('light');
});

describe('平文の表示', () => {
  test('題名「新しいAPIキー」で、平文を読み取り専用の等幅の欄「APIキー」に示し、保管の案内と「コピー」「閉じる」を添える', async () => {
    await openDialog();

    await expect
      .element(dialog().getByRole('heading', { name: TITLE }))
      .toBeVisible();
    await expect.element(dialog()).toHaveAccessibleDescription(STORAGE_NOTICE);
    await expect.element(keyInput()).toHaveValue(FIRST_KEY);
    await expect.element(keyInput()).toHaveAttribute('readonly');
    expect(getComputedStyle(keyInput().element()).fontFamily).toMatch(
      /monospace/u,
    );
    await expect.element(copyButton()).toBeVisible();
    await expect.element(closeButton()).toBeVisible();
    expect(
      dialog().getByRole('button', { name: '閉じる' }).elements(),
    ).toHaveLength(1);
  });

  test('開くと欄へフォーカスして平文を全て選び、戻った時も選び直して手で写せるようにする', async () => {
    await openDialog();
    const input = keyInput().element() as HTMLInputElement;

    await expect.element(keyInput()).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toStrictEqual([
      0,
      FIRST_KEY.length,
    ]);

    await userEvent.tab();
    await expect.element(copyButton()).toHaveFocus();
    await userEvent.tab({ shift: true });

    await expect.element(keyInput()).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toStrictEqual([
      0,
      FIRST_KEY.length,
    ]);
  });

  test('開発時の二重の描画でも平文を示し続ける', async () => {
    await render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await userEvent.click(page.getByRole('button', { name: OPEN_FIRST }));

    await expect.element(keyInput()).toHaveValue(FIRST_KEY);
  });
});

describe('コピー', () => {
  test('平文をクリップボードへ書き、成功をトーストで知らせ、トーストに平文を含めない', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await openDialog();

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPIED)).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FIRST_KEY);
    expect(page.getByText(COPY_FAILED).elements()).toStrictEqual([]);
    const toaster = document.querySelector('[data-sonner-toaster]');
    expect(toaster?.textContent).not.toContain(FIRST_KEY);
  });

  test('書き込みが拒まれた時は失敗をトーストで知らせる', async () => {
    stubClipboardWrite(() =>
      Promise.reject(new DOMException('拒否', 'NotAllowedError')),
    );
    await openDialog();

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPY_FAILED)).toBeVisible();
    expect(page.getByText(COPIED).elements()).toStrictEqual([]);
    await expect.element(dialog()).toBeVisible();
  });

  test('クリップボードを使えない環境では失敗をトーストで知らせる', async () => {
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(
      undefined as unknown as Clipboard,
    );
    await openDialog();

    await userEvent.click(copyButton());

    await expect.element(page.getByText(COPY_FAILED)).toBeVisible();
  });

  test('キーボードで「コピー」へ移って押せる', async () => {
    const writeText = stubClipboardWrite(() => Promise.resolve());
    await openDialog();

    copyButton().element().focus();
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText(COPIED)).toBeVisible();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(FIRST_KEY);
  });
});

describe('閉じる', () => {
  test('「閉じる」で閉じて開いた元へフォーカスを戻し、閉じ終えた後は平文を文書に残さない', async () => {
    const onClose = vi.fn();
    await openDialog({ onClose });

    await userEvent.click(closeButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
    await expect
      .element(page.getByRole('button', { name: OPEN_FIRST }))
      .toHaveFocus();
    expectNoPlainKeyInDocument(FIRST_KEY);
  });

  test('Escapeでも閉じ、平文を文書に残さない', async () => {
    await openDialog();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    expectNoPlainKeyInDocument(FIRST_KEY);
  });

  test('ダイアログの外を押しても閉じず、フォーカスをダイアログの中に保つ', async () => {
    const onClose = vi.fn();
    await openDialog({ onClose });

    await userEvent.click(document.body, { position: { x: 4, y: 4 } });

    await expect.element(dialog()).toHaveAttribute('data-state', 'open');
    expect(onClose).not.toHaveBeenCalled();
    await expect.element(keyInput()).toHaveValue(FIRST_KEY);
    await expect
      .poll(() => dialog().element().contains(document.activeElement))
      .toBe(true);
  });

  test('閉じる動きの間は題名と平文を保ち、閉じ終えると取り除く', async () => {
    await openDialog();

    await userEvent.click(closeButton());

    const element = document.querySelector('[role="dialog"]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('閉じる途中のダイアログがありません。');
    }
    expect(element.dataset.state).toBe('closed');
    expect(element.querySelector('h2')?.textContent).toBe(TITLE);
    expect(element.querySelector('input')?.value).toBe(FIRST_KEY);
    await expect.element(dialog()).not.toBeInTheDocument();
    expectNoPlainKeyInDocument(FIRST_KEY);
  });

  test('閉じた後に別のキーで開くと、新しい平文だけを示す', async () => {
    await openDialog();
    await userEvent.click(closeButton());
    await expect.element(dialog()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: OPEN_SECOND }));

    await expect.element(keyInput()).toHaveValue(SECOND_KEY);
    expectNoPlainKeyInDocument(FIRST_KEY);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('平文のダイアログのアクセシビリティの違反が0件', async () => {
    applyColorScheme(scheme);
    await openDialog();

    expect(await runAxe(dialog().element())).toEqual([]);
  });
});
