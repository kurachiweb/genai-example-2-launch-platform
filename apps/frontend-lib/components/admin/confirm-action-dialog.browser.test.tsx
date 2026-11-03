import { type RefObject, useRef, useState } from 'react';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { GraphQLClientError } from '../../utilities/graphql/graphql-result.ts';
import {
  AUDITED_ACTION_NOTICE,
  REASON_PERSONAL_INFORMATION_NOTICE,
  REASON_TOO_LONG_MESSAGE,
} from '../../utilities/messages/admin-console-messages.ts';
import {
  ConfirmActionDialog,
  type ConfirmActionDialogProps,
} from './confirm-action-dialog.tsx';

const OPENER = '削除する';

const TITLE = '管理者「サンプル管理者」を削除しますか?';

const DESCRIPTION = '削除した管理者はログインできなくなります。';

const CONFIRM_LABEL = '削除';

const FAILURE_MESSAGE = 'この操作を行う権限がありません。';

const AFTER_ACTION = '一覧へ戻る';

type OnConfirm = ConfirmActionDialogProps['onConfirm'];

interface HarnessProps {
  readonly reason: ConfirmActionDialogProps['reason'];
  readonly audited?: boolean;
  readonly onConfirm: Mock<OnConfirm>;
  readonly failureMessageOf?: Mock<(error: unknown) => string>;
  readonly withReturnFocus?: boolean;
}

function Harness({
  reason,
  audited = true,
  onConfirm,
  failureMessageOf = vi.fn(() => FAILURE_MESSAGE),
  withReturnFocus = false,
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  const afterRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef: RefObject<HTMLElement | null> | undefined =
    withReturnFocus ? afterRef : undefined;
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {OPENER}
      </button>
      <button ref={afterRef} type="button">
        {AFTER_ACTION}
      </button>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={TITLE}
        description={DESCRIPTION}
        confirmLabel={CONFIRM_LABEL}
        reason={reason}
        audited={audited}
        onConfirm={onConfirm}
        failureMessageOf={failureMessageOf}
        returnFocusRef={returnFocusRef}
      />
    </div>
  );
}

const dialog = () => page.getByRole('dialog', { name: TITLE });

const confirmButton = () =>
  dialog().getByRole('button', { name: CONFIRM_LABEL, exact: true });

const cancelButton = () =>
  dialog().getByRole('button', { name: 'キャンセル', exact: true });

const closeButton = () =>
  dialog().getByRole('button', { name: '閉じる', exact: true });

const overlay = () =>
  page.elementLocator(
    document.querySelector('[data-slot="dialog-overlay"]') ?? document.body,
  );

const reasonBox = (name: string) =>
  dialog().getByRole('textbox', { name, exact: true });

const openDialog = async (): Promise<void> => {
  await page.getByRole('button', { name: OPENER, exact: true }).click();
  await expect.element(dialog()).toBeVisible();
};

const deferred = () => {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const confirmMock = (): Mock<OnConfirm> =>
  vi.fn<OnConfirm>(() => Promise.resolve());

afterEach(() => {
  applyColorScheme('light');
});

describe('ConfirmActionDialog', () => {
  test('題名と説明を持つダイアログを開き、確定のボタンに操作名を示す', async () => {
    await render(<Harness reason="none" onConfirm={confirmMock()} />);

    await openDialog();

    await expect.element(dialog()).toHaveAccessibleDescription(DESCRIPTION);
    await expect.element(confirmButton()).toBeVisible();
    await expect.element(cancelButton()).toBeVisible();
  });

  describe('理由が必須のとき', () => {
    test('理由が空・空白だけの間は確定できず、入力すると前後の空白を除いた理由で確定する', async () => {
      const onConfirm = confirmMock();
      await render(<Harness reason="required" onConfirm={onConfirm} />);
      await openDialog();
      const box = reasonBox('理由(必須)');

      await expect.element(confirmButton()).toBeDisabled();
      await expect.element(confirmButton()).toHaveAttribute('disabled');
      await box.fill(' 　');
      await expect.element(confirmButton()).toBeDisabled();
      await expect.element(confirmButton()).toHaveAttribute('disabled');

      await box.fill('  規約に反する投稿を繰り返したため \n');
      await expect.element(confirmButton()).toBeEnabled();
      await confirmButton().click();

      expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
        reason: '規約に反する投稿を繰り返したため',
      });
      await expect.element(dialog()).not.toBeInTheDocument();
    });

    test('500文字を超えると、フォーカスを外した時点でエラーを示し、確定できない', async () => {
      const onConfirm = confirmMock();
      await render(<Harness reason="required" onConfirm={onConfirm} />);
      await openDialog();
      const box = reasonBox('理由(必須)');

      await box.fill('あ'.repeat(501));
      expect(
        dialog().getByText(REASON_TOO_LONG_MESSAGE).elements(),
      ).toHaveLength(0);
      await userEvent.tab();

      await expect
        .element(dialog().getByText(REASON_TOO_LONG_MESSAGE))
        .toBeVisible();
      await expect.element(box).toHaveAttribute('aria-invalid', 'true');
      await expect.element(confirmButton()).toBeDisabled();
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  test('理由が任意のときは、空のまま確定でき、理由を渡さない', async () => {
    const onConfirm = confirmMock();
    await render(<Harness reason="optional" onConfirm={onConfirm} />);
    await openDialog();

    await expect.element(reasonBox('理由(任意)')).toHaveValue('');
    await confirmButton().click();

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ reason: undefined });
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  test('理由を受け付けない操作は、理由の欄と個人情報の注意を描かず、理由を渡さずに確定する', async () => {
    const onConfirm = confirmMock();
    await render(<Harness reason="none" onConfirm={onConfirm} />);
    await openDialog();

    expect(dialog().getByRole('textbox').elements()).toHaveLength(0);
    expect(
      dialog().getByText(REASON_PERSONAL_INFORMATION_NOTICE).elements(),
    ).toHaveLength(0);
    await confirmButton().click();

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ reason: undefined });
  });

  test('理由の欄の近くに、個人情報を含めない旨を表示する', async () => {
    await render(<Harness reason="optional" onConfirm={confirmMock()} />);
    await openDialog();

    await expect
      .element(dialog().getByText(REASON_PERSONAL_INFORMATION_NOTICE))
      .toBeVisible();
    await expect
      .element(reasonBox('理由(任意)'))
      .toHaveAccessibleDescription(REASON_PERSONAL_INFORMATION_NOTICE);
  });

  test.each([
    [true, 1],
    [false, 0],
  ] as const)(
    '監査ログに記録する操作(%s)だけ、記録される旨を表示する',
    async (audited, count) => {
      await render(
        <Harness reason="none" audited={audited} onConfirm={confirmMock()} />,
      );
      await openDialog();

      expect(dialog().getByText(AUDITED_ACTION_NOTICE).elements()).toHaveLength(
        count,
      );
    },
  );

  test('確定に失敗すると、ダイアログを開いたまま理由の入力を保ち、呼び出す側が選んだ文言をダイアログの中に示す', async () => {
    const error = new GraphQLClientError({
      code: 'forbidden',
      message: 'forbidden',
      status: 403,
    });
    const onConfirm = vi.fn<OnConfirm>(() => Promise.reject(error));
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await render(
      <Harness
        reason="required"
        onConfirm={onConfirm}
        failureMessageOf={failureMessageOf}
      />,
    );
    await openDialog();
    await reasonBox('理由(必須)').fill('重複した管理者のため');

    await confirmButton().click();

    const alert = dialog().getByRole('alert');
    await expect.element(alert).toHaveTextContent(FAILURE_MESSAGE);
    expect(failureMessageOf).toHaveBeenCalledExactlyOnceWith(error);
    await expect.element(dialog()).toBeVisible();
    await expect
      .element(reasonBox('理由(必須)'))
      .toHaveValue('重複した管理者のため');
    await expect.element(confirmButton()).toBeEnabled();
    await expect.element(confirmButton()).toHaveFocus();
  });

  test('サーバーが理由の欄の違反を返すと、ダイアログを開いたまま欄のエラーとして示す', async () => {
    const error = new GraphQLClientError({
      code: 'validation_error',
      message: 'validation_error',
      status: 400,
      details: [
        {
          field: 'reason',
          code: 'reason_required',
          message: '理由を入力してください。',
        },
      ],
    });
    const failureMessageOf = vi.fn(() => FAILURE_MESSAGE);
    await render(
      <Harness
        reason="optional"
        onConfirm={vi.fn<OnConfirm>(() => Promise.reject(error))}
        failureMessageOf={failureMessageOf}
      />,
    );
    await openDialog();

    await confirmButton().click();

    await expect
      .element(reasonBox('理由(任意)'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect.element(reasonBox('理由(任意)')).toHaveFocus();
    await expect
      .element(dialog().getByText('理由を入力してください。'))
      .toBeVisible();
    expect(failureMessageOf).not.toHaveBeenCalled();
  });

  test('失敗の後にもう一度確定すると、前の失敗の文言を消して確定し直す', async () => {
    const onConfirm = vi
      .fn<OnConfirm>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    await render(<Harness reason="optional" onConfirm={onConfirm} />);
    await openDialog();

    await confirmButton().click();
    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await confirmButton().click();

    expect(onConfirm).toHaveBeenCalledTimes(2);
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  test('確定の処理中は、確定のボタンにフォーカスを保ったまま処理中を示し、右上の「閉じる」を無効にし、取り消し・Escape・ダイアログの外の押下では閉じない', async () => {
    const pending = deferred();
    const onConfirm = vi.fn<OnConfirm>(() => pending.promise);
    await render(<Harness reason="optional" onConfirm={onConfirm} />);
    await openDialog();

    await confirmButton().click();

    const busyButton = dialog().getByRole('button', { name: '送信中' });
    await expect.element(busyButton).toHaveAttribute('aria-busy', 'true');
    await expect.element(busyButton).toHaveAttribute('aria-disabled', 'true');
    await expect.element(busyButton).toHaveFocus();
    await expect
      .element(cancelButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(cancelButton()).not.toHaveAttribute('disabled');
    await expect.element(closeButton()).toHaveAttribute('disabled');
    await userEvent.keyboard('{Escape}');
    await cancelButton().click({ force: true });
    await userEvent.click(overlay(), { position: { x: 4, y: 4 } });
    await expect.element(dialog()).toBeVisible();
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog().element().contains(document.activeElement)).toBe(true);

    pending.resolve();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test('取り消すと確定せずに閉じ、開いた元へフォーカスを戻し、開き直すと理由の入力を始め直す', async () => {
    const onConfirm = confirmMock();
    await render(<Harness reason="optional" onConfirm={onConfirm} />);
    await openDialog();
    await reasonBox('理由(任意)').fill('入力の途中');

    await cancelButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: OPENER, exact: true }))
      .toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
    await openDialog();
    await expect.element(reasonBox('理由(任意)')).toHaveValue('');
  });

  test('戻り先を渡すと、確定して閉じた後にその要素へフォーカスを移す', async () => {
    await render(
      <Harness reason="none" onConfirm={confirmMock()} withReturnFocus />,
    );
    await openDialog();

    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: AFTER_ACTION }))
      .toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('理由の欄と監査ログの表示を持つ開いたダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<Harness reason="required" onConfirm={confirmMock()} />);
      await openDialog();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('確定の失敗と理由のエラーを表示したダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(
        <Harness
          reason="optional"
          onConfirm={vi.fn<OnConfirm>(() =>
            Promise.reject(new Error('network')),
          )}
        />,
      );
      await openDialog();
      await confirmButton().click();
      await expect.element(dialog().getByRole('alert')).toBeVisible();
      await reasonBox('理由(任意)').fill('あ'.repeat(501));
      await userEvent.tab();
      await expect
        .element(dialog().getByText(REASON_TOO_LONG_MESSAGE))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
