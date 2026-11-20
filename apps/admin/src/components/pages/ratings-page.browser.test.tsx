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
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { buttonBehindDialog } from '../../../test/moderation-render.tsx';
import {
  changedResult,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  MODERATION_ROLES,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  INVALIDATED_RATING_NODE,
  RATING_NODES,
  RATINGS_PATH,
  type RatingsHandler,
  ratingsQueryOf,
  ratingsVariablesOf,
  renderRatingsPage,
  respondRatingsGraphQL,
  UNREADABLE_RATING_NODE,
  VALID_RATING_NODE,
} from '../../../test/moderation-ratings-fixtures.tsx';
import { loadAdminModerationRatingsPage } from '../../graphql/admin-moderation-engagement.ts';
import {
  type AdminRole,
  AdminInvalidateRatingDocument,
  AdminRevalidateRatingDocument,
} from '../../graphql/generated/graphql.ts';
import { Route as RatingsRoute } from '../../routes/_authenticated/ratings/index.tsx';
import {
  ratingModerationListArgsOf,
  toRatingModerationSearch,
} from '../moderation/shared/moderation-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const INVALIDATE_DESCRIPTION =
  '無効化した評価は平均値と件数の算出から除かれます。評価者には自分の評価として表示されたままです。評価者へ通知は送りません。';

const REVALIDATE_DESCRIPTION =
  '評価を平均値と件数の算出に戻します。評価者へ通知は送りません。';

const TOO_LONG_MESSAGE = '検索語は100文字以内で入力してください。';

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: '評価の一覧' });
const listHeading = () =>
  main().getByRole('heading', { level: 2, name: '評価の一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const textField = (name: string) =>
  filterForm().getByRole('textbox', { name, exact: true });
const stateSelect = () => filterForm().getByRole('combobox', { name: '状態' });
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
const pagination = () => main().getByRole('navigation', { name: 'ページ送り' });
const nextButton = () => pagination().getByRole('button', { name: '次へ' });
const previousButton = () => pagination().getByRole('button', { name: '前へ' });
const actionButton = (name: string) =>
  table().getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(必須)', exact: true });

const lastVariables = () => ratingsVariablesOf(executeGraphQL).at(-1);

const cellTexts = (text: string) =>
  [...rowOf(text).element().querySelectorAll('td')].map(
    (cell) => cell.textContent,
  );

const actionNames = () =>
  table()
    .getByRole('button')
    .elements()
    .map((button) => button.getAttribute('aria-label'));

// 一覧の先頭へのスクロールの回数。他の部品が呼ぶスクロールを数えない
const listScrollsOf = (
  scrollIntoView: { readonly mock: { readonly calls: unknown[][] } },
  behavior: ScrollBehavior,
): number =>
  scrollIntoView.mock.calls.filter(
    ([options]) =>
      JSON.stringify(options) === JSON.stringify({ block: 'start', behavior }),
  ).length;

async function chooseState(name: string): Promise<void> {
  await userEvent.click(stateSelect());
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

const renderWith = async ({
  role = 'VIEWER',
  ratings,
  handlers,
  path = RATINGS_PATH,
}: {
  readonly role?: AdminRole;
  readonly ratings?: RatingsHandler;
  readonly handlers?: ReadonlyMap<
    unknown,
    (variables: unknown) => Promise<unknown>
  >;
  readonly path?: string;
} = {}) => {
  respondRatingsGraphQL(executeGraphQL, {
    role,
    ...(ratings === undefined ? {} : { ratings }),
    ...(handlers === undefined ? {} : { handlers }),
  });
  return renderRatingsPage(role, path);
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  vi.restoreAllMocks();
  toast.dismiss();
  await emulateReducedMotion('no-preference');
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = toRatingModerationSearch({
    raterHandle: 'maker',
    state: 'valid',
    after: 'cursor-2',
  });

  expect(RatingsRoute.options.validateSearch).toBe(toRatingModerationSearch);
  expect(RatingsRoute.options.loader).toBe(loadAdminModerationRatingsPage);
  expect(
    (
      RatingsRoute.options.loaderDeps as (input: { search: unknown }) => unknown
    )({ search }),
  ).toStrictEqual(ratingModerationListArgsOf(search));
});

describe('評価の一覧', () => {
  test('条件を付けずに1ページ目の50件を求め、題名と説明、評価者・プロダクト・点数・更新日時・状態・操作の列をAPIの順に示す', async () => {
    await renderWith();

    await expect.element(table()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('評価');
    await expect
      .element(main().getByText('評価を、更新日時の新しい順に表示します。'))
      .toBeVisible();
    expect(lastVariables()).toStrictEqual({ filter: {}, first: 50 });
    expect(
      table()
        .getByRole('columnheader')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([
      '評価者',
      'プロダクト',
      '点数',
      '更新日時',
      '状態',
      '操作',
    ]);
    expect(
      table()
        .getByRole('row')
        .elements()
        .slice(1)
        .map((row) => row.querySelectorAll('td')[0]?.textContent),
    ).toStrictEqual([
      'サンプル太郎(@maker_ai)',
      'サンプル花子(@pixel_hanako)',
      '表示できない利用者',
    ]);
    expect(cellTexts('サンプル太郎').slice(1, 5)).toStrictEqual([
      'Pitch Notes',
      '45段階中4',
      '2026年11月10日(火) 10:00',
      '有効',
    ]);
    await expect
      .element(rowOf('サンプル太郎').getByText('2026年11月10日(火) 10:00'))
      .toHaveAttribute('datetime', VALID_RATING_NODE.updatedAt);
    await expect
      .element(rowOf('サンプル太郎').getByText('5段階中4'))
      .toBeInTheDocument();
    expect(cellTexts('サンプル花子')[4]).toBe('無効化済み');
    expect(cellTexts('表示できない利用者')[1]).toBe('—');
  });

  test('該当する評価が無ければ一覧の位置にその旨を示す', async () => {
    await renderWith({ ratings: () => success(ratingsQueryOf([])) });

    await expect
      .element(main().getByText('条件に一致する評価はありません。'))
      .toBeVisible();
    expect(table().query()).toBeNull();
    await expect.element(filterForm()).toBeVisible();
  });

  test('取得の失敗は一覧の位置に文言と再試行の操作で示し、問い合わせの導線を出さず、再試行で一覧の見出しへフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      ratings: () =>
        available
          ? success(ratingsQueryOf(RATING_NODES))
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
    available = true;
    await userEvent.click(main().getByRole('button', { name: '再試行' }));

    await expect.element(table()).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });
});

describe('絞り込み', () => {
  test('プロダクト・評価者のハンドルと状態を組み合わせて求め直し、条件をURLに残してページの位置を捨てる', async () => {
    const router = await renderWith({ path: `${RATINGS_PATH}?after=cursor-2` });
    await expect.element(table()).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });

    await textField('プロダクトのハンドル').fill(' pitch ');
    await textField('評価者のハンドル').fill('maker');
    await chooseState('無効化済み');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        productHandle: 'pitch',
        raterHandle: 'maker',
        state: 'INVALIDATED',
      },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      productHandle: 'pitch',
      raterHandle: 'maker',
      state: 'invalidated',
    });
    await expect.element(applyButton()).toHaveFocus();
  });

  test('状態の選択肢は、すべての状態・有効・無効化済みを示す', async () => {
    await renderWith();
    await userEvent.click(stateSelect());

    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual(['すべての状態', '有効', '無効化済み']);
  });

  test('URLの条件を入力欄と選択欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith({
      path: `${RATINGS_PATH}?productHandle=pitch&raterHandle=maker&state=valid&after=cursor-2`,
    });
    await expect
      .element(textField('プロダクトのハンドル'))
      .toHaveValue('pitch');
    await expect.element(textField('評価者のハンドル')).toHaveValue('maker');
    await expect.element(stateSelect()).toHaveTextContent('有効');
    expect(lastVariables()).toStrictEqual({
      filter: { productHandle: 'pitch', raterHandle: 'maker', state: 'VALID' },
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(textField('評価者のハンドル')).toHaveValue('');
    await expect.element(stateSelect()).toHaveTextContent('すべての状態');
  });

  test('URLの不正な状態とページの位置は、未指定として1ページ目を求める', async () => {
    await renderWith({
      path: `${RATINGS_PATH}?state=deleted&after=${'c'.repeat(257)}`,
    });

    await expect.element(table()).toBeVisible();
    await expect.element(stateSelect()).toHaveTextContent('すべての状態');
    expect(ratingsVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {}, first: 50 },
    ]);
  });

  test('100文字を超える検索語は適用せず、最初の超過の欄に誤りを関連付けて示してフォーカスを移す', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await textField('プロダクトのハンドル').fill('a'.repeat(101));
    await textField('評価者のハンドル').fill('b'.repeat(101));
    await userEvent.click(applyButton());

    await expect.element(textField('プロダクトのハンドル')).toHaveFocus();
    for (const name of ['プロダクトのハンドル', '評価者のハンドル']) {
      await expect
        .element(textField(name))
        .toHaveAttribute('aria-invalid', 'true');
      await expect
        .element(textField(name))
        .toHaveAccessibleDescription(TOO_LONG_MESSAGE);
    }
    expect(router.state.location.search).toEqual({});
    expect(ratingsVariablesOf(executeGraphQL)).toHaveLength(1);
  });

  test('条件を変えて取り直す間は、前の一覧を操作できないまま表示し続け、絞り込みは操作でき、一覧の先頭へスクロールせずフォーカスを「適用」に残す', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    let release: (() => void) | undefined;
    await renderWith({
      ratings: ({ filter }) =>
        filter?.raterHandle === undefined
          ? success(ratingsQueryOf(RATING_NODES))
          : new Promise((resolve) => {
              release = () => {
                resolve({
                  ok: true,
                  data: ratingsQueryOf([VALID_RATING_NODE]),
                });
              };
            }),
    });
    await expect.element(table()).toBeVisible();

    await textField('評価者のハンドル').fill('maker');
    await userEvent.click(applyButton());

    await expect.poll(() => release).toBeDefined();
    await expect.element(rowOf('サンプル花子')).toBeInTheDocument();
    expect(table().element().closest('[aria-busy="true"]')).not.toBeNull();
    expect(table().element().closest('[inert]')).not.toBeNull();
    expect(filterForm().element().closest('[inert]')).toBeNull();

    release?.();

    await expect.element(rowOf('サンプル花子')).not.toBeInTheDocument();
    expect(table().element().closest('[inert]')).toBeNull();
    await expect.element(applyButton()).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test('「解除」で条件を外した時も、一覧の先頭へスクロールせずフォーカスを「解除」に残す', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const router = await renderWith({
      path: `${RATINGS_PATH}?state=valid&after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(resetButton()).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('ページ送り', () => {
  const pages: RatingsHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? ratingsQueryOf([UNREADABLE_RATING_NODE])
        : ratingsQueryOf(
            [VALID_RATING_NODE, INVALIDATED_RATING_NODE],
            'cursor-2',
          ),
    );

  // 最初の表示の後の取得だけを止め、移動の間に押したボタンが操作できない状態になる時間を作る
  const heldPages = () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const ratings: RatingsHandler = (variables) => {
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
    return { ratings, release: () => release?.(), held: () => release };
  };

  test('「次へ」で続きのページを求めてURLにカーソルを残し、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith({ ratings: pages });
    await expect.element(table()).toBeVisible();

    await userEvent.click(nextButton());

    await expect.element(rowOf('表示できない利用者')).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });

    await userEvent.click(previousButton());

    await expect.element(rowOf('サンプル太郎')).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  test.each([
    {
      name: '次へ',
      path: RATINGS_PATH,
      button: nextButton,
      arrived: '表示できない利用者',
    },
    {
      name: '前へ',
      path: `${RATINGS_PATH}?after=cursor-2`,
      button: previousButton,
      arrived: 'サンプル太郎',
    },
  ])(
    'キーボードで「$name」を押すと、取り直す間も結果が届いた後も一覧の見出しにフォーカスを置き、一覧の先頭へ滑らかにスクロールする',
    async ({ path, button, arrived }) => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      const pending = heldPages();
      await renderWith({ ratings: pending.ratings, path });
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
    await renderWith({ ratings: pages });
    await expect.element(table()).toBeVisible();

    nextButton().element().focus();
    await userEvent.keyboard('{Enter}');

    await expect.element(rowOf('表示できない利用者')).toBeVisible();
    expect(listScrollsOf(scrollIntoView, 'auto')).toBeGreaterThan(0);
    expect(listScrollsOf(scrollIntoView, 'smooth')).toBe(0);
    expect(document.activeElement).toBe(listHeading().element());
  });

  test('移る先の無い「前へ」は押してもフォーカスとスクロールを動かさない', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ ratings: pages });
    await expect.element(table()).toBeVisible();

    previousButton().element().focus();
    await userEvent.keyboard('{Enter}');

    expect(document.activeElement).toBe(previousButton().element());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('措置の操作', () => {
  test('閲覧のみの管理者には無効化・無効化の取り消しを出さない', async () => {
    await renderWith({ role: 'VIEWER' });
    await expect.element(table()).toBeVisible();

    expect(actionNames()).toStrictEqual([]);
  });

  test.each(MODERATION_ROLES)(
    '%sには、有効な評価に「無効化」、無効化済みの評価に「無効化の取り消し」を、評価者のニックネームを含む名前で置く',
    async (role) => {
      await renderWith({ role });
      await expect.element(table()).toBeVisible();

      expect(actionNames()).toStrictEqual([
        'サンプル太郎さんの評価を無効化',
        'サンプル花子さんの評価の無効化の取り消し',
        '表示できない利用者さんの評価を無効化',
      ]);
    },
  );

  test('無効化は理由が必須で、確認に影響を説明の文で示し、確定すると無効化して知らせ、状態で絞った一覧から消えても一覧の見出しへフォーカスを移す', async () => {
    let invalidated = false;
    await renderWith({
      role: 'MODERATOR',
      path: `${RATINGS_PATH}?state=valid`,
      ratings: () =>
        success(ratingsQueryOf(invalidated ? [] : [VALID_RATING_NODE])),
      handlers: new Map([
        [
          AdminInvalidateRatingDocument,
          () => {
            invalidated = true;
            return changedResult('invalidateRating', true);
          },
        ],
      ]),
    });
    await userEvent.click(actionButton('サンプル太郎さんの評価を無効化'));

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'サンプル太郎さんの評価を無効化しますか?',
        }),
      )
      .toHaveAccessibleDescription(INVALIDATE_DESCRIPTION);
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    const confirm = dialog().getByRole('button', { name: '無効化する' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill(MODERATION_REASON);
    await confirm.click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminInvalidateRatingDocument),
    ).toStrictEqual([{ id: VALID_RATING_NODE.id, reason: MODERATION_REASON }]);
    await expect
      .element(page.getByText('評価を無効化しました。'))
      .toBeVisible();
    await expect
      .element(main().getByText('条件に一致する評価はありません。'))
      .toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('無効化の取り消しも理由が必須で、確認に影響を示し、既に有効なら変わらなかった旨を知らせる', async () => {
    await renderWith({
      role: 'SUPER_ADMIN',
      handlers: new Map([
        [
          AdminRevalidateRatingDocument,
          () => changedResult('revalidateRating', false),
        ],
      ]),
    });
    await userEvent.click(
      actionButton('サンプル花子さんの評価の無効化の取り消し'),
    );

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'サンプル花子さんの評価の無効化を取り消しますか?',
        }),
      )
      .toHaveAccessibleDescription(REVALIDATE_DESCRIPTION);
    const confirm = dialog().getByRole('button', { name: '無効化を取り消す' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill('誤った無効化だったため');
    await confirm.click();

    await expect.element(page.getByText('既に有効です。')).toBeVisible();
    expect(
      variablesOf(executeGraphQL, AdminRevalidateRatingDocument),
    ).toStrictEqual([
      { id: INVALIDATED_RATING_NODE.id, reason: '誤った無効化だったため' },
    ]);
  });

  test('確定の時点で評価が見つからないと、一覧を取り直して行が消えても、ダイアログの中に文言を示して理由を保ち、閉じると一覧の見出しへフォーカスを移す', async () => {
    let missing = false;
    await renderWith({
      role: 'MODERATOR',
      ratings: () =>
        success(
          ratingsQueryOf(
            missing
              ? RATING_NODES.filter(({ id }) => id !== VALID_RATING_NODE.id)
              : RATING_NODES,
          ),
        ),
      handlers: new Map([
        [
          AdminInvalidateRatingDocument,
          () => {
            missing = true;
            return failure({
              code: 'rating_not_found',
              message: '評価が見つかりません。',
              status: 404,
            });
          },
        ],
      ]),
    });
    await userEvent.click(actionButton('サンプル太郎さんの評価を無効化'));
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '無効化する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('評価が見つかりません。');
    await expect
      .element(buttonBehindDialog('サンプル太郎さんの評価を無効化'))
      .not.toBeInTheDocument();
    await expect
      .element(buttonBehindDialog('表示できない利用者さんの評価を無効化'))
      .toBeInTheDocument();
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(listHeading()).toHaveFocus();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、一覧・絞り込み・措置の操作がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'SUPER_ADMIN' });
      await expect.element(table()).toBeVisible();
      await expect
        .element(actionButton('サンプル太郎さんの評価を無効化'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('無効化の確認のダイアログがWCAG 2.2 AAの自動検査に違反しない', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(actionButton('サンプル太郎さんの評価を無効化'));
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
