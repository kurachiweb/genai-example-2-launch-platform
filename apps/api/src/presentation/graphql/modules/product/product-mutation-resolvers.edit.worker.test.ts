import { describe, expect, test } from 'vitest';

import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../../../lib/core/time/business-time.ts';
import {
  categoryIdOf,
  insertCategory,
  insertUser,
  T0,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  deleteProduct,
  detailsOf,
  failProductDecisionSources,
  fixtureProductFields,
  insertOwnedProduct,
  installProductGraphQLTest,
  issueProductUserSession,
  readProductRow,
  setProductTestNow,
  suspendProductUser,
  updateProduct,
} from '../../../../../test/support/product-graphql-operations.ts';

const ALICE = 1;
const BOB = 2;

const SAVE_BOT_TOKEN = botTokenFor('product_save');
const DELETE_BOT_TOKEN = botTokenFor('product_delete');

// 翌日11-11のローンチの固定が始まる、業務時刻の2026-11-10 23:45
const LOCK_STARTS_AT = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 23,
  minute: 45,
});

installProductGraphQLTest();

async function insertAlice(
  columns: Parameters<typeof insertUser>[1] = { emailVerifiedAt: T0 },
): Promise<string> {
  await insertUser(ALICE, { handle: 'alice', ...columns });
  return issueProductUserSession(ALICE);
}

function update(
  sessionToken: string,
  input: Partial<Parameters<typeof updateProduct>[0]> = {},
) {
  return updateProduct(
    {
      productHandle: 'product1',
      expectedVersion: 0,
      fields: fixtureProductFields(1),
      ...input,
    },
    { sessionToken, botToken: SAVE_BOT_TOKEN },
  );
}

function remove(sessionToken: string, expectedVersion = 0) {
  return deleteProduct(
    { productHandle: 'product1', expectedVersion },
    { sessionToken, botToken: DELETE_BOT_TOKEN },
  );
}

describe('updateProduct', () => {
  test('メールアドレスを確認していない利用者も、自分のプロダクトの名称とハンドルを変更でき、旧ハンドルを保持する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice({ emailVerifiedAt: null });
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await update(token, {
      fields: fixtureProductFields(1, {
        name: ' 新しい名称 ',
        handle: 'renamed',
      }),
      launchDate: null,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateProduct).toMatchObject({
      handle: 'renamed',
      previousHandle: 'product1',
      name: '新しい名称',
      version: 1,
      latestLaunch: { launchDate: '2026-11-20' },
    });
    expect(calls.siteverifyTokens).toEqual([SAVE_BOT_TOKEN]);
  });

  test('予定のローンチのローンチ日を変更する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await update(token, { launchDate: '2026-11-25' });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateProduct?.latestLaunch).toMatchObject({
      launchDate: '2026-11-25',
      status: 'SCHEDULED',
    });
  });

  test('マッチ直前の固定の期間でも、ローンチ日・カテゴリ以外の項目は変更できる', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-11' });
    setProductTestNow(LOCK_STARTS_AT);

    const response = await update(token, {
      fields: fixtureProductFields(1, { tagline: '固定の間の変更' }),
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateProduct).toMatchObject({
      tagline: '固定の間の変更',
      plan: { locked: true },
    });
  });

  test.each([
    [
      '空の名称',
      { fields: fixtureProductFields(1, { name: '' }) },
      'input.fields.name',
      '名称を入力してください。',
    ],
    [
      'javascriptスキームの外部WebサイトURL',
      { fields: fixtureProductFields(1, { websiteUrl: 'javascript:void(0)' }) },
      'input.fields.websiteUrl',
      '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。',
    ],
    [
      '形式の違うローンチ日',
      { launchDate: '11/25' },
      'input.launchDate',
      'ローンチ日を選んでください。',
    ],
  ])(
    '%sは、bot判定の前にvalidation_errorで欄ごとの詳細を返す',
    async (_name, input, field, message) => {
      const calls = stubExternalServices();
      const token = await insertAlice();
      await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

      const response = await update(token, input);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([{ field, code: 'custom', message }]);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );

  test('他の利用者のプロダクトはproduct_not_foundで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'bob', emailVerifiedAt: T0 });
    await insertOwnedProduct(1, BOB, { launchDate: '2026-11-20' });

    const response = await update(token, {
      fields: fixtureProductFields(1, { name: '変更されない' }),
    });

    expect(codesOf(response)).toEqual(['product_not_found']);
    expect((await readProductRow(1))?.name).toBe('プロダクト1');
  });

  test('版が違えばproduct_update_conflictで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(
      1,
      ALICE,
      { launchDate: '2026-11-20' },
      { version: 2 },
    );

    const response = await update(token, {
      expectedVersion: 1,
      fields: fixtureProductFields(1, { name: '変更されない' }),
    });

    expect(codesOf(response)).toEqual(['product_update_conflict']);
    expect(await readProductRow(1)).toMatchObject({
      name: 'プロダクト1',
      version: 2,
    });
  });

  test('マッチ直前の固定の期間のカテゴリの変更はproduct_lockedで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertCategory(1, { name: '開発ツール', handle: 'dev-tools' });
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-11' });
    setProductTestNow(LOCK_STARTS_AT);

    const response = await update(token, {
      fields: fixtureProductFields(1, { categoryId: categoryIdOf(1) }),
    });

    expect(codesOf(response)).toEqual(['product_locked']);
  });

  test('予選マッチ中のプロダクトの次回の予約はrelaunch_blockedで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-10' });

    const response = await update(token, { launchDate: '2026-11-20' });

    expect(codesOf(response)).toEqual(['relaunch_blocked']);
    expect(response.errors?.[0]?.message).toBe(
      'このプロダクトは予選マッチに参加中のため再ローンチできません。',
    );
  });

  test('非公開化中のプロダクトの次回の予約はproduct_hiddenで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(
      1,
      ALICE,
      { launchDate: '2026-11-01', outcome: 'won' },
      { hiddenAt: T0 },
    );

    const response = await update(token, { launchDate: '2026-11-20' });

    expect(codesOf(response)).toEqual(['product_hidden']);
    expect(response.errors?.[0]?.message).toBe(
      'このプロダクトは公開が停止されているため、ローンチを予約できません。',
    );
  });

  test('判定の供給元が失敗したら、次回の予約をdecision_unavailableで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, {
      launchDate: '2026-11-01',
      outcome: 'won',
    });
    failProductDecisionSources();

    const response = await update(token, { launchDate: '2026-11-20' });

    expect(codesOf(response)).toEqual(['decision_unavailable']);
  });

  test('使用中のハンドルとの重複と選べないローンチ日は、詳細の欄をGraphQLの引数の経路にする', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });
    await insertOwnedProduct(2, ALICE, { launchDate: '2026-11-20' });

    const handleTaken = await update(token, {
      fields: fixtureProductFields(1, { handle: 'product2' }),
    });
    const dateUnavailable = await update(token, { launchDate: '2026-11-10' });

    expect(codesOf(handleTaken)).toEqual(['handle_unavailable']);
    expect(detailsOf(handleTaken).map(({ field }) => field)).toEqual([
      'input.fields.handle',
    ]);
    expect(codesOf(dateUnavailable)).toEqual(['launch_date_unavailable']);
    expect(detailsOf(dateUnavailable).map(({ field }) => field)).toEqual([
      'input.launchDate',
    ]);
  });

  test.each([
    ['未ログイン', false, 'unauthenticated'],
    ['停止中', true, 'account_unavailable'],
  ])(
    '%sの利用者の編集は、bot判定を使わず%sで拒否する',
    async (_name, suspended, code) => {
      const calls = stubExternalServices();
      const token = await insertAlice();
      await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });
      if (suspended) {
        await suspendProductUser(ALICE);
      }

      const response = await updateProduct(
        {
          productHandle: 'product1',
          expectedVersion: 0,
          fields: fixtureProductFields(1, { name: '変更されない' }),
        },
        suspended
          ? { sessionToken: token, botToken: SAVE_BOT_TOKEN }
          : { botToken: SAVE_BOT_TOKEN },
      );

      expect(codesOf(response)).toEqual([code]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect((await readProductRow(1))?.name).toBe('プロダクト1');
    },
  );

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    [
      '削除の操作名の判定の結果である',
      DELETE_BOT_TOKEN,
      'bot_verification_failed',
    ],
  ])('bot判定の%s場合は保存せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await updateProduct(
      {
        productHandle: 'product1',
        expectedVersion: 0,
        fields: fixtureProductFields(1, { name: '変更されない' }),
      },
      botToken === undefined
        ? { sessionToken: token }
        : { sessionToken: token, botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect((await readProductRow(1))?.name).toBe('プロダクト1');
  });
});

describe('deleteProduct', () => {
  test('メールアドレスを確認していない利用者も、bot判定を通ると自分のプロダクトを論理削除できる', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice({ emailVerifiedAt: null });
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await remove(token);

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteProduct).toBe(true);
    expect((await readProductRow(1))?.deletedAt).not.toBeNull();
    expect(calls.siteverifyTokens).toEqual([DELETE_BOT_TOKEN]);
  });

  test('他の利用者のプロダクトはproduct_not_foundで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertUser(BOB, { handle: 'bob', emailVerifiedAt: T0 });
    await insertOwnedProduct(1, BOB, { launchDate: '2026-11-20' });

    const response = await remove(token);

    expect(codesOf(response)).toEqual(['product_not_found']);
    expect((await readProductRow(1))?.deletedAt).toBeNull();
  });

  test('版が違えばproduct_update_conflictで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await remove(token, 1);

    expect(codesOf(response)).toEqual(['product_update_conflict']);
    expect((await readProductRow(1))?.deletedAt).toBeNull();
  });

  test('マッチ直前の固定の期間はproduct_lockedで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-11' });
    setProductTestNow(LOCK_STARTS_AT);

    const response = await remove(token);

    expect(codesOf(response)).toEqual(['product_locked']);
    expect((await readProductRow(1))?.deletedAt).toBeNull();
  });

  test('固定の判定の供給元が失敗したらdecision_unavailableで拒否する', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });
    failProductDecisionSources();

    const response = await remove(token);

    expect(codesOf(response)).toEqual(['decision_unavailable']);
    expect((await readProductRow(1))?.deletedAt).toBeNull();
  });

  test.each([
    ['未ログイン', false, 'unauthenticated'],
    ['停止中', true, 'account_unavailable'],
  ])(
    '%sの利用者の削除は、bot判定を使わず%sで拒否する',
    async (_name, suspended, code) => {
      const calls = stubExternalServices();
      const token = await insertAlice();
      await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });
      if (suspended) {
        await suspendProductUser(ALICE);
      }

      const response = await deleteProduct(
        { productHandle: 'product1', expectedVersion: 0 },
        suspended
          ? { sessionToken: token, botToken: DELETE_BOT_TOKEN }
          : { botToken: DELETE_BOT_TOKEN },
      );

      expect(codesOf(response)).toEqual([code]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect((await readProductRow(1))?.deletedAt).toBeNull();
    },
  );

  test.each([
    [
      '保存の操作名の判定の結果である',
      SAVE_BOT_TOKEN,
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は削除せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await deleteProduct(
      { productHandle: 'product1', expectedVersion: 0 },
      { sessionToken: token, botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect((await readProductRow(1))?.deletedAt).toBeNull();
  });
});
