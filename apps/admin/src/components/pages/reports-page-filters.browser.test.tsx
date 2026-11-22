import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { MODERATION_DISPLAY } from '../../../test/moderation-fixtures.ts';
import {
  applyButton,
  chooseOption,
  dateField,
  filterForm,
  filterSelect,
  INFRINGEMENT_CATEGORY_ID,
  listHeading,
  nextButton,
  optionNamesOf,
  previousButton,
  PRODUCT_CASE_NODE,
  REPORT_CASE_NODES,
  type ReportCasesHandler,
  reportCasesPageOf,
  reportCasesVariablesOf,
  reportsPageHarness,
  REPORTS_PATH,
  resetButton,
  rowOf,
  SPAM_CATEGORY_ID,
  table,
  USER_CASE_NODE,
} from '../../../test/reporting-reports-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, lastVariables } = reportsPageHarness(executeGraphQL);

const PRODUCT_LABEL = 'Pitch Notes(pitch-notes)';

const USER_LABEL = 'サンプル太郎(@maker_ai)';

// 一覧の先頭へのスクロールの回数。他の部品が呼ぶスクロールを数えない
const listScrollsOf = (
  scrollIntoView: { readonly mock: { readonly calls: unknown[][] } },
  behavior: ScrollBehavior,
): number =>
  scrollIntoView.mock.calls.filter(
    ([options]) =>
      JSON.stringify(options) === JSON.stringify({ block: 'start', behavior }),
  ).length;

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  vi.restoreAllMocks();
  toast.dismiss();
  await emulateReducedMotion('no-preference');
  await emulateBrowserDisplay(null);
});

describe('絞り込み', () => {
  test('対応ステータス・対象の種類・カテゴリ・受付日の期間を組み合わせて求め直し、期間を閲覧者の地域の暦の日の境界にし、条件をURLに残してページの位置を捨てる', async () => {
    const router = await renderWith({
      path: `${REPORTS_PATH}?after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });

    await chooseOption('対応ステータス', '対応中');
    await chooseOption('対象の種類', 'ユーザー');
    await chooseOption('カテゴリ', 'スパム');
    await dateField('受付日の開始日').fill('2026-11-01');
    await dateField('受付日の終了日').fill('2026-11-03');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        status: 'IN_PROGRESS',
        targetKind: 'USER',
        categoryId: SPAM_CATEGORY_ID,
        reportedFrom: '2026-10-31T15:00:00.000Z',
        reportedBefore: '2026-11-03T15:00:00.000Z',
      },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      status: 'IN_PROGRESS',
      target: 'USER',
      category: SPAM_CATEGORY_ID,
      from: '2026-11-01',
      to: '2026-11-03',
    });
    await expect.element(applyButton()).toHaveFocus();
  });

  test('片方の条件だけでも求め直し、権利侵害のカテゴリで権利侵害の案件を絞り込める', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await chooseOption('カテゴリ', '権利侵害');
    await dateField('受付日の終了日').fill('2026-11-03');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        categoryId: INFRINGEMENT_CATEGORY_ID,
        reportedBefore: '2026-11-03T15:00:00.000Z',
      },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      category: INFRINGEMENT_CATEGORY_ID,
      to: '2026-11-03',
    });
  });

  test('選択肢は、対応ステータスはすべてと4つの状態、対象の種類はすべてと3つの種類、カテゴリはすべてとAPIの順のカテゴリを示す', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    expect(await optionNamesOf('対応ステータス')).toStrictEqual([
      'すべてのステータス',
      '未対応',
      '対応中',
      '対応済',
      '却下',
    ]);
    expect(await optionNamesOf('対象の種類')).toStrictEqual([
      'すべての種類',
      'ユーザー',
      'プロダクト',
      'コメント',
    ]);
    expect(await optionNamesOf('カテゴリ')).toStrictEqual([
      'すべてのカテゴリ',
      '権利侵害',
      'スパム',
      'その他',
    ]);
  });

  test('URLの条件を絞り込みの欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith({
      path: `${REPORTS_PATH}?status=RESOLVED&target=COMMENT&category=${SPAM_CATEGORY_ID}&from=2026-11-01&to=2026-11-03&after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();
    await expect
      .element(filterSelect('対応ステータス'))
      .toHaveTextContent('対応済');
    await expect
      .element(filterSelect('対象の種類'))
      .toHaveTextContent('コメント');
    await expect.element(filterSelect('カテゴリ')).toHaveTextContent('スパム');
    await expect.element(dateField('受付日の開始日')).toHaveValue('2026-11-01');
    await expect.element(dateField('受付日の終了日')).toHaveValue('2026-11-03');
    expect(lastVariables()).toStrictEqual({
      filter: {
        status: 'RESOLVED',
        targetKind: 'COMMENT',
        categoryId: SPAM_CATEGORY_ID,
        reportedFrom: '2026-10-31T15:00:00.000Z',
        reportedBefore: '2026-11-03T15:00:00.000Z',
      },
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect
      .element(filterSelect('対応ステータス'))
      .toHaveTextContent('すべてのステータス');
    await expect
      .element(filterSelect('対象の種類'))
      .toHaveTextContent('すべての種類');
    await expect
      .element(filterSelect('カテゴリ'))
      .toHaveTextContent('すべてのカテゴリ');
    await expect.element(dateField('受付日の開始日')).toHaveValue('');
    await expect.element(resetButton()).toHaveFocus();
  });

  test('URLの不正な状態・種類・カテゴリ・日付・ページの位置と、開始日が終了日より後の期間は、未指定として1ページ目を求める', async () => {
    await renderWith({
      path: `${REPORTS_PATH}?status=open&target=post&category=not-a-ulid&from=2026-11-05&to=2026-11-01&after=${'c'.repeat(257)}`,
    });

    await expect.element(table()).toBeVisible();
    await expect
      .element(filterSelect('対応ステータス'))
      .toHaveTextContent('すべてのステータス');
    await expect
      .element(filterSelect('対象の種類'))
      .toHaveTextContent('すべての種類');
    await expect.element(dateField('受付日の開始日')).toHaveValue('');
    await expect.element(dateField('受付日の終了日')).toHaveValue('');
    expect(reportCasesVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {}, first: 50 },
    ]);
  });

  test('終了日が開始日より前なら適用せず、終了日の欄に誤りを関連付けて示し、その欄へフォーカスを移す', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await dateField('受付日の開始日').fill('2026-11-05');
    await dateField('受付日の終了日').fill('2026-11-01');
    await userEvent.click(applyButton());

    await expect.element(dateField('受付日の終了日')).toHaveFocus();
    await expect
      .element(dateField('受付日の終了日'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(dateField('受付日の終了日'))
      .toHaveAccessibleDescription(
        '終了日には開始日と同じか後の日付を入力してください。',
      );
    expect(router.state.location.search).toEqual({});
    expect(reportCasesVariablesOf(executeGraphQL)).toHaveLength(1);
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('カテゴリの選択肢の取得に失敗しても一覧を示し、カテゴリの欄は「すべてのカテゴリ」だけで操作できる', async () => {
    await renderWith({
      categories: () =>
        failure({
          code: 'internal_error',
          message: 'サーバーで問題が起きました。',
          status: 500,
        }),
    });

    await expect.element(rowOf(PRODUCT_LABEL)).toBeVisible();
    await expect.element(filterSelect('カテゴリ')).toBeEnabled();
    expect(await optionNamesOf('カテゴリ')).toStrictEqual(['すべてのカテゴリ']);
  });

  test('条件を変えて取り直す間は、前の一覧を操作できないまま表示し続け、絞り込みは操作でき、一覧の先頭へスクロールせずフォーカスを「適用」に残す', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    let release: (() => void) | undefined;
    await renderWith({
      role: 'MODERATOR',
      cases: ({ filter }) =>
        filter?.status === undefined
          ? success(reportCasesPageOf(REPORT_CASE_NODES))
          : new Promise((resolve) => {
              release = () => {
                resolve({
                  ok: true,
                  data: reportCasesPageOf([USER_CASE_NODE]),
                });
              };
            }),
    });
    await expect.element(table()).toBeVisible();

    await chooseOption('対応ステータス', '対応中');
    await userEvent.click(applyButton());

    await expect.poll(() => release).toBeDefined();
    await expect.element(rowOf(PRODUCT_LABEL)).toBeInTheDocument();
    expect(table().element().closest('[aria-busy="true"]')).not.toBeNull();
    expect(table().element().closest('[inert]')).not.toBeNull();
    expect(filterForm().element().closest('[inert]')).toBeNull();
    expect(listHeading().element().closest('[inert]')).toBeNull();
    expect(await runAxe(document.body)).toStrictEqual([]);

    release?.();

    await expect.element(rowOf(PRODUCT_LABEL)).not.toBeInTheDocument();
    await expect.element(rowOf(USER_LABEL)).toBeVisible();
    expect(table().element().closest('[aria-busy="true"]')).toBeNull();
    expect(table().element().closest('[inert]')).toBeNull();
    await expect.element(applyButton()).toHaveFocus();
    expect(listScrollsOf(scrollIntoView, 'smooth')).toBe(0);
    expect(listScrollsOf(scrollIntoView, 'auto')).toBe(0);
  });
});

describe('ページ送り', () => {
  const pages: ReportCasesHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? reportCasesPageOf([USER_CASE_NODE])
        : reportCasesPageOf([PRODUCT_CASE_NODE], 'cursor-2'),
    );

  // 最初の表示の後の取得だけを止め、移動の間に押したボタンが操作できない状態になる時間を作る
  const heldPages = () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const cases: ReportCasesHandler = (variables) => {
      calls += 1;
      const response = pages(variables);
      return calls === 1
        ? response
        : new Promise((resolve) => {
            release = () => {
              resolve(response);
            };
          });
    };
    return { cases, release: () => release?.(), held: () => release };
  };

  test('「次へ」で条件を保って続きのページを求めてURLにカーソルを残し、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith({
      cases: pages,
      path: `${REPORTS_PATH}?status=OPEN`,
    });
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect.element(rowOf(USER_LABEL)).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: { status: 'OPEN' },
      first: 50,
      after: 'cursor-2',
    });
    expect(router.state.location.search).toEqual({
      status: 'OPEN',
      after: 'cursor-2',
    });
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(previousButton());

    await expect.element(rowOf(PRODUCT_LABEL)).toBeVisible();
    expect(router.state.location.search).toEqual({ status: 'OPEN' });
  });

  test.each([
    {
      name: '次へ',
      path: REPORTS_PATH,
      button: nextButton,
      arrived: USER_LABEL,
    },
    {
      name: '前へ',
      path: `${REPORTS_PATH}?after=cursor-2`,
      button: previousButton,
      arrived: PRODUCT_LABEL,
    },
  ])(
    'キーボードで「$name」を押すと、取り直す間も結果が届いた後も一覧の見出しにフォーカスを置き、一覧の先頭へ滑らかにスクロールする',
    async ({ path, button, arrived }) => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      const pending = heldPages();
      await renderWith({ cases: pending.cases, path });
      await expect.element(table()).toBeVisible();

      button().element().focus();
      await userEvent.keyboard('{Enter}');

      await expect.poll(pending.held).toBeDefined();
      expect(document.activeElement).toBe(listHeading().element());
      expect(table().element().closest('[inert]')).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        behavior: 'smooth',
      });

      pending.release();

      await expect.element(rowOf(arrived)).toBeVisible();
      expect(document.activeElement).toBe(listHeading().element());
      expect(listScrollsOf(scrollIntoView, 'smooth')).toBeGreaterThan(0);
    },
  );

  test('視差効果を減らす設定では、一覧の先頭へ即座にスクロールする', async () => {
    await emulateReducedMotion('reduce');
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ cases: pages });
    await expect.element(table()).toBeVisible();

    nextButton().element().focus();
    await userEvent.keyboard('{Enter}');

    await expect.element(rowOf(USER_LABEL)).toBeVisible();
    expect(listScrollsOf(scrollIntoView, 'auto')).toBeGreaterThan(0);
    expect(listScrollsOf(scrollIntoView, 'smooth')).toBe(0);
    expect(document.activeElement).toBe(listHeading().element());
  });

  test('移る先の無い「前へ」は押してもフォーカスとスクロールを動かさない', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ cases: pages });
    await expect.element(table()).toBeVisible();

    previousButton().element().focus();
    await userEvent.keyboard('{Enter}');

    expect(document.activeElement).toBe(previousButton().element());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
