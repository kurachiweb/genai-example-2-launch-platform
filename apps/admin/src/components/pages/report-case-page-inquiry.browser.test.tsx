import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { watchAuditLogQueries } from '../../../test/audit-log-queries.ts';
import {
  MODERATION_DISPLAY,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  IN_PROGRESS_INFRINGEMENT_DETAIL,
  type ReportCaseDetailData,
  reportCaseDetailOf,
  renderReportCasePage,
  respondReportCaseGraphQL,
} from '../../../test/report-case-page-fixtures.ts';
import {
  REPORT_CASE_ID,
  type ReportingGraphQLHandler,
} from '../../../test/reporting-fixtures.ts';
import { AdminSendInfringementInquiryDocument } from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const INQUIRY_MESSAGE = '投稿の画像の権利について確認させてください';

const DIALOG_TITLE = '投稿者へ照会のメールを送りますか?';

const main = () => page.getByRole('main');
const inquirySection = () =>
  main().getByRole('region', { name: '権利侵害の照会', exact: true });
const sendButton = () =>
  inquirySection().getByRole('button', { name: '照会を送る', exact: true });
const dialog = () => page.getByRole('dialog');
const messageBox = () =>
  dialog().getByRole('textbox', { name: '照会の内容(必須)', exact: true });
const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(任意)', exact: true });
const confirmButton = () =>
  dialog().getByRole('button', { name: /照会を送る|送信中/ });
const cancelButton = () =>
  dialog().getByRole('button', { name: 'キャンセル', exact: true });

const renderWith = async ({
  detail = IN_PROGRESS_INFRINGEMENT_DETAIL,
  role = 'MODERATOR',
  handlers = new Map(),
}: {
  readonly detail?: ReportCaseDetailData;
  readonly role?: 'MODERATOR' | 'VIEWER';
  readonly handlers?: ReadonlyMap<unknown, ReportingGraphQLHandler>;
} = {}) => {
  const store = respondReportCaseGraphQL(executeGraphQL, {
    role,
    detail,
    handlers,
  });
  const router = await renderReportCasePage(role);
  await expect.element(inquirySection()).toBeVisible();
  return {
    store,
    auditLogsInvalidated: watchAuditLogQueries(
      router.options.context.queryClient,
    ),
  };
};

const openDialog = async () => {
  await sendButton().click();
  await expect
    .element(page.getByRole('dialog', { name: DIALOG_TITLE }))
    .toBeVisible();
};

const sentOutcome = () =>
  success({
    sendInfringementInquiry: {
      sentAt: '2026-11-03T00:00:00.000Z',
      deadline: '2026-11-10T00:00:00.000Z',
    },
  });

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('照会の操作', () => {
  test('権利侵害で対応中の案件で照会できる時だけ、モデレーター以上に照会の操作を置く', async () => {
    await renderWith();

    await expect.element(sendButton()).toBeVisible();
  });

  test.each([
    {
      name: '未対応の案件',
      detail: reportCaseDetailOf({ inquiryAvailable: false }),
    },
    {
      name: '完了した案件',
      detail: reportCaseDetailOf({
        case: { status: 'RESOLVED' },
        inquiryAvailable: false,
      }),
    },
    {
      name: '投稿者に送れない対応中の案件',
      detail: reportCaseDetailOf({
        case: { status: 'IN_PROGRESS' },
        inquiryAvailable: false,
      }),
    },
  ])('$nameには照会の操作を置かない', async ({ detail }) => {
    await renderWith({ detail });

    await expect.element(sendButton()).not.toBeInTheDocument();
  });

  test('閲覧のみの管理者には照会の操作を置かない', async () => {
    await renderWith({ role: 'VIEWER' });

    await expect.element(sendButton()).not.toBeInTheDocument();
  });
});

describe('照会のダイアログ', () => {
  test('期限の案内、内容の欄と個人情報の注記と文字数、任意の理由の欄、監査ログに記録される旨を示す', async () => {
    await renderWith();
    await openDialog();

    await expect
      .element(dialog())
      .toHaveAccessibleDescription('回答の期限は送信から7日です。');
    await expect
      .element(messageBox())
      .toHaveAccessibleDescription(
        '申出者や第三者の個人情報を含めないでください。',
      );
    await expect.element(dialog().getByText('0 / 1,000')).toBeVisible();
    await messageBox().fill(`  ${'あ'.repeat(12)}  `);
    await expect.element(dialog().getByText('12 / 1,000')).toBeVisible();
    await expect.element(reasonBox()).toBeVisible();
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
  });

  test('内容が空と1,000文字を超える間は送れず、超えた時は文言を示す', async () => {
    await renderWith();
    await openDialog();

    await expect.element(confirmButton()).toBeDisabled();
    await messageBox().fill(' 　');
    await expect.element(confirmButton()).toBeDisabled();
    await messageBox().fill('あ'.repeat(1001));
    await userEvent.tab();
    await expect
      .element(
        dialog().getByText('照会の内容は1,000文字以内で入力してください。'),
      )
      .toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();
    await messageBox().fill('あ'.repeat(1000));
    await expect.element(confirmButton()).toBeEnabled();
  });

  test('処理中は確定のボタンをaria-disabled・aria-busyにし、取り消しとEscapeで閉じさせない', async () => {
    const pending = Promise.withResolvers<unknown>();
    await renderWith({
      handlers: new Map([
        [AdminSendInfringementInquiryDocument, () => pending.promise],
      ]),
    });
    await openDialog();
    await messageBox().fill(INQUIRY_MESSAGE);

    await confirmButton().click();

    await expect
      .element(dialog().getByRole('button', { name: '送信中' }))
      .toHaveAttribute('aria-disabled', 'true');
    await expect
      .element(dialog().getByRole('button', { name: '送信中' }))
      .toHaveAttribute('aria-busy', 'true');
    await expect
      .element(cancelButton())
      .toHaveAttribute('aria-disabled', 'true');
    await cancelButton().click({ force: true });
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).toBeVisible();

    pending.resolve(await sentOutcome());
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  test('送ると内容と前後の空白を除いた理由で照会し、閉じて成功を知らせ、詳細と監査ログの照会を取り直し、開いたボタンへフォーカスを戻す', async () => {
    const { store, auditLogsInvalidated } = await renderWith({
      handlers: new Map([
        [AdminSendInfringementInquiryDocument, () => sentOutcome()],
      ]),
    });
    const requestsBefore = store.detailRequests();
    await openDialog();

    await messageBox().fill(INQUIRY_MESSAGE);
    await reasonBox().fill('  権利者の申出のため ');
    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminSendInfringementInquiryDocument),
    ).toStrictEqual([
      {
        id: REPORT_CASE_ID,
        message: INQUIRY_MESSAGE,
        reason: '権利者の申出のため',
      },
    ]);
    await expect.element(page.getByText('照会を送りました。')).toBeVisible();
    await expect.poll(store.detailRequests).toBe(requestsBefore + 1);
    expect(auditLogsInvalidated()).toBe(true);
    await expect.element(sendButton()).toHaveFocus();
  });

  test('送信に失敗すると、ダイアログの中に文言を示して入力を保ち、監査ログの照会を無効にしない', async () => {
    const message = '照会を送れませんでした。時間をおいてやり直してください。';
    const { auditLogsInvalidated } = await renderWith({
      handlers: new Map([
        [
          AdminSendInfringementInquiryDocument,
          () =>
            failure({
              code: 'report_inquiry_send_failed',
              message,
              status: 503,
            }),
        ],
      ]),
    });
    await openDialog();
    await messageBox().fill(INQUIRY_MESSAGE);
    await reasonBox().fill('権利者の申出のため');

    await confirmButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(message);
    await expect.element(messageBox()).toHaveValue(INQUIRY_MESSAGE);
    await expect.element(reasonBox()).toHaveValue('権利者の申出のため');
    expect(auditLogsInvalidated()).toBe(false);
  });

  test('完了済みの失敗では閉じるまで取り直さず、閉じた後の取り直しで操作が消えると照会の区画の見出しへフォーカスを移す', async () => {
    const message =
      'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。';
    const { store } = await renderWith({
      handlers: new Map([
        [
          AdminSendInfringementInquiryDocument,
          () => {
            store.replace(
              reportCaseDetailOf({
                case: { status: 'RESOLVED' },
                inquiryAvailable: false,
              }),
            );
            return failure({
              code: 'report_case_closed',
              message,
              status: 422,
            });
          },
        ],
      ]),
    });
    const requestsBefore = store.detailRequests();
    await openDialog();
    await messageBox().fill(INQUIRY_MESSAGE);

    await confirmButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(message);
    expect(store.detailRequests()).toBe(requestsBefore);
    await cancelButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(sendButton()).not.toBeInTheDocument();
    await expect
      .element(
        inquirySection().getByRole('heading', { name: '権利侵害の照会' }),
      )
      .toHaveFocus();
  });

  test('取り消すと入力を捨て、開いたボタンへフォーカスを戻す', async () => {
    await renderWith();
    await openDialog();
    await messageBox().fill(INQUIRY_MESSAGE);

    await cancelButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(sendButton()).toHaveFocus();
    await openDialog();
    await expect.element(messageBox()).toHaveValue('');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('照会のダイアログのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith();
    await openDialog();
    await messageBox().fill('あ'.repeat(1001));
    await userEvent.tab();
    await expect
      .element(
        dialog().getByText('照会の内容は1,000文字以内で入力してください。'),
      )
      .toBeVisible();

    expect(await runAxe(dialog().element())).toStrictEqual([]);
  });
});
