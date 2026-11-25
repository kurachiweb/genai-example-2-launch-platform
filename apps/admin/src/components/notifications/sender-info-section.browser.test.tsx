import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import { watchAuditLogQueries } from '../../../test/audit-log-queries.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import {
  type AdminNotificationSenderInfoQuery,
  AdminNotificationSenderInfoDocument,
  type AdminRole,
  AdminUpdateNotificationSenderInfoDocument,
  type AdminUpdateNotificationSenderInfoMutationVariables,
} from '../../graphql/generated/graphql.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import { SenderInfoSection } from './sender-info-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

type SenderInfoState =
  AdminNotificationSenderInfoQuery['notificationSenderInfo'];

type StateHandler = () => Promise<unknown>;

type UpdateHandler = (
  variables: AdminUpdateNotificationSenderInfoMutationVariables,
) => Promise<unknown>;

const TITLE = '通知メールの送信者情報';

const DESCRIPTION =
  '全てのメールの末尾に表示します。各200文字以内で入力してください。';

const UNSET_WARNING =
  '送信者情報が未設定のため、通知メールを送信していません。';

const UPDATED_AT_LABEL = '最後に変更した日時';

const UPDATED_BY_LABEL = '変更した管理者';

const NONE_LABEL = 'なし';

const READ_ONLY_NOTICE = '最上位管理者だけが変更できます。';

const CONFIRM_TITLE = '通知メールの送信者情報を保存しますか?';

const CONFIRM_DESCRIPTION =
  '保存した内容は、以後に送る全てのメールの末尾に表示されます。';

const SAVED_MESSAGE = '送信者情報を保存しました。';

const CONFLICT_MESSAGE =
  '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。';

const REASON_GUIDANCE =
  '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。';

const CONTACT_PHRASE = 'お問い合わせ';

const SAVED_STATE: SenderInfoState = Object.freeze({
  info: Object.freeze({
    businessName: '運営事務局',
    contactEmail: 'support@launch.example',
    postalAddress: '東京都千代田区1-2-3',
  }),
  version: 2,
  updatedAt: '2026-11-05T01:02:03.000Z',
  updatedByNickname: '統括の担当',
});

const UNSET_STATE: SenderInfoState = Object.freeze({
  info: null,
  version: 0,
  updatedAt: null,
  updatedByNickname: null,
});

const UPDATED_STATE: SenderInfoState = Object.freeze({
  info: Object.freeze({
    businessName: '新しい運営事務局',
    contactEmail: 'contact@launch.example',
    postalAddress: '東京都港区4-5-6',
  }),
  version: 3,
  updatedAt: '2026-11-14T04:05:00.000Z',
  updatedByNickname: '運営の担当',
});

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const DISPLAY = Object.freeze({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });

const unexpectedOperation = (): never => {
  throw new Error('想定していない操作が実行されました。');
};

const stateOf =
  (state: SenderInfoState): StateHandler =>
  () =>
    success({ notificationSenderInfo: state });

const respond = (
  state: StateHandler,
  update: UpdateHandler = unexpectedOperation,
): void => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === AdminNotificationSenderInfoDocument) {
      return state();
    }
    if (document === AdminUpdateNotificationSenderInfoDocument) {
      return update(
        variables as AdminUpdateNotificationSenderInfoMutationVariables,
      );
    }
    return unexpectedOperation();
  });
};

const validationError = (
  details: readonly { field: string; code: string; message: string }[],
) =>
  failure({
    code: 'validation_error',
    message: VALIDATION_MESSAGE,
    status: 400,
    details,
  });

// 設定ページが包むのと同じく区画のエラーの境界に包み、日時の部品のための表示設定とログイン中の管理者を外側に置く
async function renderSection(role: AdminRole = 'SUPER_ADMIN') {
  const viewer = toAdminViewer(adminWithRole(role));
  if (viewer === null) {
    throw new Error('ログイン中の管理者を作れませんでした。');
  }
  await render(<Toaster />);
  return renderInRouter(
    <DisplayPreferencesProvider initial={DISPLAY}>
      <AdminViewerProvider viewer={viewer}>
        <main className="p-4">
          <RecoverableSlot contactAvailable={false}>
            <SenderInfoSection />
          </RecoverableSlot>
        </main>
      </AdminViewerProvider>
    </DisplayPreferencesProvider>,
  );
}

const section = () => page.getByRole('region', { name: TITLE });
const businessNameInput = () =>
  page.getByRole('textbox', { name: '事業者名(必須)' });
const contactEmailInput = () =>
  page.getByRole('textbox', { name: '連絡先メールアドレス(必須)' });
const postalAddressInput = () =>
  page.getByRole('textbox', { name: '物理的郵送先住所(必須)' });
// ダイアログを開いている間は背後の区画がaria-hiddenになるため、隠れたままの送信中の保存のボタンを確かめる時に使う
const hiddenPendingSubmitButton = () =>
  page.getByRole('button', { name: '送信中', includeHidden: true });
const submitButton = () => section().getByRole('button', { name: '保存する' });
const dialog = () => page.getByRole('dialog');
const reasonField = () => dialog().getByRole('textbox', { name: '理由(任意)' });
const confirmButton = () =>
  dialog().getByRole('button', { name: '保存する', exact: true });
const cancelButton = () => dialog().getByRole('button', { name: 'キャンセル' });
const valueOf = (term: string) =>
  section().getByRole('term').filter({ hasText: term }).element()
    .nextElementSibling?.textContent;
const updatedAtTime = () =>
  section().element().querySelector('time')?.getAttribute('datetime');
const stateCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminNotificationSenderInfoDocument,
  );

const fillAndBlur = async (
  input: ReturnType<typeof businessNameInput>,
  value: string,
): Promise<void> => {
  await userEvent.fill(input, value);
  await userEvent.tab();
};

const openConfirmDialog = async (): Promise<void> => {
  await userEvent.click(submitButton());
  await expect
    .element(page.getByRole('dialog', { name: CONFIRM_TITLE }))
    .toBeVisible();
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await emulateBrowserDisplay(DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('現在の値と最後の変更', () => {
  test('見出しと説明の下に、現在の値の入った3つの欄と、最後に変更した日時と変更した管理者を表示し、未設定の警告を出さない', async () => {
    respond(stateOf(SAVED_STATE));
    await renderSection();

    await expect.element(businessNameInput()).toHaveValue('運営事務局');
    await expect
      .element(contactEmailInput())
      .toHaveValue('support@launch.example');
    await expect
      .element(postalAddressInput())
      .toHaveValue('東京都千代田区1-2-3');
    await expect
      .element(section().getByRole('heading', { level: 2, name: TITLE }))
      .toBeVisible();
    await expect.element(section().getByText(DESCRIPTION)).toBeVisible();
    expect(valueOf(UPDATED_AT_LABEL)).toContain('2026年11月5日');
    expect(updatedAtTime()).toBe(SAVED_STATE.updatedAt);
    expect(valueOf(UPDATED_BY_LABEL)).toBe('統括の担当');
    expect(section().getByText(UNSET_WARNING).query()).toBeNull();
  });

  test('未設定(版0)は、見出しの下に通知メールを送っていない旨の警告を示し、空の欄と、日時と管理者の「なし」を表示する', async () => {
    respond(stateOf(UNSET_STATE));
    await renderSection();

    await expect
      .element(section().getByRole('note'))
      .toHaveTextContent(UNSET_WARNING);
    await expect.element(businessNameInput()).toHaveValue('');
    await expect.element(contactEmailInput()).toHaveValue('');
    await expect.element(postalAddressInput()).toHaveValue('');
    expect(valueOf(UPDATED_AT_LABEL)).toBe(NONE_LABEL);
    expect(valueOf(UPDATED_BY_LABEL)).toBe(NONE_LABEL);
    expect(section().element().querySelector('time')).toBeNull();
  });

  test('ニックネームを得られない管理者が保存した送信者情報は、日時を表示し、管理者を「なし」にする', async () => {
    respond(stateOf({ ...SAVED_STATE, updatedByNickname: null }));
    await renderSection();

    await expect.element(businessNameInput()).toHaveValue('運営事務局');
    expect(updatedAtTime()).toBe(SAVED_STATE.updatedAt);
    expect(valueOf(UPDATED_BY_LABEL)).toBe(NONE_LABEL);
  });
});

describe('ロールによる出し分け', () => {
  test.each<AdminRole>(['VIEWER', 'MODERATOR'])(
    '%sには欄と保存のボタンを出さずに現在の値を参照だけで示し、最上位管理者だけが変更できる旨を添える',
    async (role) => {
      respond(stateOf(SAVED_STATE));
      await renderSection(role);

      await expect.element(section().getByText(READ_ONLY_NOTICE)).toBeVisible();
      expect(valueOf('事業者名')).toBe('運営事務局');
      expect(valueOf('連絡先メールアドレス')).toBe('support@launch.example');
      expect(valueOf('物理的郵送先住所')).toBe('東京都千代田区1-2-3');
      expect(valueOf(UPDATED_BY_LABEL)).toBe('統括の担当');
      expect(section().getByRole('textbox').elements()).toHaveLength(0);
      expect(section().getByRole('button').elements()).toHaveLength(0);
    },
  );

  test('未設定の時の参照だけの区画は、警告と最上位管理者だけが変更できる旨を示す', async () => {
    respond(stateOf(UNSET_STATE));
    await renderSection('VIEWER');

    await expect
      .element(section().getByRole('note'))
      .toHaveTextContent(UNSET_WARNING);
    await expect.element(section().getByText(READ_ONLY_NOTICE)).toBeVisible();
    expect(valueOf(UPDATED_AT_LABEL)).toBe(NONE_LABEL);
    expect(section().getByRole('textbox').elements()).toHaveLength(0);
  });

  test('最上位管理者には必須の3つの欄と保存のボタンを出し、参照だけの案内を出さない', async () => {
    respond(stateOf(SAVED_STATE));
    await renderSection('SUPER_ADMIN');

    await expect.element(businessNameInput()).toBeEnabled();
    for (const input of [
      businessNameInput,
      contactEmailInput,
      postalAddressInput,
    ]) {
      await expect.element(input()).toHaveAttribute('aria-required', 'true');
    }
    await expect.element(submitButton()).toBeEnabled();
    expect(section().getByText(READ_ONLY_NOTICE).query()).toBeNull();
  });
});

describe('項目ごとの検証', () => {
  test.each([
    ['事業者名', businessNameInput, '', '事業者名を入力してください。'],
    [
      '連絡先メールアドレス',
      contactEmailInput,
      '   ',
      '連絡先メールアドレスを入力してください。',
    ],
    [
      '物理的郵送先住所',
      postalAddressInput,
      'あ'.repeat(201),
      '物理的郵送先住所は200文字以内で入力してください。',
    ],
    [
      '連絡先メールアドレス',
      contactEmailInput,
      'support@@launch.example',
      'メールアドレスの形式が正しくありません。',
    ],
  ])(
    '%sの欄の違反(%#)を、フォーカスを外した時にその欄に示し、保存のボタンを無効にする',
    async (_label, input, value, message) => {
      respond(stateOf(SAVED_STATE));
      await renderSection();
      await expect.element(input()).toBeEnabled();

      await fillAndBlur(input(), value);

      await expect.element(input()).toHaveAccessibleDescription(message);
      await expect.element(input()).toHaveAttribute('aria-invalid', 'true');
      await expect.element(submitButton()).toBeDisabled();
    },
  );

  test('前後に空白のある正しい形式の連絡先メールアドレスと200文字の項目は違反にしない', async () => {
    respond(stateOf(SAVED_STATE));
    await renderSection();
    await expect.element(contactEmailInput()).toBeEnabled();

    await fillAndBlur(contactEmailInput(), '  contact@launch.example  ');
    await fillAndBlur(businessNameInput(), 'あ'.repeat(200));

    await expect
      .element(contactEmailInput())
      .not.toHaveAttribute('aria-invalid');
    await expect
      .element(businessNameInput())
      .not.toHaveAttribute('aria-invalid');
    await expect.element(submitButton()).toBeEnabled();
  });
});

describe('保存', () => {
  test('保存のボタンで、理由(任意)と監査ログの注記を持つ確認のダイアログを開き、その間は入力欄のフォームを送信中のままにする', async () => {
    const update = vi.fn<UpdateHandler>();
    respond(stateOf(SAVED_STATE), update);
    await renderSection();
    await expect.element(submitButton()).toBeEnabled();

    await openConfirmDialog();

    await expect.element(dialog().getByText(CONFIRM_DESCRIPTION)).toBeVisible();
    await expect.element(reasonField()).toBeVisible();
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    await expect.element(confirmButton()).toBeVisible();
    await expect
      .element(hiddenPendingSubmitButton())
      .toHaveAttribute('aria-busy', 'true');
    expect(update).not.toHaveBeenCalled();
  });

  test('確認のダイアログの取り消しで、送らずに閉じ、入力欄のフォームを送信中から戻して保存のボタンへフォーカスを戻す', async () => {
    const update = vi.fn<UpdateHandler>();
    respond(stateOf(SAVED_STATE), update);
    await renderSection();
    await expect.element(submitButton()).toBeEnabled();

    await openConfirmDialog();
    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(submitButton()).not.toHaveAttribute('aria-busy');
    await expect.element(submitButton()).toBeEnabled();
    await expect.element(submitButton()).toHaveFocus();
    expect(update).not.toHaveBeenCalled();

    await openConfirmDialog();
    await expect.element(confirmButton()).toBeVisible();
  });

  test('確定で、前後の空白を除いた3項目・読み込んだ版・理由を送り、表示を保存の後の値に置き換えてトーストで知らせ、監査ログの照会を無効にする', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({ updateNotificationSenderInfo: UPDATED_STATE }),
    );
    respond(stateOf(SAVED_STATE), update);
    const router = await renderSection();
    const auditLogsInvalidated = watchAuditLogQueries(
      router.options.context.queryClient,
    );
    await expect.element(businessNameInput()).toBeEnabled();

    await userEvent.fill(businessNameInput(), ' 新しい運営事務局 ');
    await userEvent.fill(contactEmailInput(), 'contact@launch.example ');
    await userEvent.fill(postalAddressInput(), '東京都港区4-5-6');
    await openConfirmDialog();
    await userEvent.fill(reasonField(), '移転のため');
    await userEvent.click(confirmButton());

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toStrictEqual({
      input: {
        businessName: '新しい運営事務局',
        contactEmail: 'contact@launch.example',
        postalAddress: '東京都港区4-5-6',
        expectedVersion: 2,
        reason: '移転のため',
      },
    });
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(businessNameInput()).toHaveValue('新しい運営事務局');
    expect(updatedAtTime()).toBe(UPDATED_STATE.updatedAt);
    expect(valueOf(UPDATED_BY_LABEL)).toBe('運営の担当');
    await expect.element(submitButton()).not.toHaveAttribute('aria-busy');
    expect(stateCalls()).toHaveLength(1);
    expect(auditLogsInvalidated()).toBe(true);
  });

  test('未設定からの保存は版0を送り、理由が空なら送らず、未設定の警告を取り除く', async () => {
    const update = vi.fn<UpdateHandler>(() =>
      success({ updateNotificationSenderInfo: UPDATED_STATE }),
    );
    respond(stateOf(UNSET_STATE), update);
    await renderSection();
    await expect.element(businessNameInput()).toBeEnabled();

    await userEvent.fill(businessNameInput(), '新しい運営事務局');
    await userEvent.fill(contactEmailInput(), 'contact@launch.example');
    await userEvent.fill(postalAddressInput(), '東京都港区4-5-6');
    await openConfirmDialog();
    await userEvent.click(confirmButton());

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    const input = update.mock.calls[0]?.[0].input;
    expect(input).toMatchObject({ expectedVersion: 0 });
    expect(input?.reason ?? undefined).toBeUndefined();
    expect(section().getByRole('note').query()).toBeNull();
  });

  test('サーバーの項目の違反(validation_error)は、ダイアログを閉じて各欄に詳細を示し、最初の欄へフォーカスを移す', async () => {
    respond(stateOf(SAVED_STATE), () =>
      validationError([
        {
          field: 'input.contactEmail',
          code: 'invalid-email',
          message: 'メールアドレスの形式が正しくありません。',
        },
        {
          field: 'input.postalAddress',
          code: 'too-long',
          message: '物理的郵送先住所は200文字以内で入力してください。',
        },
      ]),
    );
    await renderSection();
    await expect.element(submitButton()).toBeEnabled();

    await openConfirmDialog();
    await userEvent.click(confirmButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(contactEmailInput())
      .toHaveAccessibleDescription('メールアドレスの形式が正しくありません。');
    await expect
      .element(postalAddressInput())
      .toHaveAccessibleDescription(
        '物理的郵送先住所は200文字以内で入力してください。',
      );
    await expect.element(contactEmailInput()).toHaveFocus();
    await expect.element(submitButton()).not.toHaveAttribute('aria-busy');
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test('理由の違反(input.reason)は、ダイアログを開いたまま理由の欄に詳細を示す', async () => {
    respond(stateOf(SAVED_STATE), () =>
      validationError([
        {
          field: 'input.reason',
          code: 'too_long',
          message: '理由は500文字以内で入力してください。',
        },
      ]),
    );
    await renderSection();
    await expect.element(submitButton()).toBeEnabled();

    await openConfirmDialog();
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton());

    await expect
      .element(reasonField())
      .toHaveAccessibleDescription(
        `${REASON_GUIDANCE} 理由は500文字以内で入力してください。`,
      );
    await expect
      .element(page.getByRole('dialog', { name: CONFIRM_TITLE }))
      .toBeVisible();
    await expect.element(reasonField()).toHaveValue('確認のため');
  });

  test('他の管理者が先に保存していた時は、理由の入力を保ったまま競合の文言をダイアログの中に示し、最新の値を読み直して、閉じた後に最新の値を見せ、監査ログの照会は無効にしない', async () => {
    let current: SenderInfoState = SAVED_STATE;
    const update = vi.fn<UpdateHandler>(() => {
      current = { ...UPDATED_STATE, updatedByNickname: '別の担当' };
      return failure({
        code: 'version_conflict',
        message: CONFLICT_MESSAGE,
        status: 409,
      });
    });
    respond(() => stateOf(current)(), update);
    const router = await renderSection();
    const auditLogsInvalidated = watchAuditLogQueries(
      router.options.context.queryClient,
    );
    await expect.element(businessNameInput()).toBeEnabled();

    await userEvent.fill(businessNameInput(), '手元の事業者名');
    await openConfirmDialog();
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    expect(dialog().getByRole('alert').element().textContent).toBe(
      CONFLICT_MESSAGE,
    );
    await expect.element(reasonField()).toHaveValue('確認のため');
    await expect.poll(() => stateCalls().length).toBe(2);
    await expect
      .element(hiddenPendingSubmitButton())
      .toHaveAttribute('aria-busy', 'true');
    await expect
      .element(
        page.getByRole('textbox', {
          name: '事業者名(必須)',
          includeHidden: true,
        }),
      )
      .toHaveValue('手元の事業者名');

    await userEvent.click(confirmButton());

    await expect.poll(() => update.mock.calls.length).toBe(2);
    expect(update.mock.calls[1]?.[0].input).toMatchObject({
      businessName: '手元の事業者名',
      expectedVersion: 2,
    });

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(businessNameInput()).toHaveValue('新しい運営事務局');
    expect(valueOf(UPDATED_BY_LABEL)).toBe('別の担当');
    await expect.element(submitButton()).not.toHaveAttribute('aria-busy');
    expect(auditLogsInvalidated()).toBe(false);
  });

  test('GraphQLClientErrorでない失敗は、理由の入力を保ったまま問い合わせを促す文を含まない文言をダイアログの中に示し、保存しない', async () => {
    respond(stateOf(SAVED_STATE), () =>
      Promise.reject(new Error('通信の失敗')),
    );
    await renderSection();
    await expect.element(submitButton()).toBeEnabled();

    await openConfirmDialog();
    await userEvent.fill(reasonField(), '確認のため');
    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(dialog().element().textContent).not.toContain(CONTACT_PHRASE);
    await expect.element(reasonField()).toHaveValue('確認のため');
    expect(stateCalls()).toHaveLength(1);
  });
});

describe('取得の失敗', () => {
  test('取得の失敗は区画の位置に問い合わせの導線の無い失敗と再試行で示し、再試行で区画を表示する', async () => {
    let available = false;
    respond(() =>
      available ? stateOf(SAVED_STATE)() : failure(INTERNAL_ERROR),
    );
    await renderSection();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(
      page.getByRole('button', { name: CONTACT_PHRASE }).elements(),
    ).toHaveLength(0);
    expect(document.body.textContent).not.toContain(CONTACT_PHRASE);
    expect(reportUnexpectedErrorInBrowser).not.toHaveBeenCalled();

    available = true;
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(businessNameInput()).toHaveValue('運営事務局');
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、編集できる区画と確認のダイアログがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(stateOf(SAVED_STATE));
      await renderSection();
      await expect.element(submitButton()).toBeEnabled();
      await fillAndBlur(contactEmailInput(), 'support@@launch.example');
      await expect
        .element(contactEmailInput())
        .toHaveAttribute('aria-invalid', 'true');

      expect(await runAxe(document.body)).toStrictEqual([]);

      await fillAndBlur(contactEmailInput(), 'support@launch.example');
      await openConfirmDialog();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、未設定の警告を持つ参照だけの区画がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(stateOf(UNSET_STATE));
      await renderSection('VIEWER');
      await expect.element(section().getByRole('note')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respond(() => failure(INTERNAL_ERROR));
      await renderSection();
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
