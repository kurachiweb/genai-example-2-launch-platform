import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  changedResult,
  MODERATION_DISPLAY,
  RATING_ID,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  INVALIDATED_RATING_NODE,
  matchOf,
  type ProductDetailHandler,
  productDetailOf,
  productRatingsOf,
  ratingNodeOf,
  renderProductDetailPage,
  respondProductDetailGraphQL,
} from '../../../test/moderation-product-detail-fixtures.ts';
import { respondReportSummaries } from '../../../test/reporting-summary-fixtures.ts';
import {
  AdminInvalidateRatingDocument,
  AdminProductDocument,
  type AdminProductQuery,
  AdminProductRatingsDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

type ProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

const main = () => page.getByRole('main');
const sectionOf = (name: string) =>
  main().getByRole('region', { name, exact: true });
const ratingTable = () =>
  sectionOf('評価').getByRole('table', { name: '評価の一覧' });
const loadMoreButton = () =>
  sectionOf('評価').getByRole('button', { name: 'さらに読み込む' });
const rowTexts = (table: Element): readonly (readonly string[])[] =>
  [...table.querySelectorAll('tbody tr')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent),
  );
const launchOf = (name: string) =>
  sectionOf('ローンチ履歴').getByRole('region', { name, exact: true });
const termValue = (scope: Element, term: string): string | undefined =>
  [...scope.querySelectorAll('dt')].find(
    (element) => element.textContent === term,
  )?.nextElementSibling?.textContent ?? undefined;

const renderDetail = async ({
  role = 'MODERATOR',
  detail,
  handlers,
}: {
  readonly role?: AdminRole;
  readonly detail?: ProductDetail;
  readonly handlers?: ReadonlyMap<unknown, ProductDetailHandler>;
} = {}) => {
  respondProductDetailGraphQL(executeGraphQL, {
    role,
    ...(detail === undefined ? {} : { detail }),
    ...(handlers === undefined ? {} : { handlers }),
  });
  respondReportSummaries(executeGraphQL);
  await renderProductDetailPage(role);
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  await emulateBrowserDisplay(null);
});

describe('評価', () => {
  test('有効な評価の平均と件数と、評価の一覧(評価者・点数・日時・状態)を示す', async () => {
    await renderDetail();

    await expect
      .element(sectionOf('評価'))
      .toHaveTextContent('平均4.3(有効な評価1,234件)');
    await expect.element(ratingTable()).toBeVisible();
    const rows = rowTexts(ratingTable().element());
    expect(rows.map((row) => row.slice(0, 4))).toStrictEqual([
      ['サンプル花子(@fan_1)', '45段階中4', '2026年11月11日(水) 11:30', '有効'],
      [
        '表示できない利用者',
        '15段階中1',
        '2026年11月12日(木) 14:00',
        '無効化済み',
      ],
    ]);
    const time = ratingTable().element().querySelector('tbody time');
    expect(time?.getAttribute('datetime')).toBe('2026-11-11T02:30:00.000Z');
  });

  test('有効な評価が無いプロダクトは、その旨を示す', async () => {
    await renderDetail({
      detail: productDetailOf({ ratingSummary: { average: null, count: 0 } }),
    });

    await expect
      .element(sectionOf('評価'))
      .toHaveTextContent('有効な評価はありません。');
  });

  test('モデレーター以上には、有効な評価に無効化、無効化済みの評価に無効化の取り消しを置き、確定で評価のIDと理由を送る', async () => {
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminInvalidateRatingDocument,
          () => changedResult('invalidateRating', true),
        ],
      ]),
    });

    await expect
      .element(
        ratingTable().getByRole('button', {
          name: 'サンプル花子さんの評価を無効化',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        ratingTable().getByRole('button', {
          name: '表示できない利用者さんの評価の無効化の取り消し',
        }),
      )
      .toBeVisible();

    await ratingTable()
      .getByRole('button', { name: 'サンプル花子さんの評価を無効化' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: '理由(必須)', exact: true })
      .fill('自作自演の評価のため');
    await dialog.getByRole('button', { name: '無効化する' }).click();

    await expect
      .element(page.getByText('評価を無効化しました。'))
      .toBeVisible();
    expect(
      variablesOf(executeGraphQL, AdminInvalidateRatingDocument),
    ).toStrictEqual([{ id: RATING_ID, reason: '自作自演の評価のため' }]);
  });

  test('続きのある一覧は「さらに読み込む」で続きを後ろに加え、最後のページを読むと加えた最初の行へフォーカスを移す', async () => {
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductRatingsDocument,
          (variables) =>
            success(
              (variables as { readonly after?: string }).after === 'cursor-1'
                ? productRatingsOf([INVALIDATED_RATING_NODE])
                : productRatingsOf([ratingNodeOf()], 'cursor-1'),
            ),
        ],
      ]),
    });
    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(1);

    await loadMoreButton().click();

    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(2);
    expect(
      variablesOf(executeGraphQL, AdminProductRatingsDocument).at(-1),
    ).toStrictEqual({
      productId: '01KA0PR0DVCT00000000000001',
      first: 50,
      after: 'cursor-1',
    });
    expect(loadMoreButton().elements()).toHaveLength(0);
    const added = ratingTable().element().querySelectorAll('tbody tr')[1];
    expect(document.activeElement).toBe(added);
  });

  test('続きの読み込み中のボタンは押せないことをaria-disabledと文言で示し、押しても読み込みを重ねない', async () => {
    const pending: (() => void)[] = [];
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductRatingsDocument,
          (variables) =>
            (variables as { readonly after?: string }).after === 'cursor-1'
              ? new Promise((resolve) => {
                  pending.push(() => {
                    resolve(
                      success(productRatingsOf([INVALIDATED_RATING_NODE])),
                    );
                  });
                })
              : success(productRatingsOf([ratingNodeOf()], 'cursor-1')),
        ],
      ]),
    });
    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(1);

    await loadMoreButton().click();

    const loading = sectionOf('評価').getByRole('button', {
      name: '読み込み中',
    });
    await expect.element(loading).toHaveAttribute('aria-disabled', 'true');
    await expect.element(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.element().hasAttribute('disabled')).toBe(false);
    // 操作の自動化はaria-disabledのボタンを押せない状態として待つため、要素を直接押す
    (loading.element() as HTMLButtonElement).click();
    expect(
      variablesOf(executeGraphQL, AdminProductRatingsDocument).filter(
        (variables) =>
          (variables as { readonly after?: string }).after === 'cursor-1',
      ),
    ).toHaveLength(1);
    for (const resolve of pending) {
      resolve();
    }
    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(2);
  });

  test('続きの読み込みの失敗は、読み込んだ行とボタンを残してボタンの近くに文言を示し、同じボタンで読み込み直せる', async () => {
    let failNext = true;
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductRatingsDocument,
          (variables) => {
            if (
              (variables as { readonly after?: string }).after !== 'cursor-1'
            ) {
              return success(productRatingsOf([ratingNodeOf()], 'cursor-1'));
            }
            return failNext
              ? failure({
                  code: 'internal_error',
                  message: '一時的に処理できませんでした。',
                  status: 500,
                })
              : success(productRatingsOf([INVALIDATED_RATING_NODE]));
          },
        ],
      ]),
    });
    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(1);

    await loadMoreButton().click();

    await expect
      .element(sectionOf('評価').getByRole('alert'))
      .toHaveTextContent('一時的に処理できませんでした。');
    expect(rowTexts(ratingTable().element())).toHaveLength(1);
    await expect.element(loadMoreButton()).toBeVisible();
    expect(
      sectionOf('評価').getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);

    failNext = false;
    await loadMoreButton().click();

    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(2);
    expect(sectionOf('評価').getByRole('alert').elements()).toHaveLength(0);
  });

  test('表示中の一覧の取り直しの失敗では、読み込んだ行を残す', async () => {
    let failRatings = false;
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductRatingsDocument,
          () =>
            failRatings
              ? failure({
                  code: 'internal_error',
                  message: '一時的に処理できませんでした。',
                  status: 500,
                })
              : success(productRatingsOf([ratingNodeOf()])),
        ],
        [
          AdminInvalidateRatingDocument,
          () => {
            failRatings = true;
            return changedResult('invalidateRating', true);
          },
        ],
      ]),
    });
    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(1);
    const callsBefore = variablesOf(
      executeGraphQL,
      AdminProductRatingsDocument,
    ).length;

    await ratingTable()
      .getByRole('button', { name: 'サンプル花子さんの評価を無効化' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: '理由(必須)', exact: true })
      .fill('自作自演の評価のため');
    await dialog.getByRole('button', { name: '無効化する' }).click();

    await expect
      .poll(
        () => variablesOf(executeGraphQL, AdminProductRatingsDocument).length,
      )
      .toBeGreaterThan(callsBefore);
    await expect
      .element(page.getByText('評価を無効化しました。'))
      .toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(rowTexts(ratingTable().element())).toHaveLength(1);
    expect(
      sectionOf('評価').getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);
  });

  test('評価の一覧の取得の失敗は評価の区画の中に再試行とともに示し、他の区画の表示を止めない', async () => {
    let fail = true;
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductRatingsDocument,
          () =>
            fail
              ? failure({
                  code: 'internal_error',
                  message: '一時的に処理できませんでした。',
                  status: 500,
                })
              : success(productRatingsOf([ratingNodeOf()])),
        ],
      ]),
    });

    await expect
      .element(sectionOf('評価').getByRole('alert'))
      .toHaveTextContent('一時的に処理できませんでした。');
    await expect.element(sectionOf('ローンチ履歴')).toBeVisible();
    fail = false;
    await sectionOf('評価').getByRole('button', { name: '再試行' }).click();

    await expect.poll(() => rowTexts(ratingTable().element()).length).toBe(1);
  });
});

describe('ローンチ履歴', () => {
  test('新しいローンチから順に、回・ローンチ日・状態を示す', async () => {
    await renderDetail();

    const headings = [
      ...sectionOf('ローンチ履歴').element().querySelectorAll('h3'),
    ].map((heading) => heading.textContent);
    expect(headings).toStrictEqual(['第2回ローンチ', '第1回ローンチ']);
    const second = launchOf('第2回ローンチ').element();
    expect(termValue(second, 'ローンチ日')).toBe('2026年11月10日(火)');
    expect(second.querySelector('dd time')?.getAttribute('datetime')).toBe(
      '2026-11-10',
    );
    expect(termValue(second, '状態')).toBe('勝利');
    expect(termValue(launchOf('第1回ローンチ').element(), '状態')).toBe('取消');
  });

  test('各ローンチのマッチ結果(種別・ラウンド・実施日・対戦相手・Upvote数・勝敗)を示す', async () => {
    await renderDetail();

    const table = launchOf('第2回ローンチ').getByRole('table', {
      name: '第2回ローンチのマッチ結果',
    });
    await expect.element(table).toBeVisible();
    expect(
      [...table.element().querySelectorAll('thead th')].map(
        (cell) => cell.textContent,
      ),
    ).toStrictEqual([
      '種別',
      'ラウンド',
      '実施日',
      '対戦相手',
      'Upvote数',
      '勝敗',
    ]);
    expect(rowTexts(table.element())).toStrictEqual([
      ['予選', '—', '2026年11月10日(火)', '非公開のプロダクト', '9', '勝利'],
      [
        'Weekトーナメント',
        '1回戦',
        '2026年11月11日(水)',
        'Formation Lab',
        '7',
        '敗北',
      ],
      ['Weekトーナメント', '準決勝', '2026年11月12日(木)', '—', '—', '不戦勝'],
      [
        'Yearトーナメント',
        '1回戦',
        '2026年11月30日(月)',
        'Kickoff Board',
        '0',
        '予定',
      ],
    ]);
    await expect
      .element(launchOf('第1回ローンチ'))
      .toHaveTextContent('マッチはありません。');
  });

  test('確定していないマッチは開始の前を予定、開始の後を集計中も含めてマッチ中と示し、Upvoteが無い・両方の棄権の決着の敗北は両者敗北と示す', async () => {
    await renderDetail({
      detail: productDetailOf({
        launches: [
          {
            id: '01KA0LAVNCH000000000000003',
            number: 3,
            launchDate: '2026-11-20',
            status: 'in_progress',
            matches: [
              matchOf({
                id: '01KA0MATCH0000000000000031',
                matchDate: '2026-11-20',
                upvoteCount: 0,
                result: null,
                phase: 'live',
                decision: null,
              }),
              matchOf({
                id: '01KA0MATCH0000000000000032',
                kind: 'week',
                round: 2,
                matchDate: '2026-11-20',
                upvoteCount: 3,
                result: null,
                phase: 'tallying',
                decision: null,
              }),
              matchOf({
                id: '01KA0MATCH0000000000000033',
                kind: 'week',
                round: 3,
                matchDate: '2026-11-21',
                upvoteCount: 0,
                result: null,
                phase: 'scheduled',
                decision: null,
              }),
              matchOf({
                id: '01KA0MATCH0000000000000034',
                kind: 'week',
                round: 1,
                matchDate: '2026-11-19',
                upvoteCount: 0,
                result: 'lost',
                decision: 'no_votes',
              }),
              matchOf({
                id: '01KA0MATCH0000000000000035',
                kind: 'week',
                round: 1,
                matchDate: '2026-11-18',
                upvoteCount: 4,
                result: 'lost',
                decision: 'both_forfeited',
              }),
            ],
          },
        ],
      }),
    });

    const results = [
      ...sectionOf('ローンチ履歴').element().querySelectorAll('tbody tr'),
    ].map((row) => row.querySelector('td:last-child')?.textContent);
    expect(results).toStrictEqual([
      'マッチ中',
      'マッチ中',
      '予定',
      '両者敗北',
      '両者敗北',
    ]);
  });

  test('ローンチの無いプロダクトは、その旨を示す', async () => {
    await renderDetail({ detail: productDetailOf({ launches: [] }) });

    await expect
      .element(sectionOf('ローンチ履歴'))
      .toHaveTextContent('ローンチはまだありません。');
  });
});

describe('対象が見つからない失敗', () => {
  test('確定の時点で評価が見つからないと、ダイアログの中に文言を示して理由を保ち、閉じると評価の一覧を取り直して行を除き、評価の区画の見出しへフォーカスを移す', async () => {
    let missing = false;
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductRatingsDocument,
          () =>
            success(
              productRatingsOf(
                missing
                  ? [INVALIDATED_RATING_NODE]
                  : [ratingNodeOf(), INVALIDATED_RATING_NODE],
              ),
            ),
        ],
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
    await ratingTable()
      .getByRole('button', { name: 'サンプル花子さんの評価を無効化' })
      .click();
    const dialog = page.getByRole('dialog');
    const reasonBox = dialog.getByRole('textbox', {
      name: '理由(必須)',
      exact: true,
    });
    await reasonBox.fill('自作自演の評価のため');
    await dialog.getByRole('button', { name: '無効化する' }).click();

    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent('評価が見つかりません。');
    await expect.element(reasonBox).toHaveValue('自作自演の評価のため');

    await dialog.getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    await expect
      .element(
        ratingTable().getByRole('button', {
          name: 'サンプル花子さんの評価を無効化',
        }),
      )
      .not.toBeInTheDocument();
    await expect
      .element(
        ratingTable().getByRole('button', {
          name: '表示できない利用者さんの評価の無効化の取り消し',
        }),
      )
      .toBeVisible();
    await expect
      .element(sectionOf('評価').getByRole('heading', { level: 2 }))
      .toHaveFocus();
  });
});

describe('取り直し', () => {
  test('評価の措置の後に詳細を取り直して平均と件数を新しくする', async () => {
    let average = 4.25;
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductDocument,
          () =>
            success({
              adminProduct: productDetailOf({
                ratingSummary: { average, count: 2 },
              }),
            }),
        ],
        [
          AdminInvalidateRatingDocument,
          () => {
            average = 5;
            return changedResult('invalidateRating', true);
          },
        ],
      ]),
    });
    await expect
      .element(sectionOf('評価'))
      .toHaveTextContent('平均4.3(有効な評価2件)');

    await ratingTable()
      .getByRole('button', { name: 'サンプル花子さんの評価を無効化' })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: '理由(必須)', exact: true })
      .fill('自作自演の評価のため');
    await dialog.getByRole('button', { name: '無効化する' }).click();

    await expect
      .element(sectionOf('評価'))
      .toHaveTextContent('平均5.0(有効な評価2件)');
  });
});
