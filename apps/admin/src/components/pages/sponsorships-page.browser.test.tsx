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
  DELETED_PRODUCT_ROW,
  FIRST_PAGE,
  PAUSED_ROW,
  PENDING_ROW,
  renderAdminSponsorshipsPage,
  respondAdminSponsorshipsGraphQL,
  SCHEDULED_ROW,
  SPONSORSHIPS_PATH,
  type SponsorshipsHandler,
  sponsorshipsQueryOf,
  sponsorshipsVariablesOf,
  type TerminateHandler,
  terminateVariablesOf,
  terminationResultOf,
} from '../../../test/admin-sponsorships-fixtures.ts';
import type { AdminRole } from '../../graphql/generated/graphql.ts';
import { loadAdminSponsorshipsPage } from '../../graphql/admin-sponsorships.ts';
import { Route as SponsorshipsRoute } from '../../routes/_authenticated/sponsorships/index.tsx';
import { toAdminSponsorshipSearch } from '../sponsorship/admin-sponsorship-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: 'スポンサー広告の一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const statusSelect = () =>
  filterForm().getByRole('combobox', { name: '掲載状況' });
const tierSelect = () => filterForm().getByRole('combobox', { name: 'ティア' });
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
const pagination = () => main().getByRole('navigation', { name: 'ページ送り' });
const nextButton = () => pagination().getByRole('button', { name: '次へ' });
const previousButton = () => pagination().getByRole('button', { name: '前へ' });
const terminateButtons = () =>
  table().getByRole('button', { name: /を強制終了$/u });

const lastVariables = () => sponsorshipsVariablesOf(executeGraphQL).at(-1);

async function chooseOption(
  trigger: ReturnType<typeof statusSelect>,
  name: string,
): Promise<void> {
  await userEvent.click(trigger);
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

const renderWith = async ({
  role = 'VIEWER',
  sponsorships,
  terminate,
  path = SPONSORSHIPS_PATH,
}: {
  readonly role?: AdminRole;
  readonly sponsorships?: SponsorshipsHandler;
  readonly terminate?: TerminateHandler;
  readonly path?: string;
} = {}) => {
  respondAdminSponsorshipsGraphQL(executeGraphQL, {
    role,
    ...(sponsorships === undefined ? {} : { sponsorships }),
    ...(terminate === undefined ? {} : { terminate }),
  });
  return renderAdminSponsorshipsPage(role, path);
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
  const search = { status: 'ACTIVE', after: 'cursor-2' };

  expect(SponsorshipsRoute.options.validateSearch).toBe(
    toAdminSponsorshipSearch,
  );
  expect(SponsorshipsRoute.options.loader).toBe(loadAdminSponsorshipsPage);
  expect(
    (
      SponsorshipsRoute.options.loaderDeps as (input: {
        search: unknown;
      }) => unknown
    )({ search }),
  ).toBe(search);
});

describe('申込状況の一覧', () => {
  test('条件を付けずに1ページ目の50件を求め、申込ID・プロダクト・申込者・ティア・掲載期間と日数・支払った金額・掲載状況・申込日時をAPIの順(申込の新しい順)に表示する', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('スポンサー広告');
    expect(lastVariables()).toStrictEqual({ filter: {}, first: 50 });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      '申込ID',
      'プロダクト',
      '申込者',
      'ティア',
      '掲載期間',
      '支払った金額',
      '掲載状況',
      '申込日時',
      '操作',
    ]);
    const ids = table()
      .getByRole('row')
      .elements()
      .slice(1)
      .map((row) => row.querySelector('td')?.textContent);
    expect(ids).toStrictEqual([
      SCHEDULED_ROW.id,
      PAUSED_ROW.id,
      DELETED_PRODUCT_ROW.id,
      PENDING_ROW.id,
    ]);
    expect(cellTexts(SCHEDULED_ROW.id)).toStrictEqual([
      SCHEDULED_ROW.id,
      'サンプルアプリsample_app',
      'サンプル太郎',
      'Gold',
      '2026年12月1日(火)〜2026年12月7日(月)7日間',
      '$70.00',
      '掲載予定',
      '2026年11月18日(水) 10:00',
      '',
    ]);
    await expect
      .element(rowOf(SCHEDULED_ROW.id).getByText('2026年12月1日(火)'))
      .toHaveAttribute('datetime', '2026-12-01');
  });

  test('表示停止の状態の広告に「表示停止中」の印を、論理削除されたプロダクトに「削除済みのプロダクト」を示し、未決済の金額は「—」にする', async () => {
    await renderWith();

    await expect
      .element(rowOf(PAUSED_ROW.id).getByText('表示停止中', { exact: true }))
      .toHaveAttribute('data-slot', 'badge');
    expect(cellTexts(DELETED_PRODUCT_ROW.id).slice(1, 3)).toStrictEqual([
      '削除済みのプロダクト',
      'サンプル花子',
    ]);
    expect(cellTexts(DELETED_PRODUCT_ROW.id)[6]).toBe('終了');
    expect(cellTexts(PENDING_ROW.id).slice(2, 7)).toStrictEqual([
      '表示できない利用者',
      'Silver',
      '2027年1月5日(火)〜2027年1月5日(火)1日間',
      '—',
      '未決済',
    ]);
  });

  test.each<AdminRole>(['MODERATOR', 'SUPER_ADMIN'])(
    '%sには、強制終了できる掲載予定・掲載中(表示停止中を含む)の行にだけ、対象の申込IDを名前に含む「強制終了」を置く',
    async (role) => {
      await renderWith({ role });

      await expect.element(table()).toBeVisible();
      expect(
        terminateButtons()
          .elements()
          .map((button) => button.getAttribute('aria-label')),
      ).toStrictEqual([
        `申込${SCHEDULED_ROW.id}を強制終了`,
        `申込${PAUSED_ROW.id}を強制終了`,
      ]);
      await expect
        .element(
          rowOf(SCHEDULED_ROW.id).getByRole('button', {
            name: `申込${SCHEDULED_ROW.id}を強制終了`,
          }),
        )
        .toHaveTextContent('強制終了');
    },
  );

  test('閲覧のみの管理者には「強制終了」を出さない', async () => {
    await renderWith({ role: 'VIEWER' });

    await expect.element(table()).toBeVisible();
    expect(terminateButtons().elements()).toHaveLength(0);
  });

  test('条件に一致する申込が無ければ空の状態を示す', async () => {
    await renderWith({ sponsorships: () => success(sponsorshipsQueryOf([])) });

    await expect
      .element(
        main().getByText('条件に一致するスポンサー広告の申込はありません。'),
      )
      .toBeVisible();
  });

  test('取得の失敗は一覧の場所に文言と再試行の操作で示し、問い合わせの導線と問い合わせを促す文を出さず、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      sponsorships: () =>
        available
          ? success(FIRST_PAGE)
          : failure({
              code: 'internal_error',
              message: '処理中に問題が発生しました。',
              status: 500,
            }),
    });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
    await expect.element(filterForm()).toBeVisible();
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect
      .element(
        main().getByRole('heading', {
          level: 2,
          name: 'スポンサー広告の一覧',
        }),
      )
      .toHaveFocus();
  });

  test('エラーコードを持たない想定外の失敗は、問い合わせを促さない管理者側の文言を示す', async () => {
    await renderWith({
      sponsorships: () => Promise.reject(new Error('network down')),
    });

    const alert = main().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent('時間をおいて再度お試しください。');
    await expect.element(alert).not.toHaveTextContent('問い合わせ');
    await expect.element(alert).not.toHaveTextContent('network down');
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
  });
});

describe('絞り込み', () => {
  test('掲載状況の選択肢は表示停止中を除く5種、ティアの選択肢は3種を表示名で並べる', async () => {
    await renderWith();
    await expect.element(table()).toBeVisible();

    await userEvent.click(statusSelect());
    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual([
      'すべての掲載状況',
      '未決済',
      '掲載予定',
      '掲載中',
      '終了',
      '強制終了',
    ]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(tierSelect());
    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual(['すべてのティア', 'Legend', 'Gold', 'Silver']);
  });

  test('掲載状況とティアの条件で求め直し、条件をURLに残し、ページの位置を捨てて1ページ目にする', async () => {
    const router = await renderWith({
      path: `${SPONSORSHIPS_PATH}?after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });

    await chooseOption(statusSelect(), '掲載中');
    await chooseOption(tierSelect(), 'Legend');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: { status: 'ACTIVE', tier: 'LEGEND' },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      status: 'ACTIVE',
      tier: 'LEGEND',
    });
    await expect.element(applyButton()).toHaveFocus();
  });

  test('URLの条件を選択欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith({
      path: `${SPONSORSHIPS_PATH}?status=TERMINATED&tier=SILVER&after=cursor-2`,
    });
    await expect.element(statusSelect()).toHaveTextContent('強制終了');
    await expect.element(tierSelect()).toHaveTextContent('Silver');
    expect(lastVariables()).toStrictEqual({
      filter: { status: 'TERMINATED', tier: 'SILVER' },
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(statusSelect()).toHaveTextContent('すべての掲載状況');
    await expect.element(tierSelect()).toHaveTextContent('すべてのティア');
  });

  test('URLの不正な条件とページの位置は、元の値をloaderにも画面にも渡さず、未指定として1ページ目を求める', async () => {
    await renderWith({
      path: `${SPONSORSHIPS_PATH}?status=PAUSED&tier=gold&after=${'c'.repeat(257)}`,
    });

    await expect.element(table()).toBeVisible();
    await expect.element(statusSelect()).toHaveTextContent('すべての掲載状況');
    await expect.element(tierSelect()).toHaveTextContent('すべてのティア');
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');
    expect(sponsorshipsVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {}, first: 50 },
    ]);
  });
});

describe('ページ送り', () => {
  const pages: SponsorshipsHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? sponsorshipsQueryOf([DELETED_PRODUCT_ROW], null)
        : sponsorshipsQueryOf([SCHEDULED_ROW, PAUSED_ROW], 'cursor-2'),
    );

  test('「次へ」で続きのページを求めてURLにカーソルを残し、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith({ sponsorships: pages });
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect.element(rowOf(DELETED_PRODUCT_ROW.id)).toBeVisible();
    await expect.element(rowOf(SCHEDULED_ROW.id)).not.toBeInTheDocument();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });
    await expect.element(nextButton()).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(previousButton());

    await expect.element(rowOf(SCHEDULED_ROW.id)).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  test('記録の無い途中のページ(共有したURL)の「前へ」は1ページ目へ戻り、絞り込みを保つ', async () => {
    const router = await renderWith({
      sponsorships: pages,
      path: `${SPONSORSHIPS_PATH}?tier=GOLD&after=cursor-2`,
    });
    await expect.element(rowOf(DELETED_PRODUCT_ROW.id)).toBeVisible();

    await userEvent.click(previousButton());

    await expect.element(rowOf(SCHEDULED_ROW.id)).toBeVisible();
    expect(router.state.location.search).toEqual({ tier: 'GOLD' });
  });
});

describe('強制終了', () => {
  const TERMINATED_PAUSED_ROW = Object.freeze({
    ...PAUSED_ROW,
    status: 'TERMINATED' as const,
    terminable: false,
  });

  const dialog = () =>
    page.getByRole('dialog', { name: 'スポンサー広告の強制終了' });
  const reasonBox = () =>
    dialog().getByRole('textbox', { name: '理由(必須)', exact: true });
  const confirmButton = () =>
    dialog().getByRole('button', { name: '強制終了する', exact: true });
  const pausedTerminateButton = () =>
    rowOf(PAUSED_ROW.id).getByRole('button', {
      name: `申込${PAUSED_ROW.id}を強制終了`,
    });
  const resultRegion = () =>
    main().getByRole('region', {
      name: `申込${PAUSED_ROW.id}の強制終了の結果`,
    });
  const listHeading = () =>
    main().getByRole('heading', { level: 2, name: 'スポンサー広告の一覧' });

  // 強制終了の後の取り直しでは、強制終了した行を強制終了できない状態で返す
  const terminatingList = () => {
    let terminated = false;
    return {
      sponsorships: () =>
        success(
          sponsorshipsQueryOf(
            terminated
              ? [SCHEDULED_ROW, TERMINATED_PAUSED_ROW]
              : [SCHEDULED_ROW, PAUSED_ROW],
          ),
        ),
      markTerminated: () => {
        terminated = true;
      },
    };
  };

  test('「強制終了」で照会の値を示す確認のダイアログを開き、確定すると結果を題名の下に示して結果の見出しへフォーカスを移し、一覧を取り直す', async () => {
    const list = terminatingList();
    const result = terminationResultOf();
    await renderWith({
      role: 'MODERATOR',
      sponsorships: list.sponsorships,
      terminate: () => {
        list.markTerminated();
        return success({ terminateSponsorship: result });
      },
    });
    await userEvent.click(pausedTerminateButton());

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        '未掲載日数5日・返金目安額$50.00(支払った金額$210.00・21日間)。これまでの表示停止3日分$30.00。強制終了を確定すると、これらの金額が自動で返金されます。',
      );
    const listCallsBefore = sponsorshipsVariablesOf(executeGraphQL).length;
    await reasonBox().fill('虚偽の広告表示が確認されたため');
    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(terminateVariablesOf(executeGraphQL)).toStrictEqual([
      { id: PAUSED_ROW.id, reason: '虚偽の広告表示が確認されたため' },
    ]);
    await expect.element(resultRegion()).toBeVisible();
    await expect
      .element(resultRegion().getByRole('heading', { level: 2 }))
      .toHaveFocus();
    await expect
      .element(resultRegion().getByText(PAUSED_ROW.purchaseId ?? ''))
      .toBeVisible();
    await expect
      .poll(() => sponsorshipsVariablesOf(executeGraphQL).length)
      .toBeGreaterThan(listCallsBefore);
    await expect.element(pausedTerminateButton()).not.toBeInTheDocument();
    expect(cellTexts(PAUSED_ROW.id)[6]).toBe('強制終了');
  });

  test('強制終了できない広告は、ダイアログの中に文言を示して理由の入力を保ち、一覧を取り直し、閉じると一覧の見出しへフォーカスを移す', async () => {
    const list = terminatingList();
    await renderWith({
      role: 'MODERATOR',
      sponsorships: list.sponsorships,
      terminate: () => {
        list.markTerminated();
        return failure({
          code: 'sponsorship_not_terminable',
          message:
            'この広告は強制終了できません。一覧を再読み込みしてください。',
          status: 409,
        });
      },
    });
    await userEvent.click(pausedTerminateButton());
    await expect.element(confirmButton()).toBeVisible();
    await reasonBox().fill('虚偽の広告表示が確認されたため');
    const listCallsBefore = sponsorshipsVariablesOf(executeGraphQL).length;
    await confirmButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        'この広告は強制終了できません。一覧を再読み込みしてください。',
      );
    await expect
      .element(reasonBox())
      .toHaveValue('虚偽の広告表示が確認されたため');
    await expect
      .poll(() => sponsorshipsVariablesOf(executeGraphQL).length)
      .toBeGreaterThan(listCallsBefore);

    await userEvent.click(
      dialog().getByRole('button', { name: 'キャンセル', exact: true }),
    );

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(listHeading()).toHaveFocus();
    await expect.element(pausedTerminateButton()).not.toBeInTheDocument();
    expect(cellTexts(PAUSED_ROW.id)[6]).toBe('強制終了');
    expect(resultRegion().query()).toBeNull();
  });

  test('取り消すと強制終了せずに閉じ、押した「強制終了」へフォーカスを戻す', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(pausedTerminateButton());
    await expect.element(confirmButton()).toBeVisible();

    await userEvent.click(
      dialog().getByRole('button', { name: 'キャンセル', exact: true }),
    );

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(pausedTerminateButton()).toHaveFocus();
    expect(terminateVariablesOf(executeGraphQL)).toStrictEqual([]);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・強制終了の操作・表示停止中と削除済みの印がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'MODERATOR' });
      await expect.element(table()).toBeVisible();
      await expect.element(terminateButtons().first()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
