import { describe, expect, test } from 'vitest';

import { PRODUCT_LOGO_PURPOSE } from '../../../../../common-lib/product/product-input-rules.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../../lib/core/time/business-time.ts';
import {
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertScreenshot,
  insertUser,
  launchIdOf,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  fetchMyProduct,
  fetchProductOwnerStatus,
  insertOwnedProduct,
  installProductGraphQLTest,
  issueProductUserSession,
  kickoffOf,
  PRODUCT_TEST_NOW,
  setProductTestNow,
} from '../../../../../test/support/product-graphql-operations.ts';
import type { MyProductFields } from '../../../../../test/support/product-graphql-documents.ts';
import { computeLaunchDateWindow } from '../../../../domain/product/launch-date-rules.ts';

const ALICE = 1;

installProductGraphQLTest();

async function insertAlice(): Promise<string> {
  await insertUser(ALICE, { handle: 'alice', emailVerifiedAt: T0 });
  return issueProductUserSession(ALICE);
}

async function fetchOwnProduct(
  handle: string,
  token: string,
): Promise<MyProductFields> {
  const response = await fetchMyProduct(handle, { sessionToken: token });
  const product = response.data?.myProduct;
  if (product?.__typename !== 'MyProduct') {
    throw new Error(
      `自分のプロダクトが返りませんでした: ${JSON.stringify(response.errors)}`,
    );
  }
  return product;
}

describe('ローンチの状態と計画', () => {
  test('結果が未確定で当日のローンチは予選マッチ中で、予約できず固定される', async () => {
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-10' });

    const product = await fetchOwnProduct('product1', token);

    expect(product.latestLaunch).toEqual({
      id: launchIdOf(1),
      number: 1,
      launchDate: '2026-11-10',
      kickoffAt: kickoffOf('2026-11-10'),
      status: 'IN_PROGRESS',
      outcome: null,
      summary: { label: '予選マッチ中', inMatch: true },
    });
    expect(product.plan).toEqual({
      mode: 'BLOCKED',
      currentLaunchDate: null,
      window: null,
      blocks: [
        {
          code: 'qualifier_in_progress',
          message:
            'このプロダクトは予選マッチに参加中のため再ローンチできません。',
          releaseAt: null,
        },
      ],
      locked: true,
      locks: [
        {
          code: 'qualifier_match',
          message:
            'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
        },
      ],
      lockUnknown: false,
      ultrasEntitled: false,
    });
  });

  test('ペアリングの後の翌日のローンチはペアリング済みで、予約できず固定される', async () => {
    setProductTestNow(
      fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
        hour: 23,
        minute: 50,
      }),
    );
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-11' });

    const response = await fetchProductOwnerStatus('product1', {
      sessionToken: token,
    });

    expect(response.data?.productOwnerStatus?.latestLaunch).toEqual(
      expect.objectContaining({
        status: 'PAIRED',
        summary: { label: 'キックオフ予定', inMatch: false },
      }),
    );
    expect(response.data?.productOwnerStatus?.plan).toEqual(
      expect.objectContaining({
        mode: 'BLOCKED',
        blocks: [expect.objectContaining({ code: 'launch_scheduled' })],
        locked: true,
      }),
    );
  });

  test('勝利で終えたローンチは結果と掲載の要約を返し、新しいローンチを予約できる', async () => {
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, {
      launchDate: '2026-11-01',
      outcome: 'won',
    });

    const product = await fetchOwnProduct('product1', token);

    const window = computeLaunchDateWindow({
      now: PRODUCT_TEST_NOW,
      basis: { launchDate: parseBusinessDate('2026-11-01'), outcome: 'won' },
      entitled: false,
    });
    expect(product.listed).toBe(true);
    expect(product.latestLaunch).toEqual(
      expect.objectContaining({
        status: 'FINISHED',
        outcome: 'WON',
        summary: { label: 'ディレクトリ掲載', inMatch: false },
      }),
    );
    expect(product.plan).toEqual(
      expect.objectContaining({
        mode: 'NEW',
        currentLaunchDate: null,
        window: {
          earliest: window.earliest,
          latest: window.latest,
          unavailable: window.unavailable.map((range) => ({
            from: range.from,
            to: range.to,
            reason: range.reason.toUpperCase(),
          })),
          relaunchIntervalDays: null,
        },
        blocks: [],
        locked: false,
      }),
    );
  });

  test('敗北で終えたローンチは敗北後の間隔の日数と理由の範囲を返す', async () => {
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, {
      launchDate: '2026-11-09',
      outcome: 'lost',
    });

    const response = await fetchProductOwnerStatus('product1', {
      sessionToken: token,
    });

    const status = response.data?.productOwnerStatus;
    expect(status?.latestLaunch).toEqual(
      expect.objectContaining({
        status: 'FINISHED',
        outcome: 'LOST',
        summary: { label: '予選敗北', inMatch: false },
      }),
    );
    expect(status?.plan.mode).toBe('NEW');
    expect(status?.plan.ultrasEntitled).toBe(false);
    expect(status?.plan.window?.relaunchIntervalDays).toBe(7);
    expect(
      status?.plan.window?.unavailable.map(({ reason }) => reason),
    ).toContain('RELAUNCH_INTERVAL');
  });

  test('取消のローンチしか無ければ直近のローンチはnullで、新しいローンチを予約できる', async () => {
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, {
      launchDate: '2026-11-20',
      cancelledAt: T0,
    });

    const product = await fetchOwnProduct('product1', token);

    expect(product.latestLaunch).toBeNull();
    expect(product.plan.mode).toBe('NEW');
  });

  test('非公開化中のプロダクトは非公開化中の表示と予約の禁止の理由を返す', async () => {
    const token = await insertAlice();
    await insertOwnedProduct(
      1,
      ALICE,
      { launchDate: '2026-11-01', outcome: 'won' },
      { hiddenAt: T0 },
    );

    const product = await fetchOwnProduct('product1', token);

    expect(product.hidden).toBe(true);
    expect(product.listed).toBe(false);
    expect(product.plan).toEqual(
      expect.objectContaining({
        mode: 'BLOCKED',
        blocks: [
          {
            code: 'product_hidden',
            message:
              'このプロダクトは公開が停止されているため、ローンチを予約できません。',
            releaseAt: null,
          },
        ],
      }),
    );
  });
});

describe('画像の項目', () => {
  test('配信できる画像はオブジェクトキーを返し、隔離中の画像はオブジェクトキーを空にし、記録の無い画像はnullにする', async () => {
    const token = await insertAlice();
    await insertFile(1, {
      purpose: PRODUCT_LOGO_PURPOSE,
      ownerId: userIdOf(ALICE),
      location: 'quarantine',
      moderationStatus: 'flagged',
    });
    await insertReason(1, 'auto');
    await insertFile(2, { ownerId: userIdOf(ALICE) });
    await insertFile(3, {
      ownerId: userIdOf(ALICE),
      location: 'quarantine',
      moderationStatus: 'flagged',
    });
    await insertReason(3, 'auto');
    await insertOwnedProduct(
      1,
      ALICE,
      { launchDate: '2026-11-20' },
      { logoFileId: fileIdOf(1) },
    );
    await insertScreenshot(1, 1, 0, fileIdOf(2));
    await insertScreenshot(2, 1, 1, fileIdOf(3));
    await insertScreenshot(3, 1, 2, fileIdOf(9));

    const product = await fetchOwnProduct('product1', token);

    expect(product.logoFileId).toBe(fileIdOf(1));
    expect(product.logo).toEqual({ id: fileIdOf(1), objectKey: null });
    expect(product.screenshots).toEqual([
      {
        fileId: fileIdOf(2),
        image: { id: fileIdOf(2), objectKey: objectKeyOf(2) },
      },
      { fileId: fileIdOf(3), image: { id: fileIdOf(3), objectKey: null } },
      { fileId: fileIdOf(9), image: null },
    ]);
  });
});
