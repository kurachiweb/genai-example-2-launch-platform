import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resolveBrowserDisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  failure,
  INVITED_ACCOUNT,
  MODERATOR_ACCOUNT,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  AUDIT_LOGS_PATH,
  type AuditLogsHandler,
  auditLogsQueryOf,
  auditLogsVariablesOf,
  DELETED_OPERATOR_ID,
  EMAIL_SEARCH_ENTRY,
  FIRST_PAGE,
  INVITE_ENTRY,
  PSEUDONYMOUS_USER_ID,
  renderAuditLogsPage,
  respondAuditLogsGraphQL,
  ROLE_CHANGE_ENTRY,
} from '../../../test/audit-logs-fixtures.ts';
import { Route as AuditLogsRoute } from '../../routes/_authenticated/audit-logs/index.tsx';
import { toAuditLogSearch } from '../audit/audit-log-search.ts';
import { toAuditPeriod } from '../audit/audit-period.ts';
import { loadAuditLogsPage } from '../audit/load-audit-logs-page.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: '監査ログの一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const operatorSelect = () =>
  filterForm().getByRole('combobox', { name: '操作者' });
const actionSelect = () =>
  filterForm().getByRole('combobox', { name: '操作種別' });
const targetInput = () =>
  filterForm().getByRole('textbox', { name: '対象の識別子' });
const fromInput = () => filterForm().getByLabelText('開始日');
const toInput = () => filterForm().getByLabelText('終了日');
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
const pagination = () => main().getByRole('navigation', { name: 'ページ送り' });
const nextButton = () => pagination().getByRole('button', { name: '次へ' });
const previousButton = () => pagination().getByRole('button', { name: '前へ' });

const lastVariables = () => auditLogsVariablesOf(executeGraphQL).at(-1);

const browserTimeZone = () => resolveBrowserDisplayPreferences().timeZone;

async function chooseOption(
  trigger: ReturnType<typeof operatorSelect>,
  name: string,
): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

const renderWith = async (
  auditLogs?: AuditLogsHandler,
  path: string = AUDIT_LOGS_PATH,
) => {
  respondAuditLogsGraphQL(executeGraphQL, {
    role: 'VIEWER',
    ...(auditLogs === undefined ? {} : { auditLogs }),
  });
  return renderAuditLogsPage('VIEWER', path);
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = { action: 'admin-account.invite', after: 'cursor-2' };

  expect(AuditLogsRoute.options.validateSearch).toBe(toAuditLogSearch);
  expect(AuditLogsRoute.options.loader).toBe(loadAuditLogsPage);
  expect(
    (
      AuditLogsRoute.options.loaderDeps as (input: {
        search: unknown;
      }) => unknown
    )({ search }),
  ).toBe(search);
});

describe('監査ログの一覧', () => {
  test('条件を付けずに検索し、日時・操作者・操作種別・対象・理由・詳細をAPIの順(日時の新しい順)に表示する', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('監査ログ');
    expect(lastVariables()).toStrictEqual({ filter: {} });
    const headers = table()
      .getByRole('columnheader')
      .elements()
      .map((element) => element.textContent);
    expect(headers).toStrictEqual([
      '日時',
      '操作者',
      '操作種別',
      '対象',
      '理由',
      '詳細',
    ]);
    const times = table()
      .getByRole('row')
      .elements()
      .slice(1)
      .map((row) => row.querySelector('time')?.getAttribute('datetime'));
    expect(times).toStrictEqual([
      INVITE_ENTRY.occurredAt,
      ROLE_CHANGE_ENTRY.occurredAt,
      EMAIL_SEARCH_ENTRY.occurredAt,
    ]);
    const inviteRow = rowOf(INVITE_ENTRY.reason ?? '');
    await expect.element(inviteRow).toHaveTextContent('審査の担当');
    await expect.element(inviteRow).toHaveTextContent('管理者の招待');
    await expect.element(inviteRow).toHaveTextContent('管理者');
    await expect.element(inviteRow).toHaveTextContent(INVITED_ACCOUNT.id);
    await expect.element(inviteRow).toHaveTextContent('2026');
    const searchRow = rowOf('ユーザーのメールアドレス検索');
    expect(
      [...searchRow.element().querySelectorAll('td')].map(
        (cell) => cell.textContent,
      ),
    ).toStrictEqual([
      expect.any(String),
      '統括の担当',
      'ユーザーのメールアドレス検索',
      'なし',
      'なし',
      'なし',
    ]);
    const roleRow = rowOf('管理者のロールの変更');
    await expect.element(roleRow).toHaveTextContent('fromRole: viewer');
    await expect.element(roleRow).toHaveTextContent('toRole: moderator');
  });

  test('削除済みの操作者は、ニックネームに代えて削除済みの管理者である旨とIDを表示する', async () => {
    await renderWith();

    await expect
      .element(rowOf('管理者のロールの変更'))
      .toHaveTextContent(`削除済みの管理者(ID: ${DELETED_OPERATOR_ID})`);
  });

  test('条件に一致する監査ログが無ければ空の状態を示す', async () => {
    await renderWith(() => success(auditLogsQueryOf([])));

    await expect
      .element(main().getByText('条件に一致する監査ログはありません。'))
      .toBeVisible();
  });

  test('取得の失敗は一覧の場所に文言と再試行の操作で示し、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith(() =>
      available
        ? success(FIRST_PAGE)
        : failure({
            code: 'internal_error',
            message: '処理中に問題が発生しました。',
            status: 500,
          }),
    );

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    await expect.element(filterForm()).toBeVisible();
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect
      .element(
        main().getByRole('heading', { level: 2, name: '監査ログの一覧' }),
      )
      .toHaveFocus();
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('絞り込み', () => {
  test('操作者・操作種別・対象の識別子・期間の条件をすべて満たす監査ログを求め、条件をURLに残し、フォーカスを「適用」に残す', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();
    const operator = operatorSelect();
    const action = actionSelect();

    await chooseOption(operator, MODERATOR_ACCOUNT.nickname ?? '');
    await chooseOption(action, '管理者の削除');
    await userEvent.fill(
      targetInput(),
      ` ${PSEUDONYMOUS_USER_ID.toUpperCase()} `,
    );
    await userEvent.fill(fromInput(), '2026-11-01');
    await userEvent.fill(toInput(), '2026-11-04');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        operatorId: MODERATOR_ACCOUNT.id,
        action: 'admin-account.delete',
        targetId: PSEUDONYMOUS_USER_ID,
        ...toAuditPeriod(
          { from: '2026-11-01', to: '2026-11-04' },
          browserTimeZone(),
        ),
      },
    });
    expect(router.state.location.search).toEqual({
      operator: MODERATOR_ACCOUNT.id,
      action: 'admin-account.delete',
      target: PSEUDONYMOUS_USER_ID,
      from: '2026-11-01',
      to: '2026-11-04',
    });
    await expect.element(targetInput()).toHaveValue(PSEUDONYMOUS_USER_ID);
    await expect.element(applyButton()).toHaveFocus();
  });

  test('操作種別の選択肢は登録された全ての操作種別を表示名で並べる', async () => {
    await renderWith();
    const action = actionSelect();

    await userEvent.click(action);

    const options = page
      .getByRole('option')
      .elements()
      .map((option) => option.textContent);
    expect(options).toStrictEqual([
      'すべての操作種別',
      '管理者の招待',
      '管理者の削除',
      '管理者のロールの変更',
      'ユーザーのメールアドレス検索',
      '問い合わせへの返信',
      '対応ステータスの変更',
      '問い合わせカテゴリの追加',
      '問い合わせカテゴリの名前の変更',
      '問い合わせカテゴリの削除',
      'Ultras導線の機能フラグの変更',
      'プロダクトカテゴリの追加',
      'プロダクトカテゴリの変更',
      'プロダクトカテゴリの削除',
    ]);
    await expect
      .poll(async () => runAxe(page.getByRole('listbox').element()))
      .toStrictEqual([]);
  });

  test('「解除」で条件を全て外して1ページ目を求め直し、入力欄を空に戻してフォーカスを「解除」に残す', async () => {
    const router = await renderWith(
      undefined,
      `${AUDIT_LOGS_PATH}?action=admin-account.invite&target=${PSEUDONYMOUS_USER_ID}&from=2026-11-01`,
    );
    await expect.element(targetInput()).toHaveValue(PSEUDONYMOUS_USER_ID);
    await expect.element(actionSelect()).toHaveTextContent('管理者の招待');
    await expect.element(fromInput()).toHaveValue('2026-11-01');

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {} });
    expect(router.state.location.search).toEqual({});
    await expect.element(targetInput()).toHaveValue('');
    await expect.element(resetButton()).toHaveFocus();
    await expect.element(fromInput()).toHaveValue('');
    await expect.element(actionSelect()).toHaveTextContent('すべての操作種別');
    await expect.element(operatorSelect()).toHaveTextContent('すべての管理者');
  });

  test('一覧に無い操作者(削除済みなど)がURLの条件にあれば、IDで示して選んだ状態にする', async () => {
    await renderWith(
      undefined,
      `${AUDIT_LOGS_PATH}?operator=${DELETED_OPERATOR_ID}`,
    );

    await expect
      .element(operatorSelect())
      .toHaveTextContent(`一覧に無い管理者(ID: ${DELETED_OPERATOR_ID})`);
    expect(lastVariables()).toStrictEqual({
      filter: { operatorId: DELETED_OPERATOR_ID },
    });
  });

  test('URLの不正な条件とページの位置は、元の値をloaderにも画面にも渡さず、未指定として1ページ目を検索する', async () => {
    await renderWith(
      undefined,
      `${AUDIT_LOGS_PATH}?operator=&action=${'a'.repeat(65)}&target=123&from=2026-02-30&to=20261104&after=${'c'.repeat(257)}`,
    );

    await expect.element(table()).toBeVisible();
    await expect.element(operatorSelect()).toHaveTextContent('すべての管理者');
    await expect.element(actionSelect()).toHaveTextContent('すべての操作種別');
    await expect.element(targetInput()).toHaveValue('');
    await expect.element(fromInput()).toHaveValue('');
    await expect.element(toInput()).toHaveValue('');
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    expect(auditLogsVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {} },
    ]);
  });

  test('終了日が開始日より前なら、終了日の欄に誤りを関連付けてフォーカスを移し、検索しない', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();
    const callsBefore = auditLogsVariablesOf(executeGraphQL).length;

    await userEvent.fill(fromInput(), '2026-11-05');
    await userEvent.fill(toInput(), '2026-11-01');
    await userEvent.click(applyButton());

    const message = '終了日には開始日と同じか後の日付を入力してください。';
    await expect.element(toInput()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(toInput()).toHaveAccessibleDescription(message);
    await expect.element(toInput()).toHaveFocus();
    expect(auditLogsVariablesOf(executeGraphQL)).toHaveLength(callsBefore);

    await userEvent.fill(toInput(), '2026-11-05');
    await userEvent.click(applyButton());

    await expect.element(toInput()).not.toHaveAttribute('aria-invalid');
    await expect
      .poll(() => auditLogsVariablesOf(executeGraphQL).length)
      .toBe(callsBefore + 1);
  });

  test('APIの日時で表せる範囲の外の日付は、その欄に誤りを関連付けて最初の誤りの欄へフォーカスを移し、検索しない', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();
    const callsBefore = auditLogsVariablesOf(executeGraphQL).length;

    await userEvent.fill(fromInput(), '9999-01-01');
    await userEvent.fill(toInput(), '9999-12-31');
    await userEvent.click(applyButton());

    const message =
      '日付は0001-01-01から9998-12-31までの範囲で入力してください。';
    for (const input of [fromInput(), toInput()]) {
      await expect.element(input).toHaveAttribute('aria-invalid', 'true');
      await expect.element(input).toHaveAccessibleDescription(message);
    }
    await expect.element(fromInput()).toHaveFocus();
    expect(auditLogsVariablesOf(executeGraphQL)).toHaveLength(callsBefore);

    await userEvent.fill(fromInput(), '9998-12-31');
    await userEvent.fill(toInput(), '9998-12-31');
    await userEvent.click(applyButton());

    await expect.element(fromInput()).not.toHaveAttribute('aria-invalid');
    await expect.element(toInput()).not.toHaveAttribute('aria-invalid');
    await expect.poll(lastVariables).toStrictEqual({
      filter: toAuditPeriod(
        { from: '9998-12-31', to: '9998-12-31' },
        browserTimeZone(),
      ),
    });
  });
});

describe('ページ送り', () => {
  const SECOND_PAGE = auditLogsQueryOf([EMAIL_SEARCH_ENTRY], null);
  const pages: AuditLogsHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? SECOND_PAGE
        : auditLogsQueryOf([INVITE_ENTRY, ROLE_CHANGE_ENTRY], 'cursor-2'),
    );

  test('「次へ」で続きのページを求め、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith(pages);
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect.element(rowOf('ユーザーのメールアドレス検索')).toBeVisible();
    await expect.element(rowOf('管理者の招待')).not.toBeInTheDocument();
    expect(lastVariables()).toStrictEqual({ filter: {}, after: 'cursor-2' });
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(nextButton()).toHaveFocus();
    await expect.element(previousButton()).not.toHaveAttribute('aria-disabled');

    await userEvent.click(previousButton());

    await expect.element(rowOf('管理者の招待')).toBeVisible();
    expect(router.state.location.search).toEqual({});
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
  });

  test('3ページ目からの「前へ」は1ページ目ではなく辿ってきた2ページ目へ戻る', async () => {
    const threePages: AuditLogsHandler = ({ after }) => {
      if (after === 'cursor-3') {
        return success(auditLogsQueryOf([EMAIL_SEARCH_ENTRY], null));
      }
      return success(
        after === 'cursor-2'
          ? auditLogsQueryOf([ROLE_CHANGE_ENTRY], 'cursor-3')
          : auditLogsQueryOf([INVITE_ENTRY], 'cursor-2'),
      );
    };
    const router = await renderWith(threePages);
    await expect.element(rowOf('管理者の招待')).toBeVisible();
    await userEvent.click(nextButton());
    await expect.element(rowOf('管理者のロールの変更')).toBeVisible();
    await userEvent.click(nextButton());
    await expect.element(rowOf('ユーザーのメールアドレス検索')).toBeVisible();
    expect(router.state.location.search).toEqual({ after: 'cursor-3' });

    await userEvent.click(previousButton());

    await expect.element(rowOf('管理者のロールの変更')).toBeVisible();
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });
    await expect.element(previousButton()).toHaveFocus();
    await expect.element(previousButton()).not.toHaveAttribute('aria-disabled');

    await userEvent.click(previousButton());

    await expect.element(rowOf('管理者の招待')).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  test('絞り込みを適用すると1ページ目から求め直す', async () => {
    const router = await renderWith(pages);
    await expect.element(table()).toBeVisible();
    await userEvent.click(nextButton());
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    await chooseOption(actionSelect(), '管理者の招待');
    await userEvent.click(applyButton());

    await expect
      .poll(lastVariables)
      .toStrictEqual({ filter: { action: 'admin-account.invite' } });
    expect(router.state.location.search).toEqual({
      action: 'admin-account.invite',
    });
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・削除済みの操作者の表示・期間の誤りがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await expect.element(table()).toBeVisible();
      await userEvent.fill(fromInput(), '2026-11-05');
      await userEvent.fill(toInput(), '2026-11-01');
      await userEvent.click(applyButton());
      await expect.element(toInput()).toHaveAttribute('aria-invalid', 'true');

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('キーボードだけで条件を入力して適用できる', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();
    targetInput().element().focus();

    await userEvent.keyboard(INVITED_ACCOUNT.id);
    await userEvent.keyboard('{Enter}');

    await expect
      .poll(lastVariables)
      .toStrictEqual({ filter: { targetId: INVITED_ACCOUNT.id } });
  });
});
