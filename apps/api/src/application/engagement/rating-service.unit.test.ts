import { describe, expect, test } from 'bun:test';

import { OWN_PRODUCT_RATING_MESSAGE } from '../../../common-lib/engagement/engagement-rules.ts';
import type { RatingUpsert } from '../../../lib/core/engagement/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { DirectoryEngagementTargetResolver } from './engagement-target-resolver.ts';
import type { WriteOutcome } from './ports.ts';
import { StoreRatingService } from './rating-service.ts';
import {
  createSequentialIds,
  currentUserOf,
  NEW_RATING_ID,
} from './testing/comment-fakes.ts';
import {
  createFakeRatingWorld,
  type FakeRatingRow,
  fakeRatingRowOf,
} from './testing/rating-fakes.ts';
import {
  activeState,
  createFakeTargetDirectory,
  type FakeProductState,
  MEMBER_ID,
  NOW,
  OTHER_PRODUCT_ID,
  OWNER_ID,
  PRODUCT_ID,
  summaryOf,
} from './testing/target-fakes.ts';

const OTHER_MEMBER_ID = '01JD0USER00000000000000003';
const EXISTING_RATING_ID = '01JD0RATE00000000000000001';
const OTHER_RATING_ID = '01JD0RATE00000000000000002';

const RATING_TARGET_NOT_FOUND_MESSAGE =
  '評価先のプロダクトが見つかりません。ページを再読み込みしてください。';

interface SetupOptions {
  readonly listed?: boolean;
  readonly rows?: readonly FakeRatingRow[];
  readonly onUpsert?: (
    input: RatingUpsert,
    state: FakeProductState,
  ) => WriteOutcome;
}

function setup(options: SetupOptions = {}) {
  const state = activeState();
  const targets = createFakeTargetDirectory({
    products: [
      { summary: summaryOf({ listed: options.listed ?? true }), state },
      {
        summary: summaryOf({
          productId: OTHER_PRODUCT_ID,
          ownerUserId: MEMBER_ID,
        }),
        state: activeState(),
      },
    ],
    launches: [],
  });
  const onUpsert = options.onUpsert;
  const world = createFakeRatingWorld({
    rows: options.rows,
    onUpsert:
      onUpsert === undefined ? undefined : (input) => onUpsert(input, state),
  });
  const service = new StoreRatingService(
    new DirectoryEngagementTargetResolver(targets.directory),
    world.store,
    world.writer,
    createSequentialIds([NEW_RATING_ID]),
  );
  return { service, state, targets, world };
}

const otherMemberRow = (overrides: Partial<FakeRatingRow> = {}) =>
  fakeRatingRowOf({
    ratingId: OTHER_RATING_ID,
    productId: PRODUCT_ID,
    userId: OTHER_MEMBER_ID,
    score: 2,
    ...overrides,
  });

const ownRow = (overrides: Partial<FakeRatingRow> = {}) =>
  fakeRatingRowOf({
    ratingId: EXISTING_RATING_ID,
    productId: PRODUCT_ID,
    userId: MEMBER_ID,
    score: 3,
    ...overrides,
  });

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されなかった');
}

function expectRatingTargetNotFound(error: AppError): void {
  expect(error).toMatchObject({
    kind: 'not_found',
    code: 'rating_target_not_found',
    message: RATING_TARGET_NOT_FOUND_MESSAGE,
  });
}

describe('RatingService.read: 評価欄の値', () => {
  test('有効な評価の丸めない平均値と件数と、閲覧者の評価を返す', async () => {
    const { service, targets } = setup({
      rows: [otherMemberRow({ score: 2 }), ownRow({ score: 5 })],
    });

    const view = await service.read({
      productId: PRODUCT_ID,
      viewer: currentUserOf(MEMBER_ID),
      now: NOW,
    });

    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 3.5,
      count: 2,
      viewerScore: 5,
    });
    expect(targets.summaryReads).toEqual([
      { productIds: [PRODUCT_ID], scope: 'visible' },
    ]);
    expect(targets.launchReads).toEqual([]);
  });

  test('管理者に無効化された自分の評価は、平均値と件数から除きつつ自分の評価として返す', async () => {
    const { service } = setup({
      rows: [otherMemberRow({ score: 2 }), ownRow({ invalidated: true })],
    });

    const view = await service.read({
      productId: PRODUCT_ID,
      viewer: currentUserOf(MEMBER_ID),
      now: NOW,
    });

    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 2,
      count: 1,
      viewerScore: 3,
    });
  });

  test('停止中の評価者の評価を平均値と件数から除く', async () => {
    const { service } = setup({
      rows: [otherMemberRow({ raterSuspended: true }), ownRow({ score: 4 })],
    });

    const view = await service.read({
      productId: PRODUCT_ID,
      viewer: undefined,
      now: NOW,
    });

    expect(view).toMatchObject({ average: 4, count: 1 });
  });

  test('有効な評価が無ければ平均値をnull、件数を0にする', async () => {
    const { service } = setup();

    const view = await service.read({
      productId: PRODUCT_ID,
      viewer: currentUserOf(MEMBER_ID),
      now: NOW,
    });

    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: null,
      count: 0,
      viewerScore: null,
    });
  });

  test('未ログインの閲覧者には自分の評価をnullにし、閲覧者の評価を読まない', async () => {
    const { service, world } = setup({ rows: [ownRow()] });

    const view = await service.read({
      productId: PRODUCT_ID,
      viewer: undefined,
      now: NOW,
    });

    expect(view).toMatchObject({ average: 3, count: 1, viewerScore: null });
    expect(world.scoreReads).toEqual([]);
  });

  test('投稿者本人には、自分の評価の行があっても自分の評価をnullにする', async () => {
    const { service, world } = setup({
      rows: [ownRow({ userId: OWNER_ID })],
    });

    const view = await service.read({
      productId: PRODUCT_ID,
      viewer: currentUserOf(OWNER_ID),
      now: NOW,
    });

    expect(view).toMatchObject({ count: 1, viewerScore: null });
    expect(world.scoreReads).toEqual([]);
  });

  test('未掲載のプロダクトは投稿者本人に値を返し、他者と未ログインにはnullを返す', async () => {
    const { service } = setup({ listed: false });
    const input = { productId: PRODUCT_ID, now: NOW };

    const owner = await service.read({
      ...input,
      viewer: currentUserOf(OWNER_ID),
    });
    const member = await service.read({
      ...input,
      viewer: currentUserOf(MEMBER_ID),
    });
    const anonymous = await service.read({ ...input, viewer: undefined });

    expect(owner).toMatchObject({ productId: PRODUCT_ID, viewerScore: null });
    expect(member).toBeNull();
    expect(anonymous).toBeNull();
  });

  test('非公開化されたプロダクトは誰にもnullを返す', async () => {
    const { service, state } = setup({ rows: [ownRow()] });
    state.hidden = true;

    const owner = await service.read({
      productId: PRODUCT_ID,
      viewer: currentUserOf(OWNER_ID),
      now: NOW,
    });
    const member = await service.read({
      productId: PRODUCT_ID,
      viewer: currentUserOf(MEMBER_ID),
      now: NOW,
    });

    expect(owner).toBeNull();
    expect(member).toBeNull();
  });
});

describe('RatingService.rate: 評価と変更', () => {
  test('初めての評価を新しいIDで書き込みの単位へ渡し、評価の後の平均値・件数・自分の評価を返す', async () => {
    const { service, world } = setup({ rows: [otherMemberRow({ score: 2 })] });

    const view = await service.rate({
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      score: 5,
      now: NOW,
    });

    expect(world.upserts).toEqual([
      {
        ratingId: NEW_RATING_ID,
        productId: PRODUCT_ID,
        userId: MEMBER_ID,
        score: 5,
        at: NOW,
      },
    ]);
    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 3.5,
      count: 2,
      viewerScore: 5,
    });
  });

  test('2回目の評価は前の評価を上書きし、件数を増やさない', async () => {
    const { service, world } = setup({
      rows: [otherMemberRow({ score: 2 }), ownRow({ score: 3 })],
    });

    const view = await service.rate({
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      score: 1,
      now: NOW,
    });

    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 1.5,
      count: 2,
      viewerScore: 1,
    });
    expect(world.rows.get(`${PRODUCT_ID}:${MEMBER_ID}`)?.ratingId).toBe(
      EXISTING_RATING_ID,
    );
  });

  test('無効化された自分の評価を上書きしても、無効化を保ち平均値と件数に含めず、自分の評価として新しい値を返す', async () => {
    const { service } = setup({
      rows: [otherMemberRow({ score: 2 }), ownRow({ invalidated: true })],
    });

    const view = await service.rate({
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      score: 5,
      now: NOW,
    });

    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 2,
      count: 1,
      viewerScore: 5,
    });
  });

  test('自身のプロダクトの評価を、書き込みの単位へ渡さずrating_own_productで拒否する', async () => {
    const { service, world } = setup();

    const error = await rejectionOf(
      service.rate({
        user: currentUserOf(OWNER_ID),
        productId: PRODUCT_ID,
        score: 5,
        now: NOW,
      }),
    );

    expect(error).toMatchObject({
      kind: 'unprocessable',
      code: 'rating_own_product',
      message: OWN_PRODUCT_RATING_MESSAGE,
    });
    expect(world.upserts).toEqual([]);
  });

  test('未掲載の自身のプロダクトの評価もrating_own_productで拒否する', async () => {
    const { service, world } = setup({ listed: false });

    const error = await rejectionOf(
      service.rate({
        user: currentUserOf(OWNER_ID),
        productId: PRODUCT_ID,
        score: 5,
        now: NOW,
      }),
    );

    expect(error.code).toBe('rating_own_product');
    expect(world.upserts).toEqual([]);
  });

  test('非公開化・未掲載の他者・存在しないプロダクトの評価を、理由を区別せずrating_target_not_foundで拒否する', async () => {
    const hidden = setup();
    hidden.state.hidden = true;
    const unlisted = setup({ listed: false });
    const missing = setup();
    const input = {
      user: currentUserOf(MEMBER_ID),
      score: 4 as const,
      now: NOW,
    };

    const errors = await Promise.all([
      rejectionOf(hidden.service.rate({ ...input, productId: PRODUCT_ID })),
      rejectionOf(unlisted.service.rate({ ...input, productId: PRODUCT_ID })),
      rejectionOf(
        missing.service.rate({
          ...input,
          productId: '01JD0PROD00000000000000099',
        }),
      ),
    ]);

    for (const error of errors) {
      expectRatingTargetNotFound(error);
    }
    expect([
      ...hidden.world.upserts,
      ...unlisted.world.upserts,
      ...missing.world.upserts,
    ]).toEqual([]);
  });

  test('判定の後にプロダクトが非公開化されて書き込みの単位がrejectedを返せば、評価を残さずrating_target_not_foundで拒否する', async () => {
    const { service, world } = setup({
      rows: [ownRow({ score: 3 })],
      onUpsert: (_input, state) => {
        state.hidden = true;
        return 'rejected';
      },
    });

    const error = await rejectionOf(
      service.rate({
        user: currentUserOf(MEMBER_ID),
        productId: PRODUCT_ID,
        score: 5,
        now: NOW,
      }),
    );

    expectRatingTargetNotFound(error);
    expect(world.upserts).toHaveLength(1);
    expect(world.rows.get(`${PRODUCT_ID}:${MEMBER_ID}`)?.score).toBe(3);
  });

  test('書き込みの単位がrejectedを返し、読み直しでプロダクトに変化が無ければ利用者の停止としてaccount_unavailableで拒否する', async () => {
    const { service, world } = setup({ onUpsert: () => 'rejected' });

    const error = await rejectionOf(
      service.rate({
        user: currentUserOf(MEMBER_ID),
        productId: PRODUCT_ID,
        score: 5,
        now: NOW,
      }),
    );

    expect(error).toMatchObject({
      kind: 'forbidden',
      code: 'account_unavailable',
    });
    expect(world.rows.size).toBe(0);
  });
});

describe('RatingService.cancel: 取消', () => {
  test('自分の評価を物理削除し、取消の後の平均値・件数と自分の評価nullを返す', async () => {
    const { service, world } = setup({
      rows: [otherMemberRow({ score: 2 }), ownRow({ score: 5 })],
    });

    const view = await service.cancel({
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      now: NOW,
    });

    expect(world.removes).toEqual([
      { productId: PRODUCT_ID, userId: MEMBER_ID },
    ]);
    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 2,
      count: 1,
      viewerScore: null,
    });
  });

  test('評価の無い取消も成功し、値を変えずに返す', async () => {
    const { service, world } = setup({ rows: [otherMemberRow({ score: 2 })] });

    const view = await service.cancel({
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      now: NOW,
    });

    expect(world.removes).toHaveLength(1);
    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 2,
      count: 1,
      viewerScore: null,
    });
  });

  test('無効化された自分の評価の取消は、無効化の状態ごと行を消す', async () => {
    const { service, world } = setup({ rows: [ownRow({ invalidated: true })] });

    const view = await service.cancel({
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      now: NOW,
    });

    expect(world.rows.size).toBe(0);
    expect(view).toMatchObject({ count: 0, viewerScore: null });
  });

  test('メールアドレスを確認していない利用者の取消も受け付ける', async () => {
    const { service, world } = setup({ rows: [ownRow()] });

    await service.cancel({
      user: currentUserOf(MEMBER_ID, { emailVerifiedAt: null }),
      productId: PRODUCT_ID,
      now: NOW,
    });

    expect(world.rows.size).toBe(0);
  });

  test('非公開化・未掲載の他者のプロダクトの取消を、評価を消さずrating_target_not_foundで拒否する', async () => {
    const hidden = setup({ rows: [ownRow()] });
    hidden.state.hidden = true;
    const unlisted = setup({ listed: false, rows: [ownRow()] });
    const input = {
      user: currentUserOf(MEMBER_ID),
      productId: PRODUCT_ID,
      now: NOW,
    };

    const errors = await Promise.all([
      rejectionOf(hidden.service.cancel(input)),
      rejectionOf(unlisted.service.cancel(input)),
    ]);

    for (const error of errors) {
      expectRatingTargetNotFound(error);
    }
    expect([...hidden.world.removes, ...unlisted.world.removes]).toEqual([]);
    expect(hidden.world.rows.size).toBe(1);
    expect(unlisted.world.rows.size).toBe(1);
  });

  test('投稿者本人の取消は成功し、自分の評価nullの値を返す', async () => {
    const { service } = setup({ rows: [otherMemberRow({ score: 2 })] });

    const view = await service.cancel({
      user: currentUserOf(OWNER_ID),
      productId: PRODUCT_ID,
      now: NOW,
    });

    expect(view).toEqual({
      productId: PRODUCT_ID,
      average: 2,
      count: 1,
      viewerScore: null,
    });
  });
});
