import { useRef, useState } from 'react';
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
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import {
  ApiKeyConfirmDialog,
  type ApiKeyConfirmTarget,
} from './api-key-confirm-dialog.tsx';

const API_KEY = Object.freeze({
  id: '01JD0000000000000000000001',
  name: '集計スクリプト',
});

const DELETE_TARGET: ApiKeyConfirmTarget = Object.freeze({
  action: 'delete',
  apiKey: API_KEY,
});

const REISSUE_TARGET: ApiKeyConfirmTarget = Object.freeze({
  action: 'reissue',
  apiKey: API_KEY,
});

const DELETE_TITLE = 'APIキー『集計スクリプト』を削除しますか?';
const DELETE_DESCRIPTION = 'このキーを使った要求はすぐに使えなくなります。';
const REISSUE_TITLE = 'APIキー『集計スクリプト』を再発行しますか?';
const REISSUE_DESCRIPTION =
  '同じ名前と権限の新しいキーを追加で発行します。今のキーはそのまま使えます。不要になったら削除してください。';
const RATE_LIMIT_MESSAGE =
  '操作が集中しています。しばらく待ってから再度お試しください。';

const OPENER = '確認を開く';

type ConfirmMock = ReturnType<
  typeof vi.fn<(target: ApiKeyConfirmTarget) => Promise<void>>
>;

interface HarnessProps {
  readonly target: ApiKeyConfirmTarget;
  readonly onConfirm: ConfirmMock;
  readonly onClose?: () => void;
}

function Harness({ target, onConfirm, onClose }: HarnessProps) {
  const [current, setCurrent] = useState<ApiKeyConfirmTarget | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <main className="bg-background p-4 text-foreground">
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setCurrent(target);
          }}
        >
          {OPENER}
        </button>
        <ApiKeyConfirmDialog
          target={current}
          onClose={() => {
            onClose?.();
            setCurrent(null);
          }}
          returnFocusRef={openerRef}
          onConfirm={onConfirm}
        />
      </main>
      <Toaster />
    </>
  );
}

const resolvingConfirm = (): ConfirmMock => vi.fn(() => Promise.resolve());

const dialog = () => page.getByRole('dialog');

const dialogButton = (name: string) =>
  dialog().getByRole('button', { name, exact: true });

const openDialog = async (
  target: ApiKeyConfirmTarget,
  onConfirm: ConfirmMock = resolvingConfirm(),
  onClose?: () => void,
): Promise<ConfirmMock> => {
  await render(
    <Harness target={target} onConfirm={onConfirm} onClose={onClose} />,
  );
  await userEvent.click(page.getByRole('button', { name: OPENER }));
  await expect.element(dialog()).toBeVisible();
  return onConfirm;
};

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('削除の確認', () => {
  test('対象の名前を入れた題名と結果の説明、「キャンセル」「削除」を示す', async () => {
    await openDialog(DELETE_TARGET);

    await expect
      .element(dialog().getByRole('heading', { name: DELETE_TITLE }))
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(DELETE_DESCRIPTION);
    await expect.element(dialogButton('キャンセル')).toBeVisible();
    await expect.element(dialogButton('削除')).toBeVisible();
  });

  test('「削除」を押すと対象を渡して確定し、閉じて開いた元へフォーカスを戻す', async () => {
    const onConfirm = await openDialog(DELETE_TARGET);

    await userEvent.click(dialogButton('削除'));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(DELETE_TARGET);
    await expect
      .element(page.getByRole('button', { name: OPENER }))
      .toHaveFocus();
  });
});

describe('再発行の確認', () => {
  test('対象の名前を入れた題名と、追加で発行し今のキーはそのまま使え不要なら削除する旨、「キャンセル」「再発行」を示す', async () => {
    await openDialog(REISSUE_TARGET);

    await expect
      .element(dialog().getByRole('heading', { name: REISSUE_TITLE }))
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(REISSUE_DESCRIPTION);
    await expect.element(dialogButton('キャンセル')).toBeVisible();
    await expect.element(dialogButton('再発行')).toBeVisible();
  });

  test('「再発行」を押すと対象を渡して確定し、閉じる', async () => {
    const onConfirm = await openDialog(REISSUE_TARGET);

    await userEvent.click(dialogButton('再発行'));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(REISSUE_TARGET);
  });
});

describe('取り消し', () => {
  test('「キャンセル」で確定せずに閉じ、開いた元へフォーカスを戻す', async () => {
    const onConfirm = await openDialog(DELETE_TARGET);

    await userEvent.click(dialogButton('キャンセル'));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole('button', { name: OPENER }))
      .toHaveFocus();
  });

  test('閉じる動きの間も題名を保つ', async () => {
    await openDialog(REISSUE_TARGET);

    await userEvent.click(dialogButton('キャンセル'));

    const element = document.querySelector('[role="dialog"]');
    if (!(element instanceof HTMLElement)) {
      throw new Error('閉じる途中のダイアログがありません。');
    }
    expect(element.dataset.state).toBe('closed');
    expect(element.querySelector('h2')?.textContent).toBe(REISSUE_TITLE);
    await expect.element(dialog()).not.toBeInTheDocument();
  });
});

describe('確定の処理中', () => {
  const startPendingDelete = async () => {
    const pending = deferred();
    const onConfirm = resolvingConfirm();
    onConfirm.mockReturnValueOnce(pending.promise);
    const onClose = vi.fn();
    await openDialog(DELETE_TARGET, onConfirm, onClose);
    await userEvent.click(dialogButton('削除'));
    const busy = dialog().getByRole('button', { name: '送信中' });
    await expect.element(busy).toHaveAttribute('aria-busy', 'true');
    return { pending, onConfirm, onClose, busy };
  };

  const expectStillOpen = async (onClose: () => void): Promise<void> => {
    await expect.element(dialog()).toHaveAttribute('data-state', 'open');
    expect(onClose).not.toHaveBeenCalled();
  };

  test('確定のボタンを送信中にし、キャンセルと右上の「閉じる」を押せなくする', async () => {
    const { busy } = await startPendingDelete();

    await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(dialogButton('キャンセル'))
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(dialogButton('閉じる')).toBeDisabled();
  });

  test('Escapeでは閉じない', async () => {
    const { onClose } = await startPendingDelete();

    await userEvent.keyboard('{Escape}');

    await expectStillOpen(onClose);
  });

  test('「キャンセル」をキーボードで押しても閉じない', async () => {
    const { onClose } = await startPendingDelete();

    dialogButton('キャンセル').element().focus();
    await userEvent.keyboard('{Enter}');

    await expectStillOpen(onClose);
  });

  test('外を押しても閉じず、フォーカスをダイアログの中に保つ', async () => {
    const { onClose } = await startPendingDelete();

    await userEvent.click(document.body, { position: { x: 4, y: 4 } });

    await expectStillOpen(onClose);
    await expect
      .poll(() => dialog().element().contains(document.activeElement))
      .toBe(true);
  });

  test('重ねて押しても確定は1回だけで、終わると閉じる', async () => {
    const { pending, onConfirm, onClose, busy } = await startPendingDelete();

    await userEvent.click(busy, { force: true });
    expect(onConfirm).toHaveBeenCalledOnce();
    pending.resolve();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('確定の失敗', () => {
  test('再発行の回数の上限(429)は、閉じてレート制限の文言をトーストで示す', async () => {
    const onConfirm = resolvingConfirm();
    onConfirm.mockRejectedValueOnce(
      new GraphQLClientError({
        code: 'rate_limit_exceeded',
        message: '操作が集中しています。',
        status: 429,
      }),
    );
    await openDialog(REISSUE_TARGET, onConfirm);

    await userEvent.click(dialogButton('再発行'));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(page.getByText(RATE_LIMIT_MESSAGE)).toBeVisible();
  });

  test('その他の想定内の失敗は、閉じてエラーの文言をトーストで示す', async () => {
    const onConfirm = resolvingConfirm();
    onConfirm.mockRejectedValueOnce(
      new GraphQLClientError({
        code: 'account_unavailable',
        message: 'このアカウントは利用できません。',
        status: 403,
      }),
    );
    await openDialog(DELETE_TARGET, onConfirm);

    await userEvent.click(dialogButton('削除'));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByText('このアカウントは利用できません。'))
      .toBeVisible();
  });

  test('想定外の失敗は、閉じて問い合わせの案内を含む文言をトーストで示す', async () => {
    const onConfirm = resolvingConfirm();
    onConfirm.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await openDialog(DELETE_TARGET, onConfirm);

    await userEvent.click(dialogButton('削除'));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByText(UNEXPECTED_ERROR_MESSAGE))
      .toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('削除の確認のアクセシビリティの違反が0件', async () => {
    applyColorScheme(scheme);
    await openDialog(DELETE_TARGET);

    expect(await runAxe(dialog().element())).toEqual([]);
  });

  test('再発行の確認のアクセシビリティの違反が0件', async () => {
    applyColorScheme(scheme);
    await openDialog(REISSUE_TARGET);

    expect(await runAxe(dialog().element())).toEqual([]);
  });
});
