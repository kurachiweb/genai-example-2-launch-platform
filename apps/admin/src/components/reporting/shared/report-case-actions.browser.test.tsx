import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import {
  COMMENT_REPORT_TARGET,
  DETACHED_REPORT_TARGET,
  reportCaseViewOf,
  respondReportingGraphQL,
  UNAVAILABLE_REPORT_TARGET,
  USER_REPORT_TARGET,
} from '../../../../test/reporting-fixtures.ts';
import { renderReportCasePart } from '../../../../test/reporting-render.tsx';
import type { ReportCaseView } from '../../../graphql/admin-reporting-cases.ts';
import type { AdminRole } from '../../../graphql/generated/graphql.ts';
import { ReportCaseActions } from './report-case-actions.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const renderActions = async (
  reportCase: ReportCaseView,
  { role = 'MODERATOR' }: { readonly role?: AdminRole } = {},
) => {
  respondReportingGraphQL(executeGraphQL, { role });
  await renderReportCasePart(<ReportCaseActions reportCase={reportCase} />, {
    role,
  });
};

const buttonNames = (): readonly string[] =>
  page
    .getByRole('button')
    .elements()
    .map((element) => element.getAttribute('aria-label') ?? '');

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('操作の出し分け', () => {
  test.each(['open', 'in_progress'] as const)(
    'モデレーター以上で%sの案件には、措置・措置なしの対応済・却下を、見えている名前を含めて対象を示す名前で出す',
    async (status) => {
      await renderActions(reportCaseViewOf({ status }));

      await expect
        .element(
          page.getByRole('button', {
            name: 'Pitch Notes(pitch-notes)を非公開にする',
          }),
        )
        .toHaveTextContent('非公開にする');
      expect(buttonNames()).toStrictEqual([
        'Pitch Notes(pitch-notes)を非公開にする',
        'Pitch Notes(pitch-notes)の案件を措置なしで対応済にする',
        'Pitch Notes(pitch-notes)の通報を却下する',
      ]);
    },
  );

  test('ユーザーの案件の措置は「停止する」にする', async () => {
    await renderActions(reportCaseViewOf({ target: USER_REPORT_TARGET }));

    await expect
      .element(
        page.getByRole('button', { name: 'サンプル太郎(@maker_ai)を停止する' }),
      )
      .toHaveTextContent('停止する');
  });

  test('コメントの案件の措置は「非公開にする」にする', async () => {
    await renderActions(reportCaseViewOf({ target: COMMENT_REPORT_TARGET }));

    await expect
      .element(
        page.getByRole('button', {
          name: 'Pitch Notesへのコメントを非公開にする',
        }),
      )
      .toHaveTextContent('非公開にする');
  });

  test.each([UNAVAILABLE_REPORT_TARGET, DETACHED_REPORT_TARGET])(
    '措置できない対象の案件には、措置を出さず措置なしの対応済と却下を出す',
    async (target) => {
      await renderActions(reportCaseViewOf({ target }));

      await expect
        .element(page.getByRole('button', { name: /却下する$/u }))
        .toBeVisible();
      expect(buttonNames()).toHaveLength(2);
      expect(
        page.getByRole('button', { name: /非公開にする$/u }).query(),
      ).toBeNull();
    },
  );

  test.each(['resolved', 'rejected'] as const)(
    '%sの案件には操作を出さない',
    async (status) => {
      await renderActions(reportCaseViewOf({ status }));

      await expect.element(page.getByRole('main')).toBeInTheDocument();
      expect(buttonNames()).toStrictEqual([]);
    },
  );

  test('閲覧のみの管理者には操作を出さない', async () => {
    await renderActions(reportCaseViewOf(), { role: 'VIEWER' });

    await expect.element(page.getByRole('main')).toBeInTheDocument();
    expect(buttonNames()).toStrictEqual([]);
  });

  test('最上位管理者には操作を出す', async () => {
    await renderActions(reportCaseViewOf(), { role: 'SUPER_ADMIN' });

    await expect
      .element(page.getByRole('button', { name: /却下する$/u }))
      .toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('操作のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderActions(reportCaseViewOf());
    await expect
      .element(page.getByRole('button', { name: /却下する$/u }))
      .toBeVisible();

    expect(await runAxe(page.getByRole('main').element())).toStrictEqual([]);
  });
});
