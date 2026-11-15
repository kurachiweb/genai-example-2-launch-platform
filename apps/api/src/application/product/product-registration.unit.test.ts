import { describe, expect, test } from 'bun:test';

import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
  PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES,
} from '../../../common-lib/product/product-input-rules.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  CATEGORY_ID,
  createFakeProductMedia,
  createFakeProductStore,
  createFakeStateEvaluator,
  createSequentialIds,
  currentUserOf,
  type FakeProductMediaOptions,
  type FakeProductStoreOptions,
  fixedClock,
  imageFileOf,
  LOGO_FILE_ID,
  PRODUCT_NOW,
  SCREENSHOT_FILE_IDS,
  stateOf,
  USER_ID,
} from './testing/product-fakes.ts';
import {
  type ProductRegistrationInput,
  StoreProductRegistration,
} from './product-registration.ts';

const day = (value: string): BusinessDate => parseBusinessDate(value);

const inputOf = (
  overrides: Partial<ProductRegistrationInput> = {},
): ProductRegistrationInput => ({
  name: 'ローンチ計測',
  tagline: '公開の反応をまとめて見る',
  categoryId: CATEGORY_ID,
  handle: 'launch-meter',
  websiteUrl: 'https://launch-meter.example/',
  descriptionMarkdown: '# 概要',
  logoFileId: LOGO_FILE_ID,
  screenshotFileIds: [...SCREENSHOT_FILE_IDS],
  launchDate: day('2026-10-24'),
  ...overrides,
});

const DEFAULT_FILES = [
  imageFileOf(LOGO_FILE_ID, PRODUCT_LOGO_PURPOSE, 1000),
  ...SCREENSHOT_FILE_IDS.map((id) =>
    imageFileOf(id, PRODUCT_SCREENSHOT_PURPOSE, 2000),
  ),
];

function setup(
  storeOptions: FakeProductStoreOptions = {},
  mediaOptions: FakeProductMediaOptions = { files: DEFAULT_FILES },
) {
  const calls: string[] = [];
  const store = createFakeProductStore(calls, storeOptions);
  const fakeMedia = createFakeProductMedia(calls, mediaOptions);
  const fakeEvaluator = createFakeStateEvaluator(calls);
  const registration = new StoreProductRegistration(
    store,
    fakeEvaluator.evaluator,
    fakeMedia.media,
    fixedClock,
    createSequentialIds(),
  );
  return { registration, store, calls, ...fakeMedia, ...fakeEvaluator };
}

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

const generatedIdOf = (index: number): string =>
  `01JD0ID${String(index).padStart(19, '0')}`;

const screenshotIdsOf = (count: number): readonly string[] =>
  Array.from(
    { length: count },
    (_, index) => `01JC0SHOT${String(index).padStart(17, '0')}`,
  );

describe('ProductRegistration.register', () => {
  test('カテゴリ→使用中→画像の紐付けと合計→保存の順に進め、登録したプロダクトを状態付きで返す', async () => {
    const { registration, calls, requests } = setup();

    const view = await registration.register(currentUserOf(), inputOf());

    expect(calls).toEqual([
      'store.categoryExists',
      'store.isHandleOccupied',
      `media.claim:${PRODUCT_LOGO_PURPOSE}`,
      `media.claim:${PRODUCT_SCREENSHOT_PURPOSE}`,
      'media.findMany',
      'store.insert',
      'store.findForOwner',
      'evaluator.evaluate',
    ]);
    expect(view).toMatchObject({
      handle: 'launch-meter',
      name: 'ローンチ計測',
      logoFileId: LOGO_FILE_ID,
      screenshotFileIds: SCREENSHOT_FILE_IDS,
      hidden: false,
      listed: false,
      version: 0,
    });
    expect(view.state).toEqual(stateOf(view.productId));
    expect(requests).toEqual([
      {
        ownerUserId: USER_ID,
        products: [
          {
            productId: view.productId,
            hidden: false,
            launches: [expect.objectContaining({ launchDate: '2026-10-24' })],
          },
        ],
        at: PRODUCT_NOW,
      },
    ]);
    expect(view).not.toHaveProperty('ownerUserId');
    expect(view).not.toHaveProperty('launches');
  });

  test('保存には採番したプロダクト・最初のローンチ・スクリーンショットの行のIDと、投稿者・入力・ローンチ日・現在の時刻を渡す', async () => {
    const { registration, store } = setup();

    await registration.register(currentUserOf(), inputOf());

    expect(store.inserts).toHaveLength(1);
    expect(store.inserts[0]).toEqual({
      productId: generatedIdOf(1),
      launchId: generatedIdOf(2),
      ownerUserId: USER_ID,
      fields: {
        name: 'ローンチ計測',
        tagline: '公開の反応をまとめて見る',
        categoryId: CATEGORY_ID,
        handle: 'launch-meter',
        websiteUrl: 'https://launch-meter.example/',
        descriptionMarkdown: '# 概要',
        logoFileId: LOGO_FILE_ID,
        screenshotFileIds: SCREENSHOT_FILE_IDS,
      },
      launchDate: day('2026-10-24'),
      screenshotIds: [generatedIdOf(3), generatedIdOf(4)],
      now: PRODUCT_NOW,
    });
  });

  test('ロゴとスクリーンショットを、それぞれの用途で本人の画像として紐付け、スクリーンショットのバイト数を引く', async () => {
    const { registration, claims, lookups } = setup();

    await registration.register(currentUserOf(), inputOf());

    expect(claims).toEqual([
      {
        fileIds: [LOGO_FILE_ID],
        purpose: 'product-logo',
        owner: { kind: 'user', id: USER_ID },
      },
      {
        fileIds: SCREENSHOT_FILE_IDS,
        purpose: 'product-screenshot',
        owner: { kind: 'user', id: USER_ID },
      },
    ]);
    expect(lookups).toEqual([SCREENSHOT_FILE_IDS]);
  });

  test('スクリーンショットが無ければ、ロゴだけを紐付けてバイト数を引かない', async () => {
    const { registration, calls } = setup();

    const view = await registration.register(
      currentUserOf(),
      inputOf({ screenshotFileIds: [] }),
    );

    expect(calls).not.toContain(`media.claim:${PRODUCT_SCREENSHOT_PURPOSE}`);
    expect(calls).not.toContain('media.findMany');
    expect(view.screenshotFileIds).toEqual([]);
  });

  test('存在しないカテゴリはcategory_not_foundで拒否し、以降の判定と保存をしない', async () => {
    const { registration, calls } = setup({ categoryIds: [] });

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf()),
    );

    expect(error.code).toBe('category_not_found');
    expect(calls).toEqual(['store.categoryExists']);
  });

  test.each(['admin', 'Official', 'LAUNCH-STADIUM'])(
    '予約語のハンドル(%s)は、使用中を問い合わせずにhandle_unavailableで拒否する',
    async (handle) => {
      const { registration, calls } = setup();

      const error = await rejectionOf(
        registration.register(currentUserOf(), inputOf({ handle })),
      );

      expect(error.code).toBe('handle_unavailable');
      expect(error.details).toEqual([
        expect.objectContaining({ field: 'handle' }),
      ]);
      expect(calls).toEqual(['store.categoryExists']);
    },
  );

  test('他のプロダクトが使用中のハンドルはhandle_unavailableで拒否し、画像を紐付けない', async () => {
    const { registration, calls } = setup({
      occupiedHandles: ['Launch-Meter'],
    });

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf()),
    );

    expect(error.code).toBe('handle_unavailable');
    expect(calls).toEqual(['store.categoryExists', 'store.isHandleOccupied']);
  });

  test.each([
    [
      '今日',
      '2026-10-23',
      'pairing_deadline',
      'ローンチ日は10月24日〜2027年1月21日の間で選んでください。',
    ],
    [
      '91日後',
      '2027-01-22',
      'out_of_range',
      'ローンチ日は10月24日〜2027年1月21日の間で選んでください。',
    ],
  ] as const)(
    '%sのローンチ日はlaunch_date_unavailableで選べる最も早い日と最も遅い日を示し、画像を紐付けない',
    async (_label, launchDate, reason, message) => {
      const { registration, calls } = setup();

      const error = await rejectionOf(
        registration.register(
          currentUserOf(),
          inputOf({ launchDate: day(launchDate) }),
        ),
      );

      expect(error.code).toBe('launch_date_unavailable');
      expect(error.kind).toBe('unprocessable');
      expect(error.message).toBe(message);
      expect(error.details).toEqual([
        { field: 'launchDate', code: reason, message },
      ]);
      expect(calls).toEqual(['store.categoryExists', 'store.isHandleOccupied']);
    },
  );

  test.each(['2026-10-24', '2027-01-21'])(
    '選べる期間の端の日(%s)は登録できる',
    async (launchDate) => {
      const { registration, store } = setup();

      await registration.register(
        currentUserOf(),
        inputOf({ launchDate: day(launchDate) }),
      );

      expect(store.inserts[0]?.launchDate).toBe(day(launchDate));
    },
  );

  test('ロゴを紐付けられなければinvalid_uploadで拒否し、スクリーンショットを紐付けず保存しない', async () => {
    const { registration, calls } = setup(
      {},
      {
        files: DEFAULT_FILES,
        claimResults: {
          [PRODUCT_LOGO_PURPOSE]: {
            ok: false,
            failures: [{ fileId: LOGO_FILE_ID, reason: 'owner_mismatch' }],
          },
        },
      },
    );

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf()),
    );

    expect(error.code).toBe('invalid_upload');
    expect(calls.at(-1)).toBe(`media.claim:${PRODUCT_LOGO_PURPOSE}`);
    expect(calls).not.toContain('store.insert');
  });

  test('スクリーンショットを紐付けられなければinvalid_uploadで拒否し、保存しない', async () => {
    const { registration, calls } = setup(
      {},
      {
        files: DEFAULT_FILES,
        claimResults: {
          [PRODUCT_SCREENSHOT_PURPOSE]: {
            ok: false,
            failures: [
              { fileId: SCREENSHOT_FILE_IDS[0], reason: 'purpose_mismatch' },
            ],
          },
        },
      },
    );

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf()),
    );

    expect(error.code).toBe('invalid_upload');
    expect(calls.at(-1)).toBe(`media.claim:${PRODUCT_SCREENSHOT_PURPOSE}`);
    expect(calls).not.toContain('store.insert');
  });

  test('紐付けた後にスクリーンショットの記録を引けなければinvalid_uploadで拒否し、保存しない', async () => {
    const { registration, calls } = setup(
      {},
      { files: DEFAULT_FILES.slice(0, 2) },
    );

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf()),
    );

    expect(error.code).toBe('invalid_upload');
    expect(calls).not.toContain('store.insert');
  });

  test('21枚のスクリーンショットはscreenshot_limit_exceededで拒否し、保存しない', async () => {
    const screenshotFileIds = screenshotIdsOf(21);
    const { registration, calls } = setup(
      {},
      {
        files: screenshotFileIds.map((id) =>
          imageFileOf(id, PRODUCT_SCREENSHOT_PURPOSE, 1),
        ),
      },
    );

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf({ screenshotFileIds })),
    );

    expect(error.code).toBe('screenshot_limit_exceeded');
    expect(calls).not.toContain('store.insert');
  });

  test('スクリーンショットの合計が10,485,761バイトならscreenshot_limit_exceededで拒否し、10,485,760バイトなら登録する', async () => {
    const [first, second] = SCREENSHOT_FILE_IDS;
    const filesOf = (secondSize: number) => [
      imageFileOf(first, PRODUCT_SCREENSHOT_PURPOSE, 5_242_880),
      imageFileOf(second, PRODUCT_SCREENSHOT_PURPOSE, secondSize),
    ];
    const over = setup(
      {},
      {
        files: filesOf(PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES - 5_242_880 + 1),
      },
    );
    const limit = setup(
      {},
      { files: filesOf(PRODUCT_SCREENSHOTS_TOTAL_MAX_BYTES - 5_242_880) },
    );

    const error = await rejectionOf(
      over.registration.register(currentUserOf(), inputOf()),
    );
    await limit.registration.register(currentUserOf(), inputOf());

    expect(error.code).toBe('screenshot_limit_exceeded');
    expect(over.calls).not.toContain('store.insert');
    expect(limit.store.inserts).toHaveLength(1);
  });

  test.each([
    ['handle-unavailable', 'handle_unavailable', 'conflict'],
    ['account-unavailable', 'account_unavailable', 'forbidden'],
  ] as const)(
    '保存の結果が%sなら%sを投げ、読み直さない',
    async (insertResult, code, kind) => {
      const { registration, calls } = setup({ insertResult });

      const error = await rejectionOf(
        registration.register(currentUserOf(), inputOf()),
      );

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(calls.at(-1)).toBe('store.insert');
    },
  );

  test('保存の後に登録したプロダクトを読めなければproduct_not_foundを投げる', async () => {
    const { registration, calls } = setup({ forgetsInserted: true });

    const error = await rejectionOf(
      registration.register(currentUserOf(), inputOf()),
    );

    expect(error.code).toBe('product_not_found');
    expect(calls.at(-1)).toBe('store.findForOwner');
  });
});
