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
import {
  MODERATION_DISPLAY,
  MODERATION_ROLES,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import { buttonBehindDialog } from '../../../test/moderation-render.tsx';
import {
  REPORT_CASE_ID,
  REPORT_REASON,
  reportCaseOutcomeOf,
} from '../../../test/reporting-fixtures.ts';
import {
  actionButton,
  cellTexts,
  COMMENT_CASE_NODE,
  DETACHED_CASE_NODE,
  dialog,
  listHeading,
  main,
  PRODUCT_CASE_NODE,
  REPORT_CASE_DETAIL_STUB_HEADING,
  reportCasesPageOf,
  reportsPageHarness,
  REPORTS_PATH,
  reasonBox,
  rowOf,
  table,
  UNAVAILABLE_CASE_NODE,
  USER_CASE_NODE,
} from '../../../test/reporting-reports-page.tsx';
import {
  AdminRejectReportCaseDocument,
  AdminResolveReportCaseWithMeasureDocument,
  AdminResolveReportCaseWithoutMeasureDocument,
} from '../../graphql/generated/graphql.ts';
import { Route as ReportsRoute } from '../../routes/_authenticated/reports/index.tsx';
import { loadReportsPage } from '../reporting/shared/load-reports-page.ts';
import { toReportSearch } from '../reporting/shared/report-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, lastVariables } = reportsPageHarness(executeGraphQL);

const PRODUCT_LABEL = 'Pitch Notes(pitch-notes)';

const USER_LABEL = 'サンプル太郎(@maker_ai)';

const COMMENT_LABEL = 'Pitch Notesへのコメント';

const UNAVAILABLE_LABEL = '表示できない対象';

const DETACHED_LABEL = '削除された対象';

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = toReportSearch({
    status: 'OPEN',
    from: '2026-11-01',
    after: 'cursor-2',
  });

  expect(ReportsRoute.options.validateSearch).toBe(toReportSearch);
  expect(ReportsRoute.options.loader).toBe(loadReportsPage);
  expect(
    (
      ReportsRoute.options.loaderDeps as (input: { search: unknown }) => unknown
    )({ search }),
  ).toStrictEqual(search);
});

describe('通報の案件の一覧', () => {
  test('条件を付けずに1ページ目の50件を求め、題名と説明と、対象・件数・カテゴリごとの件数・対応ステータス・最初と最後の受付日時・対応期間・操作の列を示す', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('通報');
    await expect
      .element(
        main().getByText(
          '同じ対象への通報をまとめた案件を、最後の受付日時の新しい順に表示します。',
        ),
      )
      .toBeVisible();
    expect(lastVariables()).toStrictEqual({ filter: {}, first: 50 });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      '対象',
      '件数',
      'カテゴリごとの件数',
      '対応ステータス',
      '最初の受付日時',
      '最後の受付日時',
      '対応期間',
      '操作',
    ]);
    expect(cellTexts(PRODUCT_LABEL).slice(0, 7)).toStrictEqual([
      `プロダクト${PRODUCT_LABEL}`,
      '3件',
      '権利侵害 2件その他 1件',
      '未対応',
      '2026年11月1日(日) 09:00',
      '2026年11月2日(月) 12:00',
      '対応中 4時間',
    ]);
    await expect
      .element(rowOf(PRODUCT_LABEL).getByText('2026年11月1日(日) 09:00'))
      .toHaveAttribute('datetime', PRODUCT_CASE_NODE.firstReportedAt);
    await expect
      .element(rowOf(PRODUCT_LABEL).getByText('2026年11月2日(月) 12:00'))
      .toHaveAttribute('datetime', PRODUCT_CASE_NODE.lastReportedAt);
  });

  test('対象の種類ごとの表示と、件数の3桁区切り、権利侵害でない案件の対応期間を示さないこと、完了した案件の対応期間と目標の超過を示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    expect(cellTexts(USER_LABEL).slice(0, 4)).toStrictEqual([
      `ユーザー${USER_LABEL}`,
      '1,234件',
      'スパム 1,234件',
      '対応中',
    ]);
    expect(cellTexts(USER_LABEL)[6]).toBe('');
    expect(cellTexts(COMMENT_LABEL)[0]).toBe(
      `コメント${COMMENT_LABEL}${COMMENT_CASE_NODE.target.excerpt ?? ''}`,
    );
    expect(
      rowOf(COMMENT_LABEL).element().querySelector('strong, b'),
    ).toBeNull();
    expect(cellTexts(UNAVAILABLE_LABEL)[0]).toBe(
      `プロダクト${UNAVAILABLE_LABEL}`,
    );
    expect(cellTexts(DETACHED_LABEL).slice(0, 1)).toStrictEqual([
      `コメント${DETACHED_LABEL}`,
    ]);
    expect(cellTexts(DETACHED_LABEL).slice(3)).toStrictEqual([
      '対応済',
      '2026年11月1日(日) 09:00',
      '2026年11月2日(月) 12:00',
      '対応期間 10日4時間判断の目標(9日)を超えています',
      '',
    ]);
  });

  test('対象の表示から案件の詳細へ移る', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await userEvent.click(
      rowOf(USER_LABEL).getByRole('link', { name: USER_LABEL }),
    );

    await expect
      .element(
        page.getByRole('heading', { name: REPORT_CASE_DETAIL_STUB_HEADING }),
      )
      .toBeVisible();
    expect(router.state.location.pathname).toBe(
      `${REPORTS_PATH}/${USER_CASE_NODE.id}`,
    );
  });

  test('表示できない対象と削除された対象の案件も詳細への導線を持つ', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    await expect
      .element(
        rowOf(UNAVAILABLE_LABEL).getByRole('link', { name: UNAVAILABLE_LABEL }),
      )
      .toHaveAttribute('href', `${REPORTS_PATH}/${UNAVAILABLE_CASE_NODE.id}`);
    await expect
      .element(
        rowOf(DETACHED_LABEL).getByRole('link', { name: DETACHED_LABEL }),
      )
      .toHaveAttribute('href', `${REPORTS_PATH}/${DETACHED_CASE_NODE.id}`);
  });

  test('該当する案件が無ければ一覧の位置にその旨を示す', async () => {
    await renderWith({ cases: () => success(reportCasesPageOf([])) });

    await expect
      .element(main().getByText('該当する通報はありません。'))
      .toBeVisible();
  });

  test('一覧の取得の失敗は一覧の位置に文言と再試行を示して問い合わせの導線を出さず、再試行で一覧の見出しへフォーカスを移して取り直す', async () => {
    let available = false;
    await renderWith({
      cases: () =>
        available
          ? success(reportCasesPageOf([PRODUCT_CASE_NODE]))
          : failure({
              code: 'internal_error',
              message: 'サーバーで問題が起きました。',
              status: 500,
            }),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('サーバーで問題が起きました。');
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
    expect(await runAxe(document.body)).toStrictEqual([]);
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(rowOf(PRODUCT_LABEL)).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('閲覧のみの管理者には案件の操作を出さない', async () => {
    await renderWith({ role: 'VIEWER' });
    await expect.element(table()).toBeVisible();

    expect(table().getByRole('button').elements()).toHaveLength(0);
  });
});

describe('案件の操作', () => {
  test.each(MODERATION_ROLES)(
    '%sには未完了の案件の行に対象の種類に応じた操作を出し、表示できない対象と削除された対象の行には措置を出さず、完了した案件の行には操作を出さない',
    async (role) => {
      await renderWith({ role });
      await expect.element(table()).toBeVisible();

      const actionsOf = (label: string) =>
        rowOf(label)
          .getByRole('button')
          .elements()
          .map((button) => button.textContent);
      expect(actionsOf(PRODUCT_LABEL)).toStrictEqual([
        '非公開にする',
        '措置なしで対応済にする',
        '却下する',
      ]);
      expect(actionsOf(USER_LABEL)[0]).toBe('停止する');
      expect(actionsOf(COMMENT_LABEL)[0]).toBe('非公開にする');
      expect(actionsOf(UNAVAILABLE_LABEL)).toStrictEqual([
        '措置なしで対応済にする',
        '却下する',
      ]);
      expect(actionsOf(DETACHED_LABEL)).toStrictEqual([]);
    },
  );

  test.each([
    {
      name: `${PRODUCT_LABEL}を非公開にする`,
      title: 'プロダクト『Pitch Notes』を非公開にしますか?',
    },
    {
      name: `${USER_LABEL}を停止する`,
      title: 'サンプル太郎を停止しますか?',
    },
    {
      name: `${PRODUCT_LABEL}の案件を措置なしで対応済にする`,
      title: '措置をせずに対応済にしますか?',
    },
    {
      name: `${PRODUCT_LABEL}の通報を却下する`,
      title: 'この通報を却下しますか?',
    },
    {
      name: `${UNAVAILABLE_LABEL}の通報を却下する`,
      title: 'この通報を却下しますか?',
    },
  ])('「$name」から確認のダイアログを開く', async ({ name, title }) => {
    await renderWith({ role: 'MODERATOR' });
    await expect.element(table()).toBeVisible();

    await userEvent.click(actionButton(name));

    await expect
      .element(dialog().getByRole('heading', { name: title }))
      .toBeVisible();
  });

  test('表示できない対象の行があっても、他の行の措置を確定でき、案件と理由で操作する', async () => {
    const resolve = vi.fn(() =>
      reportCaseOutcomeOf('resolveReportCaseWithMeasure', 'RESOLVED'),
    );
    await renderWith({
      role: 'MODERATOR',
      handlers: new Map([[AdminResolveReportCaseWithMeasureDocument, resolve]]),
    });
    await expect.element(rowOf(UNAVAILABLE_LABEL)).toBeVisible();

    await userEvent.click(actionButton(`${PRODUCT_LABEL}を非公開にする`));
    await reasonBox().fill(REPORT_REASON);
    await dialog().getByRole('button', { name: '非公開にする' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminResolveReportCaseWithMeasureDocument),
    ).toStrictEqual([{ id: REPORT_CASE_ID, reason: REPORT_REASON }]);
    await expect.element(page.getByText('対応済にしました。')).toBeVisible();
  });

  test('未対応で絞った一覧で確定して行が消えても確認のダイアログは結果を示すまで残り、確定の後は一覧の見出しへフォーカスを移す', async () => {
    let resolved = false;
    await renderWith({
      role: 'MODERATOR',
      path: `${REPORTS_PATH}?status=OPEN`,
      cases: () =>
        success(reportCasesPageOf(resolved ? [] : [PRODUCT_CASE_NODE])),
      handlers: new Map([
        [
          AdminRejectReportCaseDocument,
          () => {
            resolved = true;
            return reportCaseOutcomeOf('rejectReportCase', 'REJECTED');
          },
        ],
      ]),
    });
    await expect.element(rowOf(PRODUCT_LABEL)).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: { status: 'OPEN' },
      first: 50,
    });

    await userEvent.click(actionButton(`${PRODUCT_LABEL}の通報を却下する`));
    await reasonBox().fill(REPORT_REASON);
    await dialog().getByRole('button', { name: '却下する' }).click();

    await expect.element(page.getByText('却下しました。')).toBeVisible();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(main().getByText('該当する通報はありません。'))
      .toBeVisible();
    expect(
      buttonBehindDialog(`${PRODUCT_LABEL}の通報を却下する`).query(),
    ).toBeNull();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('措置なしの対応済の失敗は確認のダイアログの中に示して理由を保つ', async () => {
    await renderWith({
      role: 'MODERATOR',
      handlers: new Map([
        [
          AdminResolveReportCaseWithoutMeasureDocument,
          () =>
            failure({
              code: 'report_case_state_conflict',
              message:
                '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
              status: 409,
            }),
        ],
      ]),
    });
    await expect.element(table()).toBeVisible();

    await userEvent.click(
      actionButton(`${PRODUCT_LABEL}の案件を措置なしで対応済にする`),
    );
    await reasonBox().fill(REPORT_REASON);
    await dialog().getByRole('button', { name: '対応済にする' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
      );
    await expect.element(reasonBox()).toHaveValue(REPORT_REASON);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・案件の操作がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'MODERATOR' });
      await expect.element(table()).toBeVisible();
      await expect.element(rowOf(DETACHED_LABEL)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('該当なしと取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWith({ cases: () => success(reportCasesPageOf([])) });
    await expect
      .element(main().getByText('該当する通報はありません。'))
      .toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('一覧から開いた確認のダイアログがWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(actionButton(`${USER_LABEL}を停止する`));
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
