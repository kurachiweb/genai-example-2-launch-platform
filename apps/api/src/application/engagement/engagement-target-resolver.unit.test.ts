import { describe, expect, test } from 'bun:test';

import type { LaunchRecord } from '../../../lib/core/product/ports.ts';
import { DirectoryEngagementTargetResolver } from './engagement-target-resolver.ts';
import {
  activeState,
  createFakeTargetDirectory,
  type FakeProductState,
  LAUNCH_ID,
  launchOf,
  MEMBER_ID,
  NOW,
  OTHER_LAUNCH_ID,
  OTHER_PRODUCT_ID,
  OWNER_ID,
  PRODUCT_ID,
  summaryOf,
} from './testing/target-fakes.ts';

interface SetupOptions {
  readonly listed?: boolean;
  readonly state?: FakeProductState;
  readonly launches?: readonly LaunchRecord[];
}

function setup(options: SetupOptions = {}) {
  const state = options.state ?? activeState();
  const fake = createFakeTargetDirectory({
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
    launches: options.launches ?? [launchOf()],
  });
  const resolver = new DirectoryEngagementTargetResolver(fake.directory);
  return { resolver, state, ...fake };
}

describe('EngagementTargetResolver.resolve: 照会', () => {
  test('ローンチを指定すると、可視のプロダクトの照会とローンチの一覧を待たずに並べて1回ずつ読む', async () => {
    const { resolver, summaryReads, launchReads } = setup();

    const pending = resolver.resolve({
      productId: PRODUCT_ID,
      launchId: LAUNCH_ID,
      viewerUserId: MEMBER_ID,
      now: NOW,
    });

    expect(summaryReads).toEqual([
      { productIds: [PRODUCT_ID], scope: 'visible' },
    ]);
    expect(launchReads).toEqual([{ productIds: [PRODUCT_ID], now: NOW }]);
    await pending;
    expect(summaryReads).toHaveLength(1);
    expect(launchReads).toHaveLength(1);
  });

  test('ローンチを指定しなければローンチの一覧を読まず、ローンチは未解決になる', async () => {
    const { resolver, summaryReads, launchReads } = setup();

    const target = await resolver.resolve({
      productId: PRODUCT_ID,
      viewerUserId: MEMBER_ID,
      now: NOW,
    });

    expect(target?.product.productId).toBe(PRODUCT_ID);
    expect(target?.launch).toBeUndefined();
    expect(target?.viewerIsOwner).toBe(false);
    expect(summaryReads).toHaveLength(1);
    expect(launchReads).toHaveLength(0);
  });
});

describe('EngagementTargetResolver.resolve: 閲覧の可否', () => {
  test.each([
    ['掲載中・他者', true, MEMBER_ID, false],
    ['掲載中・未ログイン', true, undefined, false],
    ['掲載中・投稿者本人', true, OWNER_ID, true],
    ['未掲載・投稿者本人', false, OWNER_ID, true],
  ] as const)(
    '%sは解決し、投稿者本人かどうかを返す',
    async (_label, listed, viewerUserId, viewerIsOwner) => {
      const { resolver } = setup({ listed });

      const target = await resolver.resolve({
        productId: PRODUCT_ID,
        launchId: LAUNCH_ID,
        viewerUserId,
        now: NOW,
      });

      expect(target?.product.productId).toBe(PRODUCT_ID);
      expect(target?.launch).toEqual(launchOf());
      expect(target?.viewerIsOwner).toBe(viewerIsOwner);
    },
  );

  test.each([
    ['他者', MEMBER_ID],
    ['未ログイン', undefined],
  ] as const)(
    '未掲載のプロダクトは%sに未解決になる',
    async (_label, viewerUserId) => {
      const { resolver } = setup({ listed: false });

      expect(
        await resolver.resolve({
          productId: PRODUCT_ID,
          launchId: LAUNCH_ID,
          viewerUserId,
          now: NOW,
        }),
      ).toBeUndefined();
    },
  );

  test('存在しないプロダクトは未解決になる', async () => {
    const { resolver } = setup();

    expect(
      await resolver.resolve({
        productId: '01JD0PROD00000000000000009',
        launchId: LAUNCH_ID,
        viewerUserId: OWNER_ID,
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test.each([
    ['非公開化', 'hidden'],
    ['論理削除', 'deleted'],
    ['投稿者の退会', 'ownerWithdrawn'],
    ['投稿者の停止', 'ownerSuspended'],
  ] as const)(
    '%sのプロダクトは投稿者本人にも未解決になる',
    async (_label, key) => {
      const { resolver } = setup({ state: { ...activeState(), [key]: true } });

      for (const viewerUserId of [OWNER_ID, MEMBER_ID, undefined]) {
        expect(
          await resolver.resolve({
            productId: PRODUCT_ID,
            launchId: LAUNCH_ID,
            viewerUserId,
            now: NOW,
          }),
        ).toBeUndefined();
      }
    },
  );

  test.each([
    ['非公開化の後の復元', 'hidden'],
    ['投稿者の停止の後の解除', 'ownerSuspended'],
  ] as const)('%sで再び解決する', async (_label, key) => {
    const { resolver, state } = setup();
    const input = {
      productId: PRODUCT_ID,
      launchId: LAUNCH_ID,
      viewerUserId: MEMBER_ID,
      now: NOW,
    };

    state[key] = true;
    expect(await resolver.resolve(input)).toBeUndefined();
    state[key] = false;
    const target = await resolver.resolve(input);

    expect(target?.product.productId).toBe(PRODUCT_ID);
    expect(target?.launch?.launchId).toBe(LAUNCH_ID);
  });
});

describe('EngagementTargetResolver.resolve: ローンチ', () => {
  test.each(['scheduled', 'paired', 'in_progress', 'finished'] as const)(
    '取消でないローンチ(%s)はそのまま返す',
    async (status) => {
      const launch = launchOf({ status });
      const { resolver } = setup({ launches: [launch] });

      const target = await resolver.resolve({
        productId: PRODUCT_ID,
        launchId: LAUNCH_ID,
        viewerUserId: MEMBER_ID,
        now: NOW,
      });

      expect(target?.launch).toEqual(launch);
    },
  );

  test('取消のローンチは未解決のローンチを返す', async () => {
    const { resolver } = setup({
      launches: [launchOf({ status: 'canceled', number: 0 })],
    });

    const target = await resolver.resolve({
      productId: PRODUCT_ID,
      launchId: LAUNCH_ID,
      viewerUserId: MEMBER_ID,
      now: NOW,
    });

    expect(target?.product.productId).toBe(PRODUCT_ID);
    expect(target?.launch).toBeUndefined();
  });

  test('別のプロダクトのローンチは未解決のローンチを返す', async () => {
    const { resolver } = setup({
      launches: [
        launchOf(),
        launchOf({ launchId: OTHER_LAUNCH_ID, productId: OTHER_PRODUCT_ID }),
      ],
    });

    const target = await resolver.resolve({
      productId: PRODUCT_ID,
      launchId: OTHER_LAUNCH_ID,
      viewerUserId: MEMBER_ID,
      now: NOW,
    });

    expect(target?.product.productId).toBe(PRODUCT_ID);
    expect(target?.launch).toBeUndefined();
  });

  test('存在しないローンチは未解決のローンチを返す', async () => {
    const { resolver } = setup();

    const target = await resolver.resolve({
      productId: PRODUCT_ID,
      launchId: '01JD0LNCH00000000000000009',
      viewerUserId: MEMBER_ID,
      now: NOW,
    });

    expect(target?.product.productId).toBe(PRODUCT_ID);
    expect(target?.launch).toBeUndefined();
  });
});
