import { describe, expect, test } from 'bun:test';

import {
  CATEGORY_COUNT,
  baseInstantOf,
  categoryAt,
  launchOf,
  productAt,
  userAt,
  type EntityContext,
} from './entities.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from './scale-profile.ts';

const context = (overrides: Partial<EntityContext> = {}): EntityContext => ({
  seed: 1,
  baseDate: '2026-11-24',
  profile: SMOKE_PROFILE,
  ...overrides,
});

const DAY_MS = 86_400_000;

describe('baseInstantOf', () => {
  test('基準日の業務日付の0:00(UTCの前日の8:00)を返す', () => {
    expect(baseInstantOf('2026-11-24').toISOString()).toBe(
      '2026-11-24T08:00:00.000Z',
    );
  });
});

describe('userAt', () => {
  test('メールアドレスはreadiness.exampleのドメインで、連番が入る', () => {
    expect(userAt(context(), 0).email).toBe(
      'synthetic-000001@readiness.example',
    );
    expect(userAt(context(), 49).email).toBe(
      'synthetic-000050@readiness.example',
    );
  });

  test('ハンドルは利用者のハンドルの規則(25文字以内・英数字とハイフン)に合う', () => {
    const handle = userAt(
      context({ profile: YEAR_ONE_PROFILE }),
      49_999,
    ).handle;

    expect(handle.length).toBeLessThanOrEqual(25);
    expect(handle).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
  });

  test('作成日時は基準日の前の1年の間で、番号が大きいほど新しい', () => {
    const profile = YEAR_ONE_PROFILE;
    const start = baseInstantOf('2026-11-24').getTime();

    const first = userAt(context({ profile }), 0);
    const last = userAt(context({ profile }), profile.users - 1);

    expect(first.createdAt.getTime()).toBe(start - 365 * DAY_MS);
    expect(last.createdAt.getTime()).toBeLessThan(start - DAY_MS + 1);
    expect(last.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    expect(last.id > first.id).toBe(true);
  });

  test('同じ種なら同じ値で、種が違えばIDが変わる', () => {
    expect(userAt(context(), 3)).toEqual(userAt(context(), 3));
    expect(userAt(context({ seed: 2 }), 3).id).not.toBe(
      userAt(context(), 3).id,
    );
    expect(userAt(context(), 3).id).not.toBe(userAt(context(), 4).id);
  });

  test('範囲外の番号は例外にする', () => {
    expect(() => userAt(context(), -1)).toThrow(RangeError);
    expect(() => userAt(context(), SMOKE_PROFILE.users)).toThrow(RangeError);
  });
});

describe('productAt', () => {
  test('投稿者は同じ番号の利用者で、作成は投稿者の作成より後になる', () => {
    const product = productAt(context(), 5);

    expect(product.ownerId).toBe(userAt(context(), 5).id);
    expect(product.createdAt.getTime()).toBeGreaterThan(
      userAt(context(), 5).createdAt.getTime(),
    );
  });

  test('URLは.exampleのドメインだけで、ハンドルはプロダクトのハンドルの規則に合う', () => {
    const product = productAt(context(), 7);

    expect(new URL(product.websiteUrl).hostname.endsWith('.example')).toBe(
      true,
    );
    expect(product.handle).toBe('synthetic-p-000008');
    expect(product.handle.length).toBeLessThanOrEqual(50);
  });

  test('最大のフォロワーを持つ作り手(番号0)のプロダクトのローンチは基準日の翌業務日にする', () => {
    expect(launchOf(context(), 0).launchDate).toBe('2026-11-25');
    expect(productAt(context(), 0).latestLaunchDate).toBe('2026-11-25');
  });

  test('それ以外のローンチは翌々業務日から90日先までの間に収まる', () => {
    const dates = Array.from(
      { length: SMOKE_PROFILE.products - 1 },
      (_, index) => launchOf(context(), index + 1).launchDate,
    );

    expect(
      dates.every((date) => date >= '2026-11-26' && date <= '2027-02-22'),
    ).toBe(true);
    expect(productAt(context(), 3).latestLaunchDate).toBe(
      launchOf(context(), 3).launchDate,
    );
  });

  test('ローンチはプロダクトのIDを指し、作成はプロダクトと同時になる', () => {
    const product = productAt(context(), 2);
    const launch = launchOf(context(), 2);

    expect(launch.productId).toBe(product.id);
    expect(launch.createdAt).toEqual(product.createdAt);
  });

  test('カテゴリは合成のカテゴリとその他を順に割り当てる', () => {
    const categoryIds = Array.from(
      { length: CATEGORY_COUNT + 1 },
      (_, index) => productAt(context(), index).categoryId,
    );

    expect(new Set(categoryIds).size).toBe(CATEGORY_COUNT + 1);
    expect(categoryIds[CATEGORY_COUNT]).toBe('01JD0000000000000000000000');
    expect(categoryIds[0]).toBe(categoryAt(context(), 0).id);
  });

  test('ロゴは指定が無ければ既定の共通のファイルのID、指定があればそのIDにする', () => {
    expect(productAt(context(), 1).logoFileId).toBe(
      productAt(context(), 2).logoFileId,
    );
    expect(
      productAt(context({ logoFileId: 'shared-logo' }), 1).logoFileId,
    ).toBe('shared-logo');
  });

  test('範囲外の番号は例外にする', () => {
    expect(() => productAt(context(), SMOKE_PROFILE.products)).toThrow(
      RangeError,
    );
  });
});

describe('categoryAt', () => {
  test('ハンドルと名前が重ならない', () => {
    const categories = Array.from({ length: CATEGORY_COUNT }, (_, index) =>
      categoryAt(context(), index),
    );

    expect(new Set(categories.map((category) => category.handle)).size).toBe(
      CATEGORY_COUNT,
    );
    expect(new Set(categories.map((category) => category.name)).size).toBe(
      CATEGORY_COUNT,
    );
    expect(() => categoryAt(context(), CATEGORY_COUNT)).toThrow(RangeError);
  });
});
