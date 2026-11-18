import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  PAUSED_PREVIEW,
  PAUSED_ROW,
  respondAdminSponsorshipsGraphQL,
  respondPreview,
  SCHEDULED_ROW,
  sponsorshipsQueryOf,
  type TerminateHandler,
  terminateVariablesOf,
  terminationResultOf,
  type TerminationPreviewHandler,
} from '../../../test/admin-sponsorships-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  type AdminSponsorshipTerminationResult,
  adminSponsorshipsQueryOptions,
} from '../../graphql/admin-sponsorships.ts';
import { AdminSponsorshipTerminationPreviewDocument } from '../../graphql/generated/graphql.ts';
import { TerminateSponsorshipDialog } from './terminate-sponsorship-dialog.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const OPENER = '強制終了の確認を開く';

const TITLE = 'スポンサー広告の強制終了';

const CONFIRM_LABEL = '強制終了する';

const REASON_LABEL = '理由(必須)';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const REASON_TOO_LONG_MESSAGE = '理由は500文字以内で入力してください。';

const PAUSED_DESCRIPTION =
  '未掲載日数5日・返金目安額$50.00(支払った金額$210.00・21日間)。これまでの表示停止3日分$30.00。強制終了を確定すると、これらの金額が自動で返金されます。';

const SCHEDULED_DESCRIPTION =
  '未掲載日数7日・返金目安額$70.00(支払った金額$70.00・7日間)。強制終了を確定すると、これらの金額が自動で返金されます。';

const NOT_TERMINABLE_MESSAGE =
  'この広告は強制終了できません。一覧を再読み込みしてください。';

const REASON = '虚偽の広告表示が確認されたため';

const TOKYO: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

const LIST_VARIABLES = Object.freeze({ filter: {}, first: 50 });

const usd = (amount: number) => ({ amount, currency: 'USD' });

interface HarnessProps {
  readonly sponsorshipId: string;
  readonly onTerminated: (result: AdminSponsorshipTerminationResult) => void;
  readonly onNotTerminable: () => void;
}

function Harness({
  sponsorshipId,
  onTerminated,
  onNotTerminable,
}: HarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <DisplayPreferencesProvider initial={TOKYO}>
      <main className="p-4">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          {OPENER}
        </button>
        <TerminateSponsorshipDialog
          sponsorshipId={sponsorshipId}
          open={open}
          onOpenChange={setOpen}
          onTerminated={onTerminated}
          onNotTerminable={onNotTerminable}
        />
      </main>
    </DisplayPreferencesProvider>
  );
}

const renderDialog = async ({
  sponsorshipId = PAUSED_ROW.id,
  preview = respondPreview,
  terminate,
}: {
  readonly sponsorshipId?: string;
  readonly preview?: TerminationPreviewHandler;
  readonly terminate?: TerminateHandler;
} = {}) => {
  respondAdminSponsorshipsGraphQL(executeGraphQL, {
    role: 'MODERATOR',
    preview,
    ...(terminate === undefined ? {} : { terminate }),
  });
  const onTerminated =
    vi.fn<(result: AdminSponsorshipTerminationResult) => void>();
  const onNotTerminable = vi.fn<() => void>();
  const router = await renderInRouter(
    <Harness
      sponsorshipId={sponsorshipId}
      onTerminated={onTerminated}
      onNotTerminable={onNotTerminable}
    />,
  );
  const { queryClient } = router.options.context;
  const { queryKey } = adminSponsorshipsQueryOptions(LIST_VARIABLES);
  queryClient.setQueryData(queryKey, sponsorshipsQueryOf([PAUSED_ROW]));
  return {
    onTerminated,
    onNotTerminable,
    listInvalidated: () =>
      queryClient.getQueryState(queryKey)?.isInvalidated ?? false,
  };
};

const dialog = () => page.getByRole('dialog', { name: TITLE });
const confirmButton = () =>
  dialog().getByRole('button', { name: CONFIRM_LABEL, exact: true });
const reasonBox = () =>
  dialog().getByRole('textbox', { name: REASON_LABEL, exact: true });

const openDialog = async (): Promise<void> => {
  await page.getByRole('button', { name: OPENER, exact: true }).click();
  await expect.element(dialog()).toBeVisible();
};

const previewVariables = () =>
  executeGraphQL.mock.calls
    .filter(
      ([document]) => document === AdminSponsorshipTerminationPreviewDocument,
    )
    .map(([, variables]) => variables as unknown);

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('確認の内容', () => {
  test('開くと申込IDで照会を読み、未掲載日数・返金目安額(支払った金額と掲載期間の日数)・これまでの表示停止の日数と返金額と、確定で自動的に返金される旨を説明に示し、理由(必須)の欄と監査ログの注記と「強制終了する」を置く', async () => {
    await renderDialog();

    expect(previewVariables()).toStrictEqual([]);
    await openDialog();

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);
    expect(previewVariables()).toStrictEqual([{ id: PAUSED_ROW.id }]);
    await expect.element(reasonBox()).toBeVisible();
    await expect.element(dialog().getByText(AUDITED_NOTICE)).toBeVisible();
    await expect.element(confirmButton()).toBeVisible();
  });

  test('強制終了日より前の表示停止が無ければ、表示停止の日数と返金額を示さない', async () => {
    await renderDialog({ sponsorshipId: SCHEDULED_ROW.id });

    await openDialog();

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(SCHEDULED_DESCRIPTION);
  });

  test('照会を読み込む間は読み込み中を示し、理由を入力しても確定できず、読み込むと確定できる', async () => {
    const pending = deferred<unknown>();
    await renderDialog({ preview: () => pending.promise });

    await openDialog();
    await expect.element(dialog()).toHaveAccessibleDescription('読み込み中');
    await reasonBox().fill(REASON);
    await expect.element(confirmButton()).toBeDisabled();

    pending.resolve({
      ok: true,
      data: { sponsorshipTerminationPreview: PAUSED_PREVIEW },
    });

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);
    await expect.element(confirmButton()).toBeEnabled();
  });

  test('照会に失敗すると、説明の位置に管理者側の失敗の文言を示し、確定できない', async () => {
    await renderDialog({
      preview: () =>
        failure({
          code: 'internal_error',
          message: '処理中に問題が発生しました。',
          status: 500,
        }),
    });

    await openDialog();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    await reasonBox().fill(REASON);
    await expect.element(confirmButton()).toBeDisabled();
  });

  test('照会の`GraphQLClientError`でない例外は、問い合わせを促さない文言を示す', async () => {
    await renderDialog({
      preview: () => Promise.reject(new Error('network down')),
    });

    await openDialog();

    const alert = dialog().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    await expect.element(alert).not.toHaveTextContent('問い合わせ');
  });

  test('閉じてすぐに開き直しても照会を読み直し、最新の日数と金額を示す', async () => {
    let refreshed = false;
    await renderDialog({
      preview: () =>
        success({
          sponsorshipTerminationPreview: refreshed
            ? { ...PAUSED_PREVIEW, stoppedDays: 4, stopRefundAmount: usd(4000) }
            : PAUSED_PREVIEW,
        }),
    });
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);
    await dialog()
      .getByRole('button', { name: 'キャンセル', exact: true })
      .click();
    await expect.element(dialog()).not.toBeInTheDocument();
    refreshed = true;

    await openDialog();

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        '未掲載日数5日・返金目安額$50.00(支払った金額$210.00・21日間)。これまでの表示停止4日分$40.00。強制終了を確定すると、これらの金額が自動で返金されます。',
      );
    expect(previewVariables()).toStrictEqual([
      { id: PAUSED_ROW.id },
      { id: PAUSED_ROW.id },
    ]);
  });

  test('照会で強制終了できない広告と分かると、ダイアログの中に文言を示して確定できず、一覧の取得を無効にして知らせる', async () => {
    const { onNotTerminable, listInvalidated } = await renderDialog({
      preview: () =>
        failure({
          code: 'sponsorship_not_terminable',
          message: NOT_TERMINABLE_MESSAGE,
          status: 409,
        }),
    });

    await openDialog();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(NOT_TERMINABLE_MESSAGE);
    await reasonBox().fill(REASON);
    await expect.element(confirmButton()).toBeDisabled();
    await expect.poll(listInvalidated).toBe(true);
    expect(onNotTerminable).toHaveBeenCalledOnce();
  });
});

describe('理由の入力', () => {
  test('理由が空・空白だけの間は確定できない', async () => {
    await renderDialog();
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);

    await expect.element(confirmButton()).toBeDisabled();
    await reasonBox().fill(' 　');
    await expect.element(confirmButton()).toBeDisabled();
  });

  test('500文字を超えると理由の欄にエラーを示して確定できず、500文字なら確定できる', async () => {
    await renderDialog();
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);

    await reasonBox().fill('あ'.repeat(501));
    await userEvent.tab();

    await expect
      .element(dialog().getByText(REASON_TOO_LONG_MESSAGE))
      .toBeVisible();
    await expect.element(reasonBox()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(confirmButton()).toBeDisabled();

    await reasonBox().fill('あ'.repeat(500));
    await expect.element(confirmButton()).toBeEnabled();
  });
});

describe('確定', () => {
  test('確定すると申込IDと前後の空白を除いた理由で強制終了し、結果を渡して閉じ、一覧の取得を無効にする', async () => {
    const result = terminationResultOf();
    const { onTerminated, onNotTerminable, listInvalidated } =
      await renderDialog({
        terminate: () => success({ terminateSponsorship: result }),
      });
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);

    await reasonBox().fill(`  ${REASON} \n`);
    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(terminateVariablesOf(executeGraphQL)).toStrictEqual([
      { id: PAUSED_ROW.id, reason: REASON },
    ]);
    expect(onTerminated).toHaveBeenCalledExactlyOnceWith(result);
    await expect.poll(listInvalidated).toBe(true);
    expect(onNotTerminable).not.toHaveBeenCalled();
  });

  test('強制終了できない広告は、ダイアログの中に強制終了できない旨を示して理由の入力を保ち、一覧の取得を無効にして知らせる', async () => {
    const { onTerminated, onNotTerminable, listInvalidated } =
      await renderDialog({
        terminate: () =>
          failure({
            code: 'sponsorship_not_terminable',
            message: NOT_TERMINABLE_MESSAGE,
            status: 409,
          }),
      });
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);

    await reasonBox().fill(REASON);
    await confirmButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(NOT_TERMINABLE_MESSAGE);
    await expect.element(reasonBox()).toHaveValue(REASON);
    await expect.poll(listInvalidated).toBe(true);
    expect(onNotTerminable).toHaveBeenCalledOnce();
    expect(onTerminated).not.toHaveBeenCalled();
  });

  test('確定の`GraphQLClientError`でない例外は、問い合わせを促さない文言をダイアログの中に示し、一覧を取り直さない', async () => {
    const { onTerminated, onNotTerminable, listInvalidated } =
      await renderDialog({
        terminate: () => Promise.reject(new Error('network down')),
      });
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);

    await reasonBox().fill(REASON);
    await confirmButton().click();

    const alert = dialog().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    await expect.element(alert).not.toHaveTextContent('問い合わせ');
    await expect.element(alert).not.toHaveTextContent('network down');
    expect(listInvalidated()).toBe(false);
    expect(onNotTerminable).not.toHaveBeenCalled();
    expect(onTerminated).not.toHaveBeenCalled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('照会を読み込んだダイアログで、アクセシビリティの検査の違反が0件', async () => {
    await renderDialog();
    await openDialog();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(PAUSED_DESCRIPTION);
    applyColorScheme(scheme);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('照会の失敗を示したダイアログで、アクセシビリティの検査の違反が0件', async () => {
    await renderDialog({
      preview: () =>
        failure({
          code: 'internal_error',
          message: '処理中に問題が発生しました。',
          status: 500,
        }),
    });
    await openDialog();
    await expect.element(dialog().getByRole('alert')).toBeVisible();
    applyColorScheme(scheme);

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
