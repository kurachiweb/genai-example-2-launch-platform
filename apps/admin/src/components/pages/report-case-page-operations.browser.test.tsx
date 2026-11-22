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
import { failure } from '../../../test/admin-accounts-fixtures.ts';
import { watchAuditLogQueries } from '../../../test/audit-log-queries.ts';
import {
  MODERATION_DISPLAY,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import { buttonBehindDialog } from '../../../test/moderation-render.tsx';
import {
  type ReportCaseDetailData,
  reportCaseDetailOf,
  renderReportCasePage,
  respondReportCaseGraphQL,
} from '../../../test/report-case-page-fixtures.ts';
import {
  REPORT_CASE_ID,
  REPORT_REASON,
  reportCaseOutcomeOf,
  type ReportingGraphQLHandler,
} from '../../../test/reporting-fixtures.ts';
import {
  AdminChangeReportCaseStatusDocument,
  AdminRejectReportCaseDocument,
  AdminResolveReportCaseWithMeasureDocument,
  AdminResolveReportCaseWithoutMeasureDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const MEASURE_NAME = 'Pitch Notes(pitch-notes)を非公開にする';

const WITHOUT_MEASURE_NAME =
  'Pitch Notes(pitch-notes)の案件を措置なしで対応済にする';

const REJECT_NAME = 'Pitch Notes(pitch-notes)の通報を却下する';

const NOT_FOUND_MESSAGE = '通報の案件が見つかりません。';

const STATUS_NOTICE = '手での変更では投稿者と申出者へ通知しません。';

const CLOSE_NOTICE =
  '通知するには、措置・措置なしで対応済にする・却下の操作を使ってください。';

const REOPEN_NOTICE =
  '完了の日時・措置の種類・完了の理由を消し、まだ送っていない通知を取りやめます。行った措置(非公開化・停止)は取り消されません。取り消す場合は各管理画面で行ってください。';

interface RefreshFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

const CLOSED_FAILURE: RefreshFailure = {
  code: 'report_case_closed',
  message:
    'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。',
  status: 422,
};

const CONFLICT_FAILURE: RefreshFailure = {
  code: 'report_case_state_conflict',
  message:
    '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
  status: 409,
};

const CASE_NOT_FOUND_FAILURE: RefreshFailure = {
  code: 'report_case_not_found',
  message: NOT_FOUND_MESSAGE,
  status: 404,
};

const REFRESH_FAILURES: readonly RefreshFailure[] = [
  {
    code: 'report_target_unavailable',
    message:
      '対象が見つかりません。措置なしで対応済にするか、却下してください。',
    status: 422,
  },
  CLOSED_FAILURE,
  CONFLICT_FAILURE,
  CASE_NOT_FOUND_FAILURE,
];

const main = () => page.getByRole('main');
const operations = () =>
  main().getByRole('region', { name: '操作', exact: true });
const operationsHeading = () =>
  operations().getByRole('heading', { name: '操作', includeHidden: true });
const dialog = () => page.getByRole('dialog');
const reasonBox = (name = '理由(必須)') =>
  dialog().getByRole('textbox', { name, exact: true });
const dialogButton = (name: string) =>
  dialog().getByRole('button', { name, exact: true });
const statusSelect = () =>
  main().getByRole('combobox', { name: '変更後の対応ステータス' });
const changeStatusButton = () =>
  main().getByRole('button', { name: '対応ステータスを変更', exact: true });
const notFoundRegion = () =>
  main().getByRole('region', { name: NOT_FOUND_MESSAGE, exact: true });

const failWith =
  ({ code, message, status }: RefreshFailure): ReportingGraphQLHandler =>
  () =>
    failure({ code, message, status });

const renderWith = async ({
  detail = reportCaseDetailOf(),
  handlers = new Map(),
}: {
  readonly detail?: ReportCaseDetailData;
  readonly handlers?: ReadonlyMap<unknown, ReportingGraphQLHandler>;
} = {}) => {
  const store = respondReportCaseGraphQL(executeGraphQL, {
    role: 'MODERATOR',
    detail,
    handlers,
  });
  const router = await renderReportCasePage('MODERATOR');
  await expect.element(operations()).toBeVisible();
  return {
    store,
    auditLogsInvalidated: watchAuditLogQueries(
      router.options.context.queryClient,
    ),
  };
};

const chooseStatus = async (name: string) => {
  await userEvent.click(statusSelect());
  await userEvent.click(page.getByRole('option', { name, exact: true }));
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('措置・措置なしの対応済・却下', () => {
  test.each([
    {
      name: MEASURE_NAME,
      title: 'プロダクト『Pitch Notes』を非公開にしますか?',
    },
    { name: WITHOUT_MEASURE_NAME, title: '措置をせずに対応済にしますか?' },
    { name: REJECT_NAME, title: 'この通報を却下しますか?' },
  ])(
    '詳細の操作の区画から「$title」の確認を開ける',
    async ({ name, title }) => {
      await renderWith();

      await operations().getByRole('button', { name, exact: true }).click();

      await expect
        .element(page.getByRole('dialog', { name: title }))
        .toBeVisible();
    },
  );

  test('完了した案件には措置・措置なしの対応済・却下を置かない', async () => {
    await renderWith({
      detail: reportCaseDetailOf({ case: { status: 'RESOLVED' } }),
    });

    await expect
      .element(operations().getByRole('button', { name: REJECT_NAME }))
      .not.toBeInTheDocument();
    await expect.element(changeStatusButton()).toBeVisible();
  });

  test('確定すると閉じて成功を知らせ、詳細を取り直し、操作の消えた区画の見出しへフォーカスを移す', async () => {
    const { store } = await renderWith({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => {
            store.replace(reportCaseDetailOf({ case: { status: 'REJECTED' } }));
            return reportCaseOutcomeOf('rejectReportCase', 'REJECTED');
          },
        ],
      ]),
    });

    await operations().getByRole('button', { name: REJECT_NAME }).click();
    await reasonBox().fill(REPORT_REASON);
    await dialogButton('却下する').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(page.getByText('却下しました。')).toBeVisible();
    await expect
      .element(operations().getByRole('button', { name: REJECT_NAME }))
      .not.toBeInTheDocument();
    await expect.element(operationsHeading()).toHaveFocus();
  });

  test.each(REFRESH_FAILURES)(
    '$codeで失敗すると、ダイアログを閉じるまで詳細を取り直さずに文言と理由を示し、閉じた後に取り直す',
    async (refreshFailure) => {
      const { store, auditLogsInvalidated } = await renderWith({
        handlers: new Map([
          [
            AdminResolveReportCaseWithoutMeasureDocument,
            failWith(refreshFailure),
          ],
        ]),
      });
      const requestsBefore = store.detailRequests();

      await operations()
        .getByRole('button', { name: WITHOUT_MEASURE_NAME })
        .click();
      await reasonBox().fill(REPORT_REASON);
      await dialogButton('対応済にする').click();

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(refreshFailure.message);
      await expect.element(reasonBox()).toHaveValue(REPORT_REASON);
      expect(store.detailRequests()).toBe(requestsBefore);

      await dialogButton('キャンセル').click();

      await expect.element(dialog()).not.toBeInTheDocument();
      await expect.poll(store.detailRequests).toBe(requestsBefore + 1);
      expect(auditLogsInvalidated()).toBe(false);
    },
  );

  test('完了済みの失敗で閉じた後の取り直しで操作が消えても、フォーカスを<body>へ落とさず操作の区画の見出しへ移す', async () => {
    const { store } = await renderWith({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => {
            store.replace(reportCaseDetailOf({ case: { status: 'RESOLVED' } }));
            return failure(CLOSED_FAILURE);
          },
        ],
      ]),
    });

    await operations().getByRole('button', { name: REJECT_NAME }).click();
    await reasonBox().fill(REPORT_REASON);
    await dialogButton('却下する').click();
    await expect.element(dialog().getByRole('alert')).toBeVisible();
    await expect.element(buttonBehindDialog(REJECT_NAME)).toBeInTheDocument();

    await dialogButton('キャンセル').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(operations().getByRole('button', { name: REJECT_NAME }))
      .not.toBeInTheDocument();
    await expect.element(operationsHeading()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  test('案件の不在の失敗では、閉じた後に見つからない表示に替えてその区画へフォーカスを移す', async () => {
    const { store } = await renderWith({
      handlers: new Map([
        [
          AdminResolveReportCaseWithMeasureDocument,
          () => {
            store.replace(null);
            return failure(CASE_NOT_FOUND_FAILURE);
          },
        ],
      ]),
    });

    await operations().getByRole('button', { name: MEASURE_NAME }).click();
    await reasonBox().fill(REPORT_REASON);
    await dialogButton('非公開にする').click();
    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(NOT_FOUND_MESSAGE);

    await dialogButton('キャンセル').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(notFoundRegion()).toBeVisible();
    await expect.element(notFoundRegion()).toHaveFocus();
  });
});

describe('対応ステータスの変更', () => {
  test.each([
    {
      status: 'OPEN' as const,
      options: ['対応中', '対応済', '却下'],
    },
    {
      status: 'IN_PROGRESS' as const,
      options: ['未対応', '対応済', '却下'],
    },
    {
      status: 'RESOLVED' as const,
      options: ['未対応', '対応中', '却下'],
    },
    {
      status: 'REJECTED' as const,
      options: ['未対応', '対応中', '対応済'],
    },
  ])(
    '$statusの案件では現在と異なる3つの状態を選べる',
    async ({ status, options }) => {
      await renderWith({ detail: reportCaseDetailOf({ case: { status } }) });

      await userEvent.click(statusSelect());

      const listed = page.getByRole('option').elements();
      expect(listed.map((option) => option.textContent)).toStrictEqual(options);
      await userEvent.keyboard('{Escape}');
    },
  );

  test('未対応から対応中へは、通知しない旨と任意の理由で確認し、理由なしでも変更して成功を知らせ、監査ログの照会を無効にする', async () => {
    const { auditLogsInvalidated } = await renderWith({
      handlers: new Map([
        [
          AdminChangeReportCaseStatusDocument,
          () => reportCaseOutcomeOf('changeReportCaseStatus', 'IN_PROGRESS'),
        ],
      ]),
    });

    await chooseStatus('対応中');
    await changeStatusButton().click();

    await expect
      .element(
        page.getByRole('dialog', { name: '対応ステータスを対応中にしますか?' }),
      )
      .toHaveAccessibleDescription(STATUS_NOTICE);
    await expect.element(reasonBox('理由(任意)')).toBeVisible();
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    await dialogButton('変更する').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminChangeReportCaseStatusDocument),
    ).toStrictEqual([{ id: REPORT_CASE_ID, from: 'OPEN', to: 'IN_PROGRESS' }]);
    await expect.element(page.getByText('対応中にしました。')).toBeVisible();
    expect(auditLogsInvalidated()).toBe(true);
    await expect.element(statusSelect()).toHaveFocus();
  });

  test('完了への変更は、理由を必須とし、通知するには完了の操作を使う旨を示す', async () => {
    await renderWith({
      handlers: new Map([
        [
          AdminChangeReportCaseStatusDocument,
          () => reportCaseOutcomeOf('changeReportCaseStatus', 'RESOLVED'),
        ],
      ]),
    });

    await chooseStatus('対応済');
    await changeStatusButton().click();

    await expect
      .element(
        page.getByRole('dialog', { name: '対応ステータスを対応済にしますか?' }),
      )
      .toHaveAccessibleDescription(`${STATUS_NOTICE}${CLOSE_NOTICE}`);
    await expect.element(dialogButton('変更する')).toBeDisabled();
    await reasonBox().fill(` ${REPORT_REASON} `);
    await dialogButton('変更する').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminChangeReportCaseStatusDocument),
    ).toStrictEqual([
      {
        id: REPORT_CASE_ID,
        from: 'OPEN',
        to: 'RESOLVED',
        reason: REPORT_REASON,
      },
    ]);
    await expect.element(page.getByText('対応済にしました。')).toBeVisible();
  });

  test('完了からの再開は、理由を必須とし、完了の記録を消して措置は取り消さない旨を示す', async () => {
    await renderWith({
      detail: reportCaseDetailOf({ case: { status: 'REJECTED' } }),
    });

    await chooseStatus('対応中');
    await changeStatusButton().click();

    await expect
      .element(
        page.getByRole('dialog', { name: '対応ステータスを対応中にしますか?' }),
      )
      .toHaveAccessibleDescription(`${STATUS_NOTICE}${REOPEN_NOTICE}`);
    await expect.element(reasonBox('理由(必須)')).toBeVisible();
    await expect.element(dialogButton('変更する')).toBeDisabled();
  });

  test('同じ対象に未完了の別の案件があって再開できないと、ダイアログの中にその案件で対応する旨を示して理由を保ち、取り直さない', async () => {
    const message =
      'この対象には未完了の別の案件があります。その案件で対応してください。';
    const { store, auditLogsInvalidated } = await renderWith({
      detail: reportCaseDetailOf({ case: { status: 'RESOLVED' } }),
      handlers: new Map([
        [
          AdminChangeReportCaseStatusDocument,
          () =>
            failure({ code: 'report_case_open_exists', message, status: 409 }),
        ],
      ]),
    });
    const requestsBefore = store.detailRequests();

    await chooseStatus('未対応');
    await changeStatusButton().click();
    await reasonBox().fill(REPORT_REASON);
    await dialogButton('変更する').click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(message);
    await expect.element(reasonBox()).toHaveValue(REPORT_REASON);
    await dialogButton('キャンセル').click();
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(store.detailRequests()).toBe(requestsBefore);
    expect(auditLogsInvalidated()).toBe(false);
  });

  test('現在と同じ状態への変更の拒否は、状態の欄の文言をダイアログの中に示す', async () => {
    const message = '現在と異なる対応ステータスを選んでください。';
    await renderWith({
      handlers: new Map([
        [
          AdminChangeReportCaseStatusDocument,
          () =>
            failure({
              code: 'validation_error',
              message: '入力内容を確認してください。',
              status: 400,
              details: [{ field: 'status', code: 'unchanged', message }],
            }),
        ],
      ]),
    });

    await chooseStatus('対応中');
    await changeStatusButton().click();
    await dialogButton('変更する').click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(message);
  });

  test('競合の失敗では、ダイアログを閉じるまで取り直さず、閉じた後に取り直す', async () => {
    const { store } = await renderWith({
      handlers: new Map([
        [AdminChangeReportCaseStatusDocument, failWith(CONFLICT_FAILURE)],
      ]),
    });
    const requestsBefore = store.detailRequests();

    await chooseStatus('対応中');
    await changeStatusButton().click();
    await dialogButton('変更する').click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(CONFLICT_FAILURE.message);
    expect(store.detailRequests()).toBe(requestsBefore);
    await dialogButton('キャンセル').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.poll(store.detailRequests).toBe(requestsBefore + 1);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('対応ステータスの変更の確認のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith({
      detail: reportCaseDetailOf({ case: { status: 'RESOLVED' } }),
    });
    await chooseStatus('未対応');
    await changeStatusButton().click();
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(dialog().element())).toStrictEqual([]);
  });
});
