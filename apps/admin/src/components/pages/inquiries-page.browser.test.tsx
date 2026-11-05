import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resolveBrowserDisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  BUG_CATEGORY,
  FIRST_PAGE,
  GUEST_ENTRY,
  INQUIRIES_PATH,
  type InquiriesHandler,
  inquiriesQueryOf,
  inquiriesVariablesOf,
  MEMBER_ENTRY,
  MEMBER_INQUIRY_ID,
  renderAdminInquiriesPage,
  respondAdminInquiriesGraphQL,
  WITHDRAWN_ENTRY,
} from '../../../test/admin-inquiries-fixtures.ts';
import { Route as InquiriesRoute } from '../../routes/_authenticated/inquiries/index.tsx';
import { loadAdminInquiriesPage } from '../../graphql/admin-inquiries.ts';
import { toAdminInquirySearch } from '../inquiry/admin-inquiry-search.ts';
import { toInquiryPeriod } from '../inquiry/inquiry-period.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: '問い合わせの一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const statusSelect = () =>
  filterForm().getByRole('combobox', { name: '対応ステータス' });
const kindSelect = () => filterForm().getByRole('combobox', { name: '種別' });
const categorySelect = () =>
  filterForm().getByRole('combobox', { name: 'カテゴリ' });
const fromInput = () => filterForm().getByLabelText('受付日の開始日');
const toInput = () => filterForm().getByLabelText('受付日の終了日');
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
const pagination = () => main().getByRole('navigation', { name: 'ページ送り' });
const nextButton = () => pagination().getByRole('button', { name: '次へ' });
const previousButton = () => pagination().getByRole('button', { name: '前へ' });

const lastVariables = () => inquiriesVariablesOf(executeGraphQL).at(-1);

const browserTimeZone = () => resolveBrowserDisplayPreferences().timeZone;

async function chooseOption(
  trigger: ReturnType<typeof statusSelect>,
  name: string,
): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

const renderWith = async (
  inquiries?: InquiriesHandler,
  path: string = INQUIRIES_PATH,
) => {
  respondAdminInquiriesGraphQL(executeGraphQL, {
    role: 'VIEWER',
    ...(inquiries === undefined ? {} : { inquiries }),
  });
  return renderAdminInquiriesPage('VIEWER', path);
};

const cellTexts = (text: string) =>
  [...rowOf(text).element().querySelectorAll('td')].map(
    (cell) => cell.textContent,
  );

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = { status: 'OPEN', after: 'cursor-2' };

  expect(InquiriesRoute.options.validateSearch).toBe(toAdminInquirySearch);
  expect(InquiriesRoute.options.loader).toBe(loadAdminInquiriesPage);
  expect(
    (
      InquiriesRoute.options.loaderDeps as (input: {
        search: unknown;
      }) => unknown
    )({ search }),
  ).toBe(search);
});

describe('問い合わせの一覧', () => {
  test('条件を付けずに求め、受付日時・種別・カテゴリ・対応ステータス・送信者・最後のメッセージをAPIの順(受付日時の新しい順)に表示する', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('問い合わせ');
    expect(lastVariables()).toStrictEqual({ filter: {} });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      '受付日時',
      '種別',
      'カテゴリ',
      '対応ステータス',
      '送信者',
      '最後のメッセージ',
    ]);
    const receivedTimes = table()
      .getByRole('row')
      .elements()
      .slice(1)
      .map((row) => row.querySelector('time')?.getAttribute('datetime'));
    expect(receivedTimes).toStrictEqual([
      MEMBER_ENTRY.createdAt,
      WITHDRAWN_ENTRY.createdAt,
      GUEST_ENTRY.createdAt,
    ]);
    expect(cellTexts(MEMBER_ENTRY.senderName)).toStrictEqual([
      '2026年11月4日(水) 10:00',
      'ログイン',
      '不具合の報告',
      '対応中',
      'サンプル太郎',
      '2026年11月4日(水) 14:30',
    ]);
    expect(cellTexts(GUEST_ENTRY.senderName)).toStrictEqual([
      '2026年11月2日(月) 12:00',
      '未ログイン',
      'その他',
      '対応済',
      '訪問者',
      '2026年11月2日(月) 12:00',
    ]);
  });

  test('退会済みの問い合わせは送信者の隣に「退会済み」と表示する', async () => {
    await renderWith();

    await expect
      .element(rowOf(WITHDRAWN_ENTRY.senderName))
      .toHaveTextContent('退会した花子退会済み');
    await expect
      .element(rowOf(MEMBER_ENTRY.senderName))
      .not.toHaveTextContent('退会済み');
  });

  test('送信者のリンクで問い合わせの詳細のページを開く', async () => {
    const router = await renderWith();

    await userEvent.click(
      rowOf(MEMBER_ENTRY.senderName).getByRole('link', {
        name: MEMBER_ENTRY.senderName,
      }),
    );

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('問い合わせの詳細');
    expect(router.state.location.pathname).toBe(
      `${INQUIRIES_PATH}/${MEMBER_INQUIRY_ID}`,
    );
  });

  test('条件に一致する問い合わせが無ければ空の状態を示す', async () => {
    await renderWith(() => success(inquiriesQueryOf([])));

    await expect
      .element(main().getByText('条件に一致する問い合わせはありません。'))
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
        main().getByRole('heading', { level: 2, name: '問い合わせの一覧' }),
      )
      .toHaveFocus();
  });
});

describe('絞り込み', () => {
  test('ステータス・種別・カテゴリ・受付日の期間の条件をすべて満たす問い合わせを求め、閲覧者の地域の日付をUTCの期間にし、条件をURLに残す', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await chooseOption(statusSelect(), '未対応');
    await chooseOption(kindSelect(), '未ログイン');
    await chooseOption(categorySelect(), BUG_CATEGORY.name);
    await userEvent.fill(fromInput(), '2026-11-01');
    await userEvent.fill(toInput(), '2026-11-04');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        status: 'OPEN',
        kind: 'GUEST',
        categoryId: BUG_CATEGORY.id,
        ...toInquiryPeriod(
          { from: '2026-11-01', to: '2026-11-04' },
          browserTimeZone(),
        ),
      },
    });
    expect(router.state.location.search).toEqual({
      status: 'OPEN',
      kind: 'GUEST',
      category: BUG_CATEGORY.id,
      from: '2026-11-01',
      to: '2026-11-04',
    });
    await expect.element(applyButton()).toHaveFocus();
  });

  test('URLの条件を入力欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith(
      undefined,
      `${INQUIRIES_PATH}?status=OPEN&kind=MEMBER&category=${BUG_CATEGORY.id}&from=2026-11-01`,
    );
    await expect.element(statusSelect()).toHaveTextContent('未対応');
    await expect.element(kindSelect()).toHaveTextContent('ログイン');
    await expect.element(categorySelect()).toHaveTextContent(BUG_CATEGORY.name);
    await expect.element(fromInput()).toHaveValue('2026-11-01');
    expect(lastVariables()).toStrictEqual({
      filter: {
        status: 'OPEN',
        kind: 'MEMBER',
        categoryId: BUG_CATEGORY.id,
        ...toInquiryPeriod({ from: '2026-11-01' }, browserTimeZone()),
      },
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {} });
    expect(router.state.location.search).toEqual({});
    await expect
      .element(statusSelect())
      .toHaveTextContent('すべてのステータス');
    await expect.element(kindSelect()).toHaveTextContent('すべての種別');
    await expect
      .element(categorySelect())
      .toHaveTextContent('すべてのカテゴリ');
    await expect.element(fromInput()).toHaveValue('');
  });

  test('ステータスの選択肢は4種を表示名で並べ、カテゴリの選択肢はAPIの順に並べる', async () => {
    await renderWith();

    await userEvent.click(statusSelect());
    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual([
      'すべてのステータス',
      '未対応',
      '対応中',
      '対応済',
      '却下',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(categorySelect());
    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual(['すべてのカテゴリ', '不具合の報告', 'その他']);
  });

  test('終了日が開始日より前なら、終了日の欄に誤りを関連付けてフォーカスを移し、求めない', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();
    const callsBefore = inquiriesVariablesOf(executeGraphQL).length;

    await userEvent.fill(fromInput(), '2026-11-05');
    await userEvent.fill(toInput(), '2026-11-01');
    await userEvent.click(applyButton());

    await expect.element(toInput()).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(toInput())
      .toHaveAccessibleDescription(
        '終了日には開始日と同じか後の日付を入力してください。',
      );
    await expect.element(toInput()).toHaveFocus();
    expect(inquiriesVariablesOf(executeGraphQL)).toHaveLength(callsBefore);
  });
});

describe('ページ送り', () => {
  const pages: InquiriesHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? inquiriesQueryOf([GUEST_ENTRY], null)
        : inquiriesQueryOf([MEMBER_ENTRY, WITHDRAWN_ENTRY], 'cursor-2'),
    );

  test('「次へ」で続きのページを求め、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith(pages);
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect.element(rowOf(GUEST_ENTRY.senderName)).toBeVisible();
    await expect
      .element(rowOf(MEMBER_ENTRY.senderName))
      .not.toBeInTheDocument();
    expect(lastVariables()).toStrictEqual({ filter: {}, after: 'cursor-2' });
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(previousButton());

    await expect.element(rowOf(MEMBER_ENTRY.senderName)).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  test('APIが返す1ページの50件をすべて表示し、続きがあれば「次へ」を押せる', async () => {
    const fifty = Array.from({ length: 50 }, (_, index) => ({
      ...MEMBER_ENTRY,
      id: `${MEMBER_ENTRY.id}-${String(index)}`,
      senderName: `利用者${String(index)}`,
    }));
    await renderWith(() => success(inquiriesQueryOf(fifty, 'cursor-2')));

    await expect.element(rowOf('利用者49')).toBeVisible();
    expect(table().getByRole('row').elements()).toHaveLength(51);
    await expect.element(nextButton()).not.toHaveAttribute('aria-disabled');
  });

  test('記録の無い途中のページ(共有したURL)の「前へ」は1ページ目へ戻り、絞り込みを保つ', async () => {
    const router = await renderWith(
      pages,
      `${INQUIRIES_PATH}?status=OPEN&after=cursor-2`,
    );
    await expect.element(rowOf(GUEST_ENTRY.senderName)).toBeVisible();

    await userEvent.click(previousButton());

    await expect.element(rowOf(MEMBER_ENTRY.senderName)).toBeVisible();
    expect(router.state.location.search).toEqual({ status: 'OPEN' });
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・退会済みの表示・期間の誤りがWCAG 2.2 AAの自動検査に違反しない',
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
});
