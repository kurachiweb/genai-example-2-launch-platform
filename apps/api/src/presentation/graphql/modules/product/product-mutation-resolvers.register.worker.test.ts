import { describe, expect, test } from 'vitest';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../../../common-lib/product/product-category-constants.ts';
import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../../../../../common-lib/product/product-input-rules.ts';
import {
  fileIdOf,
  insertFile,
} from '../../../../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  categoryIdOf,
  insertUser,
  T0,
  userIdOf,
} from '../../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  BOT_UNREACHABLE_TOKEN,
  botTokenFor,
  stubExternalServices,
} from '../../../../../test/support/graphql-gateway.ts';
import {
  codesOf,
  countProducts,
  deleteProduct,
  detailsOf,
  fixtureProductFields,
  insertOwnedProduct,
  installProductGraphQLTest,
  issueProductUserSession,
  kickoffOf,
  type ProductFieldsVariables,
  registerProduct,
  suspendProductUser,
  updateProduct,
} from '../../../../../test/support/product-graphql-operations.ts';

const ALICE = 1;
const BOB = 2;

const LOGO_FILE = 1;
const SCREENSHOT_FILE = 2;
const BOB_LOGO_FILE = 3;

const SAVE_BOT_TOKEN = botTokenFor('product_save');
const DELETE_BOT_TOKEN = botTokenFor('product_delete');

// 業務時刻の2026-11-10 12:00では、11-11から2027-02-08までを選べる
const EARLIEST_LAUNCH_DATE = '2026-11-11';

const URL_FORMAT_MESSAGE =
  '外部WebサイトURLは"https://"または"http://"から始まるURLを入力してください。';

installProductGraphQLTest();

async function insertAlice(
  columns: Parameters<typeof insertUser>[1] = { emailVerifiedAt: T0 },
): Promise<string> {
  await insertUser(ALICE, { handle: 'alice', ...columns });
  return issueProductUserSession(ALICE);
}

async function insertAliceImages(): Promise<void> {
  await insertFile(LOGO_FILE, {
    purpose: PRODUCT_LOGO_PURPOSE,
    ownerId: userIdOf(ALICE),
  });
  await insertFile(SCREENSHOT_FILE, {
    purpose: PRODUCT_SCREENSHOT_PURPOSE,
    ownerId: userIdOf(ALICE),
  });
}

function newFields(
  overrides: Partial<ProductFieldsVariables> = {},
): ProductFieldsVariables {
  return {
    name: 'ローンチ計測',
    tagline: '公開の反応をまとめて見る',
    categoryId: PRODUCT_CATEGORY_OTHER_ID,
    handle: 'launch-meter',
    websiteUrl: 'https://launch-meter.example/',
    description: '# 概要',
    logoFileId: fileIdOf(LOGO_FILE),
    screenshotFileIds: [],
    ...overrides,
  };
}

function register(
  sessionToken: string,
  fields: ProductFieldsVariables = newFields(),
  launchDate = EARLIEST_LAUNCH_DATE,
) {
  return registerProduct(
    { fields, launchDate },
    { sessionToken, botToken: SAVE_BOT_TOKEN },
  );
}

describe('呼び出し元の確認', () => {
  test.each([
    [
      'registerProduct',
      () =>
        registerProduct(
          { fields: newFields({ name: '' }), launchDate: 'x' },
          { caller: 'admin', botToken: SAVE_BOT_TOKEN },
        ),
    ],
    [
      'updateProduct',
      () =>
        updateProduct(
          {
            productHandle: 'product1',
            expectedVersion: 0,
            fields: fixtureProductFields(1, { name: '' }),
          },
          { caller: 'admin', botToken: SAVE_BOT_TOKEN },
        ),
    ],
    [
      'deleteProduct',
      () =>
        deleteProduct(
          { productHandle: 'product1', expectedVersion: 0 },
          { caller: 'admin', botToken: DELETE_BOT_TOKEN },
        ),
    ],
  ])(
    '管理者側の呼び出し元からの%sは、入力の検証とbot判定の前にforbiddenで拒否する',
    async (_name, call) => {
      const calls = stubExternalServices();
      await insertAlice();

      const response = await call();

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(calls.siteverifyTokens).toEqual([]);
    },
  );
});

describe('registerProduct', () => {
  test('確認済みの利用者がbot判定を通ると、前後の空白を除いた項目でプロダクトと最初のローンチを登録して返す', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await insertAliceImages();

    const response = await register(
      token,
      newFields({
        name: '  ローンチ計測　',
        tagline: ' 公開の反応をまとめて見る ',
        websiteUrl: ' https://launch-meter.example/ ',
        description: '# 概要\n',
        screenshotFileIds: [fileIdOf(SCREENSHOT_FILE)],
      }),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.registerProduct).toMatchObject({
      __typename: 'MyProduct',
      handle: 'launch-meter',
      previousHandle: null,
      name: 'ローンチ計測',
      tagline: '公開の反応をまとめて見る',
      category: { id: PRODUCT_CATEGORY_OTHER_ID },
      websiteUrl: 'https://launch-meter.example/',
      description: '# 概要\n',
      logoFileId: fileIdOf(LOGO_FILE),
      logo: { id: fileIdOf(LOGO_FILE) },
      screenshots: [{ fileId: fileIdOf(SCREENSHOT_FILE) }],
      hidden: false,
      listed: false,
      version: 0,
      latestLaunch: {
        number: 1,
        launchDate: EARLIEST_LAUNCH_DATE,
        kickoffAt: kickoffOf(EARLIEST_LAUNCH_DATE),
        status: 'SCHEDULED',
      },
      plan: { mode: 'RESCHEDULE', currentLaunchDate: EARLIEST_LAUNCH_DATE },
    });
    expect(calls.siteverifyTokens).toEqual([SAVE_BOT_TOKEN]);
  });

  test.each([
    ['空白だけの名称', { name: ' 　 ' }, 'name', '名称を入力してください。'],
    [
      '51文字の名称',
      { name: 'あ'.repeat(51) },
      'name',
      '名称は50文字以内で入力してください。',
    ],
    [
      '制御文字を含む名称',
      { name: 'アルファ\u0007' },
      'name',
      '名称に使用できない文字が含まれています。',
    ],
    [
      '101文字のタグライン',
      { tagline: 'あ'.repeat(101) },
      'tagline',
      'タグラインは100文字以内で入力してください。',
    ],
    ['空のハンドル', { handle: '' }, 'handle', 'ハンドルを入力してください。'],
    [
      '51文字のハンドル',
      { handle: 'a'.repeat(51) },
      'handle',
      'ハンドルは50文字以内で入力してください。',
    ],
    [
      '記号で始まるハンドル',
      { handle: '-launch' },
      'handle',
      'ハンドルは英数字で始め、英数字・ハイフン・アンダースコアのみで入力してください。',
    ],
    [
      '空白だけの外部WebサイトURL',
      { websiteUrl: ' ' },
      'websiteUrl',
      '外部WebサイトのURLを入力してください。',
    ],
    [
      '2,049文字の外部WebサイトURL',
      { websiteUrl: `https://launch.example/${'a'.repeat(2026)}` },
      'websiteUrl',
      '外部WebサイトURLは2,048文字以内で入力してください。',
    ],
    [
      'javascriptスキームの外部WebサイトURL',
      { websiteUrl: 'javascript:alert(1)' },
      'websiteUrl',
      URL_FORMAT_MESSAGE,
    ],
    [
      '相対URLの外部WebサイトURL',
      { websiteUrl: '/launch-meter' },
      'websiteUrl',
      URL_FORMAT_MESSAGE,
    ],
    [
      '空白だけの説明文',
      { description: ' \n ' },
      'description',
      '説明文を入力してください。',
    ],
    [
      '20,001文字の説明文',
      { description: 'あ'.repeat(20_001) },
      'description',
      '説明文は20,000文字以内で入力してください。',
    ],
    [
      '21件のスクリーンショット',
      {
        screenshotFileIds: Array.from({ length: 21 }, (_, index) =>
          fileIdOf(index + 10),
        ),
      },
      'screenshotFileIds',
      'スクリーンショットは20枚・合計10MB以内にしてください。',
    ],
    [
      '同じIDを2回含むスクリーンショット',
      { screenshotFileIds: [fileIdOf(10), fileIdOf(11), fileIdOf(10)] },
      'screenshotFileIds',
      '画像をもう一度選択してください。',
    ],
  ])(
    '%sは、bot判定の前にvalidation_errorで欄ごとの詳細を返す',
    async (_name, overrides, field, message) => {
      const calls = stubExternalServices();
      const token = await insertAlice();

      const response = await register(token, newFields(overrides));

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        { field: `input.fields.${field}`, code: 'custom', message },
      ]);
      expect(calls.siteverifyTokens).toEqual([]);
      expect(await countProducts()).toBe(0);
    },
  );

  test('20件のスクリーンショットと20,000文字の説明文は入力の検証を通る', async () => {
    stubExternalServices();
    const token = await insertAlice();

    const response = await register(
      token,
      newFields({
        description: 'あ'.repeat(20_000),
        screenshotFileIds: Array.from({ length: 20 }, (_, index) =>
          fileIdOf(index + 10),
        ),
      }),
    );

    expect(codesOf(response)).toEqual(['invalid_upload']);
  });

  test.each([['2026/11/11'], ['2026-02-30'], ['']])(
    'ローンチ日「%s」は業務日付の形式でないためvalidation_errorにする',
    async (launchDate) => {
      stubExternalServices();
      const token = await insertAlice();

      const response = await register(token, newFields(), launchDate);

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(detailsOf(response)).toEqual([
        {
          field: 'input.launchDate',
          code: 'custom',
          message: 'ローンチ日を選んでください。',
        },
      ]);
    },
  );

  test('未ログインの登録は、bot判定を使わずunauthenticatedで拒否する', async () => {
    const calls = stubExternalServices();
    await insertAlice();

    const response = await registerProduct(
      { fields: newFields(), launchDate: EARLIEST_LAUNCH_DATE },
      { botToken: SAVE_BOT_TOKEN },
    );

    expect(codesOf(response)).toEqual(['unauthenticated']);
    expect(calls.siteverifyTokens).toEqual([]);
  });

  test('メールアドレスを確認していない利用者の登録は、bot判定を使わずemail_not_verifiedで拒否する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice({ emailVerifiedAt: null });
    await insertAliceImages();

    const response = await register(token);

    expect(codesOf(response)).toEqual(['email_not_verified']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await countProducts()).toBe(0);
  });

  test('停止中の利用者の登録は、bot判定を使わずaccount_unavailableで拒否する', async () => {
    const calls = stubExternalServices();
    const token = await insertAlice();
    await insertAliceImages();
    await suspendProductUser(ALICE);

    const response = await register(token);

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(calls.siteverifyTokens).toEqual([]);
    expect(await countProducts()).toBe(0);
  });

  test.each([
    ['トークンが無い', undefined, 'bot_verification_failed'],
    [
      '削除の操作名の判定の結果である',
      DELETE_BOT_TOKEN,
      'bot_verification_failed',
    ],
    [
      '判定サービスに到達できない',
      BOT_UNREACHABLE_TOKEN,
      'bot_verification_unavailable',
    ],
  ])('bot判定の%s場合は登録せずに拒否する', async (_name, botToken, code) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertAliceImages();

    const response = await registerProduct(
      { fields: newFields(), launchDate: EARLIEST_LAUNCH_DATE },
      botToken === undefined
        ? { sessionToken: token }
        : { sessionToken: token, botToken },
    );

    expect(codesOf(response)).toEqual([code]);
    expect(await countProducts()).toBe(0);
  });

  test('使用中のハンドルはhandle_unavailableで拒否し、詳細の欄をinput.fields.handleにする', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertAliceImages();
    await insertOwnedProduct(1, ALICE, { launchDate: '2026-11-20' });

    const response = await register(token, newFields({ handle: 'Product1' }));

    const message =
      'このハンドルは既に使われています。別の文字列を入力してください。';
    expect(codesOf(response)).toEqual(['handle_unavailable']);
    expect(detailsOf(response)).toEqual([
      { field: 'input.fields.handle', code: 'unavailable', message },
    ]);
    expect(await countProducts()).toBe(1);
  });

  test('選べる期間の外のローンチ日はlaunch_date_unavailableで拒否し、選べる日を文言で示して詳細の欄をinput.launchDateにする', async () => {
    stubExternalServices();
    const token = await insertAlice();
    await insertAliceImages();

    const response = await register(token, newFields(), '2027-02-09');

    const message = 'ローンチ日は11月11日〜2027年2月8日の間で選んでください。';
    expect(codesOf(response)).toEqual(['launch_date_unavailable']);
    expect(response.errors?.[0]?.message).toBe(message);
    expect(detailsOf(response)).toEqual([
      { field: 'input.launchDate', code: 'out_of_range', message },
    ]);
    expect(await countProducts()).toBe(0);
  });

  test.each([
    [
      '存在しないカテゴリ',
      { categoryId: categoryIdOf(99) },
      'category_not_found',
    ],
    [
      '他の利用者の画像',
      { logoFileId: fileIdOf(BOB_LOGO_FILE) },
      'invalid_upload',
    ],
  ])('%sは登録せずに拒否する', async (_name, overrides, code) => {
    stubExternalServices();
    const token = await insertAlice();
    await insertAliceImages();
    await insertUser(BOB, { handle: 'bob', emailVerifiedAt: T0 });
    await insertFile(BOB_LOGO_FILE, {
      purpose: PRODUCT_LOGO_PURPOSE,
      ownerId: userIdOf(BOB),
    });

    const response = await register(token, newFields(overrides));

    expect(codesOf(response)).toEqual([code]);
    expect(await countProducts()).toBe(0);
  });
});
