import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../../lib/test/display-emulation.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../../lib/utilities/messages/state-messages.ts';
import { failure } from '../../../../test/admin-accounts-fixtures.ts';
import { watchAuditLogQueries } from '../../../../test/audit-log-queries.ts';
import {
  MODERATION_DISPLAY,
  variablesOf,
} from '../../../../test/moderation-fixtures.ts';
import { buttonBehindDialog } from '../../../../test/moderation-render.tsx';
import {
  REPORT_CASE_ID,
  REPORT_REASON,
  reportCaseNodeOf,
  reportCaseOutcomeOf,
  reportCasesQueryOf,
  type ReportingGraphQLHandler,
  respondReportingGraphQL,
  watchReportingQueries,
} from '../../../../test/reporting-fixtures.ts';
import {
  REPORT_LIST_HEADING,
  renderReportCasePart,
} from '../../../../test/reporting-render.tsx';
import {
  adminReportCasesQueryOptions,
  toReportCasePage,
} from '../../../graphql/admin-reporting-cases.ts';
import {
  AdminRejectReportCaseDocument,
  AdminReportCasesDocument,
  type AdminReportCaseSummaryFragment,
  AdminResolveReportCaseWithMeasureDocument,
  AdminResolveReportCaseWithoutMeasureDocument,
} from '../../../graphql/generated/graphql.ts';
import { ReportCaseActions } from './report-case-actions.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const MEASURE_NAME = 'Pitch Notes(pitch-notes)を非公開にする';

const WITHOUT_MEASURE_NAME =
  'Pitch Notes(pitch-notes)の案件を措置なしで対応済にする';

const REJECT_NAME = 'Pitch Notes(pitch-notes)の通報を却下する';

const MEASURE_TITLE = 'プロダクト『Pitch Notes』を非公開にしますか?';

const REASON_NOTICE =
  '理由は投稿者と申出者への通知に載ります。個人情報を含めないでください。';

const PERSONAL_INFORMATION_NOTICE =
  '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const CLOSED_MESSAGE =
  'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。';

const ALREADY_APPLIED_MESSAGE =
  '対象は既に非公開(停止中)です。措置なしで対応済にしてください。';

interface RefreshFailure {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

const REFRESH_FAILURES: readonly RefreshFailure[] = [
  {
    code: 'report_target_unavailable',
    message:
      '対象が見つかりません。措置なしで対応済にするか、却下してください。',
    status: 422,
  },
  { code: 'report_case_closed', message: CLOSED_MESSAGE, status: 422 },
  {
    code: 'report_case_state_conflict',
    message:
      '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
    status: 409,
  },
  {
    code: 'report_case_not_found',
    message: '通報の案件が見つかりません。',
    status: 404,
  },
];

// 一覧の行の操作が一覧の照会の結果から描かれるよう、案件の一覧を照会して行ごとに操作を置く
function ReportCaseRows() {
  const { data } = useQuery({
    ...adminReportCasesQueryOptions({}),
    select: toReportCasePage,
  });
  return (
    <ul>
      {(data?.items ?? []).map((reportCase) => (
        <li key={reportCase.id}>
          <ReportCaseActions reportCase={reportCase} />
        </li>
      ))}
    </ul>
  );
}

const renderHost = async ({
  handlers = new Map(),
  deferRefresh = false,
}: {
  readonly handlers?: ReadonlyMap<unknown, ReportingGraphQLHandler>;
  readonly deferRefresh?: boolean;
} = {}) => {
  let listed: readonly AdminReportCaseSummaryFragment[] = [reportCaseNodeOf()];
  let listRequests = 0;
  respondReportingGraphQL(executeGraphQL, {
    role: 'MODERATOR',
    handlers: new Map([
      ...handlers,
      [
        AdminReportCasesDocument,
        () => {
          listRequests += 1;
          return Promise.resolve({
            ok: true,
            data: reportCasesQueryOf(listed),
          });
        },
      ],
    ]),
  });
  const control = new EventTarget();
  const router = await renderReportCasePart(<ReportCaseRows />, {
    role: 'MODERATOR',
    deferRefresh,
    control,
  });
  const { queryClient } = router.options.context;
  await expect
    .element(page.getByRole('button', { name: MEASURE_NAME }))
    .toBeVisible();
  return {
    control,
    queries: watchReportingQueries(queryClient),
    auditLogsInvalidated: watchAuditLogQueries(queryClient),
    listRequests: () => listRequests,
    // 次の一覧の照会から返す案件を替える
    relist: (nodes: readonly AdminReportCaseSummaryFragment[]) => {
      listed = nodes;
    },
  };
};

const dialog = () => page.getByRole('dialog');
const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(必須)', exact: true });
const confirmButton = (label: string) =>
  dialog().getByRole('button', { name: label, exact: true });
const heading = () =>
  page.getByRole('heading', { name: REPORT_LIST_HEADING, includeHidden: true });

const openFrom = async (name: string): Promise<void> => {
  await page.getByRole('button', { name, exact: true }).click();
  await expect.element(dialog()).toBeVisible();
};

const failWith =
  ({ code, message, status }: RefreshFailure): ReportingGraphQLHandler =>
  () =>
    failure({ code, message, status });

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('確認の内容', () => {
  test('措置の確認は、題名に対象、説明の文に措置の影響と申出者への通知と取り消せない旨と理由の注記を示し、一覧の要素を置かず、個人情報の注記と監査ログに記録される旨を示す', async () => {
    await renderHost();

    await openFrom(MEASURE_NAME);

    await expect
      .element(page.getByRole('dialog', { name: MEASURE_TITLE }))
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        `未開始のマッチ予定は取り消され、復元しても戻りません。投稿者へ通知を送ります。案件を対応済にし、申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      );
    expect(dialog().element().querySelectorAll('ul, ol, li')).toHaveLength(0);
    await expect
      .element(reasonBox())
      .toHaveAccessibleDescription(PERSONAL_INFORMATION_NOTICE);
    await expect.element(dialog().getByText(AUDITED_NOTICE)).toBeVisible();
    await expect.element(confirmButton('非公開にする')).toBeVisible();
  });

  test('措置なしの対応済と却下の確認は、通知と取り消せない旨と理由の注記を示す', async () => {
    await renderHost();

    await openFrom(WITHOUT_MEASURE_NAME);
    await expect
      .element(
        page.getByRole('dialog', { name: '措置をせずに対応済にしますか?' }),
      )
      .toHaveAccessibleDescription(
        `申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      );
    await dialog().getByRole('button', { name: 'キャンセル' }).click();
    await expect.element(dialog()).not.toBeInTheDocument();

    await openFrom(REJECT_NAME);
    await expect
      .element(page.getByRole('dialog', { name: 'この通報を却下しますか?' }))
      .toHaveAccessibleDescription(
        `投稿者と申出者へ却下を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      );
    await expect.element(confirmButton('却下する')).toBeVisible();
  });

  test('理由は必須で、空・空白だけの間と500文字を超える間は確定できず、500文字なら確定できる', async () => {
    await renderHost();
    await openFrom(REJECT_NAME);

    await expect.element(confirmButton('却下する')).toBeDisabled();
    await reasonBox().fill(' 　');
    await expect.element(confirmButton('却下する')).toBeDisabled();
    await reasonBox().fill('あ'.repeat(501));
    await userEvent.tab();
    await expect
      .element(dialog().getByText('理由は500文字以内で入力してください。'))
      .toBeVisible();
    await expect.element(confirmButton('却下する')).toBeDisabled();

    await reasonBox().fill('あ'.repeat(500));
    await expect.element(confirmButton('却下する')).toBeEnabled();
  });

  test('取り消すと入力を捨て、開いた操作へフォーカスを戻す', async () => {
    await renderHost();
    await openFrom(REJECT_NAME);
    await reasonBox().fill(REPORT_REASON);

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: REJECT_NAME }))
      .toHaveFocus();
    await openFrom(REJECT_NAME);
    await expect.element(reasonBox()).toHaveValue('');
  });
});

describe('確定', () => {
  test('措置を確定すると案件と前後の空白を除いた理由で操作し、閉じて成功を知らせ、本specの照会と監査ログとUGC管理の影響する照会を無効にする', async () => {
    const { queries, auditLogsInvalidated } = await renderHost({
      handlers: new Map([
        [
          AdminResolveReportCaseWithMeasureDocument,
          () => reportCaseOutcomeOf('resolveReportCaseWithMeasure', 'RESOLVED'),
        ],
      ]),
    });
    await openFrom(MEASURE_NAME);

    await reasonBox().fill(`  ${REPORT_REASON}\n`);
    await confirmButton('非公開にする').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminResolveReportCaseWithMeasureDocument),
    ).toStrictEqual([{ id: REPORT_CASE_ID, reason: REPORT_REASON }]);
    await expect.element(page.getByText('対応済にしました。')).toBeVisible();
    expect(queries.cases()).toBe(true);
    expect(queries.detail()).toBe(true);
    expect(queries.summaries()).toBe(true);
    expect(auditLogsInvalidated()).toBe(true);
    expect(queries.moderationProducts()).toBe(true);
  });

  test('措置なしの対応済と却下は、本specの照会と監査ログを無効にし、UGC管理の影響する照会は無効にしない', async () => {
    const { queries, auditLogsInvalidated } = await renderHost({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => reportCaseOutcomeOf('rejectReportCase', 'REJECTED'),
        ],
      ]),
    });
    await openFrom(REJECT_NAME);

    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(page.getByText('却下しました。')).toBeVisible();
    expect(queries.cases()).toBe(true);
    expect(queries.summaries()).toBe(true);
    expect(auditLogsInvalidated()).toBe(true);
    expect(queries.moderationProducts()).toBe(false);
  });

  test('未対応で絞った一覧で確定して行が消えても、確認のダイアログは閉じるまで残り、閉じた後は一覧の見出しへフォーカスを移す', async () => {
    const { relist } = await renderHost({
      handlers: new Map([
        [
          AdminResolveReportCaseWithoutMeasureDocument,
          () => {
            relist([]);
            return reportCaseOutcomeOf(
              'resolveReportCaseWithoutMeasure',
              'RESOLVED',
            );
          },
        ],
      ]),
    });
    await openFrom(WITHOUT_MEASURE_NAME);

    await reasonBox().fill(REPORT_REASON);
    await confirmButton('対応済にする').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(buttonBehindDialog(WITHOUT_MEASURE_NAME).query()).toBeNull();
    await expect.element(heading()).toHaveFocus();
  });

  test('行が残っても、確定の後は操作の替わる行ではなく一覧の見出しへフォーカスを移す', async () => {
    await renderHost({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => reportCaseOutcomeOf('rejectReportCase', 'REJECTED'),
        ],
      ]),
    });
    await openFrom(REJECT_NAME);

    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(heading()).toHaveFocus();
  });
});

describe('失敗', () => {
  test.each(REFRESH_FAILURES)(
    '$codeの失敗は、文言をダイアログの中に示して理由を保ち、案件の一覧・詳細・件数の照会を無効にし、監査ログの照会は無効にしない',
    async (refreshFailure) => {
      const { queries, auditLogsInvalidated, listRequests } = await renderHost({
        handlers: new Map([
          [AdminRejectReportCaseDocument, failWith(refreshFailure)],
        ]),
      });
      const requestsBefore = listRequests();
      await openFrom(REJECT_NAME);

      await reasonBox().fill(REPORT_REASON);
      await confirmButton('却下する').click();

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(refreshFailure.message);
      await expect.element(reasonBox()).toHaveValue(REPORT_REASON);
      expect(listRequests()).toBeGreaterThan(requestsBefore);
      expect(queries.cases()).toBe(true);
      expect(queries.detail()).toBe(true);
      expect(queries.summaries()).toBe(true);
      expect(auditLogsInvalidated()).toBe(false);
      expect(page.getByText('却下しました。').query()).toBeNull();
    },
  );

  test.each([
    { failureIndex: 0, moderationInvalidated: true },
    { failureIndex: 1, moderationInvalidated: false },
  ])(
    '対象の不在の失敗だけはUGC管理の影響する照会も無効にする(失敗の$failureIndex番目)',
    async ({ failureIndex, moderationInvalidated }) => {
      const refreshFailure = REFRESH_FAILURES[failureIndex];
      if (refreshFailure === undefined) {
        throw new Error('失敗の一覧が足りません。');
      }
      const { queries } = await renderHost({
        handlers: new Map([
          [AdminResolveReportCaseWithMeasureDocument, failWith(refreshFailure)],
        ]),
      });
      await openFrom(MEASURE_NAME);
      await reasonBox().fill(REPORT_REASON);
      await confirmButton('非公開にする').click();

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(refreshFailure.message);
      expect(queries.cases()).toBe(true);
      expect(queries.moderationProducts()).toBe(moderationInvalidated);
    },
  );

  test('措置済みの失敗は照会を無効にせず、措置なしの対応済への切り替えを示し、切り替えると措置なしの対応済の確認を開く', async () => {
    const { queries, auditLogsInvalidated, listRequests } = await renderHost({
      handlers: new Map<unknown, ReportingGraphQLHandler>([
        [
          AdminResolveReportCaseWithMeasureDocument,
          () =>
            failure({
              code: 'report_measure_already_applied',
              message: ALREADY_APPLIED_MESSAGE,
              status: 422,
            }),
        ],
        [
          AdminResolveReportCaseWithoutMeasureDocument,
          () =>
            reportCaseOutcomeOf('resolveReportCaseWithoutMeasure', 'RESOLVED'),
        ],
      ]),
    });
    const requestsBefore = listRequests();
    await openFrom(MEASURE_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('非公開にする').click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(ALREADY_APPLIED_MESSAGE);
    expect(listRequests()).toBe(requestsBefore);
    expect(queries.cases()).toBe(false);
    expect(queries.summaries()).toBe(false);
    expect(auditLogsInvalidated()).toBe(false);

    await dialog()
      .getByRole('button', { name: '措置なしで対応済にする', exact: true })
      .click();

    await expect
      .element(
        page.getByRole('dialog', { name: '措置をせずに対応済にしますか?' }),
      )
      .toBeVisible();
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('対応済にする').click();
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminResolveReportCaseWithoutMeasureDocument),
    ).toStrictEqual([{ id: REPORT_CASE_ID, reason: REPORT_REASON }]);
    await expect.element(heading()).toHaveFocus();
  });

  test('入力の誤りの失敗は照会を無効にしない', async () => {
    const { queries } = await renderHost({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () =>
            failure({
              code: 'validation_error',
              message: '理由を入力してください。',
              status: 400,
            }),
        ],
      ]),
    });
    await openFrom(REJECT_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('理由を入力してください。');
    expect(queries.cases()).toBe(false);
  });

  test('失敗の後に閉じると、起点のボタンが残っていればそこへフォーカスを戻す', async () => {
    const [, closed] = REFRESH_FAILURES;
    if (closed === undefined) {
      throw new Error('失敗の一覧が足りません。');
    }
    await renderHost({
      handlers: new Map([[AdminRejectReportCaseDocument, failWith(closed)]]),
    });
    await openFrom(REJECT_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();
    await expect.element(dialog().getByRole('alert')).toBeVisible();

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('button', { name: REJECT_NAME }))
      .toHaveFocus();
  });

  test('失敗の取り直しで起点のボタンが消えていれば、閉じた後は一覧の見出しへフォーカスを移す', async () => {
    const [, , , notFound] = REFRESH_FAILURES;
    if (notFound === undefined) {
      throw new Error('失敗の一覧が足りません。');
    }
    const { relist } = await renderHost({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => {
            relist([]);
            return failure(notFound);
          },
        ],
      ]),
    });
    await openFrom(REJECT_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();
    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(notFound.message);
    await expect.poll(() => buttonBehindDialog(REJECT_NAME).query()).toBeNull();
    await expect.element(reasonBox()).toHaveValue(REPORT_REASON);

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(heading()).toHaveFocus();
  });

  test('`GraphQLClientError`でない失敗は、問い合わせを促さない管理者側の文言をダイアログの中に示す', async () => {
    await renderHost({
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => Promise.reject(new Error('network down')),
        ],
      ]),
    });
    await openFrom(REJECT_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();

    const alert = dialog().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    await expect.element(alert).not.toHaveTextContent('network down');
  });
});

describe('取り直しを遅らせる指定', () => {
  test.each(REFRESH_FAILURES)(
    '$codeの失敗では、開いている間は照会を無効にせず文言と理由を示し、閉じた時に案件の照会を無効にする',
    async (refreshFailure) => {
      const { queries, listRequests, auditLogsInvalidated } = await renderHost({
        deferRefresh: true,
        handlers: new Map([
          [AdminRejectReportCaseDocument, failWith(refreshFailure)],
        ]),
      });
      const requestsBefore = listRequests();
      await openFrom(REJECT_NAME);
      await reasonBox().fill(REPORT_REASON);
      await confirmButton('却下する').click();

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(refreshFailure.message);
      await expect.element(reasonBox()).toHaveValue(REPORT_REASON);
      expect(listRequests()).toBe(requestsBefore);
      expect(queries.detail()).toBe(false);
      expect(queries.summaries()).toBe(false);

      await dialog().getByRole('button', { name: 'キャンセル' }).click();

      await expect.element(dialog()).not.toBeInTheDocument();
      await expect.poll(queries.detail).toBe(true);
      expect(queries.cases()).toBe(true);
      expect(queries.summaries()).toBe(true);
      expect(auditLogsInvalidated()).toBe(false);
    },
  );

  test('取り直しを遅らせた後、閉じずに部品が外れた時も案件の照会とUGC管理の影響する照会を無効にする', async () => {
    const [targetUnavailable] = REFRESH_FAILURES;
    if (targetUnavailable === undefined) {
      throw new Error('失敗の一覧が足りません。');
    }
    const { queries, control } = await renderHost({
      deferRefresh: true,
      handlers: new Map([
        [
          AdminResolveReportCaseWithMeasureDocument,
          failWith(targetUnavailable),
        ],
      ]),
    });
    await openFrom(MEASURE_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('非公開にする').click();
    await expect.element(dialog().getByRole('alert')).toBeVisible();
    expect(queries.detail()).toBe(false);

    control.dispatchEvent(new Event('remove-host'));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.poll(queries.detail).toBe(true);
    expect(queries.summaries()).toBe(true);
    expect(queries.moderationProducts()).toBe(true);
  });

  test('取り直しを遅らせても、成功の後はすぐに照会を無効にする', async () => {
    const { queries } = await renderHost({
      deferRefresh: true,
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => reportCaseOutcomeOf('rejectReportCase', 'REJECTED'),
        ],
      ]),
    });
    await openFrom(REJECT_NAME);
    await reasonBox().fill(REPORT_REASON);
    await confirmButton('却下する').click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(queries.detail()).toBe(true);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('開いた確認のダイアログのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderHost();
    await openFrom(MEASURE_NAME);

    expect(await runAxe(dialog().element())).toStrictEqual([]);
  });
});
