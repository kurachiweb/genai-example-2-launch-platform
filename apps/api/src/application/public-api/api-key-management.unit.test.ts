import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  type ApiKeyFeature,
  DEFAULT_ISSUE_SCOPES,
} from '../../../common-lib/public-api/api-key-rules.ts';
import {
  AppError,
  STATUS_BY_KIND,
} from '../../../lib/core/errors/app-error.ts';
import { encodeCursor } from '../../../lib/core/pagination/opaque-cursor.ts';
import {
  type ApiKeyInput,
  type ApiKeyManagement,
  StoreApiKeyManagement,
} from './api-key-management.ts';
import {
  createFakeApiKeyStore,
  createFakeRateLimits,
  createFakeSecretGenerator,
  createSequentialIds,
  currentUserOf,
  type FakeApiKeyStore,
  type FakeRateLimits,
  type FakeSecretGenerator,
  generatedPlainOf,
  generatedSequenceOf,
  ISSUE_LIMIT,
  newKeyIdOf,
  OTHER_USER_ID,
  READ_WRITE_SCOPES,
  RETRY_AFTER_SECONDS,
  type StoredKey,
  storedKeyOf,
  UNAVAILABLE_USER_ID,
  USER_ID,
} from './testing/api-key-management-fakes.ts';

const NOW = new Date('2026-11-20T03:00:00.000Z');

const MISSING_KEY_ID = '01JC0APKEYZZZZZZZZZZZZZZZZ';

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const NAME_REQUIRED = {
  field: 'name',
  code: 'required',
  message: '名前を入力してください。',
};

const NAME_TOO_LONG = {
  field: 'name',
  code: 'too_long',
  message: '名前は50文字以内で入力してください。',
};

const scopeNotAllowed = (feature: ApiKeyFeature) => ({
  field: `scopes.${feature}`,
  code: 'not_allowed',
  message: '選べない権限が指定されています。',
});

const NOT_FOUND = {
  kind: 'not_found',
  status: 404,
  code: 'api_key_not_found',
  message: 'APIキーが見つかりません。',
};

const ACCOUNT_UNAVAILABLE = {
  kind: 'forbidden',
  status: 403,
  code: 'account_unavailable',
  message:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
};

const KEY_LOG_CATEGORY = ['api', 'public-api', 'key'];

interface Harness {
  readonly management: ApiKeyManagement;
  readonly store: FakeApiKeyStore;
  readonly generator: FakeSecretGenerator;
  readonly rateLimits: FakeRateLimits;
}

function createHarness(initial: readonly StoredKey[] = []): Harness {
  const store = createFakeApiKeyStore(initial);
  const generator = createFakeSecretGenerator();
  const rateLimits = createFakeRateLimits();
  return {
    management: new StoreApiKeyManagement(
      store,
      generator,
      rateLimits,
      createSequentialIds(),
    ),
    store,
    generator,
    rateLimits,
  };
}

const inputOf = (
  overrides: Partial<{
    readonly name: string;
    readonly scopes: Partial<Record<ApiKeyFeature, string>>;
  }> = {},
): ApiKeyInput => ({
  name: overrides.name ?? '  集計ツール  ',
  scopes: { ...DEFAULT_ISSUE_SCOPES, ...overrides.scopes },
});

async function captureError(action: () => Promise<unknown>): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が投げられなかった');
}

const summaryOf = (error: AppError): Readonly<Record<string, unknown>> => ({
  kind: error.kind,
  status: STATUS_BY_KIND[error.kind],
  code: error.code,
  message: error.message,
});

let logs: LogRecord[] = [];

beforeEach(() => {
  logs = [];
  configureSync({
    reset: true,
    sinks: { memory: (record) => logs.push(record) },
    loggers: [
      { category: ['api'], sinks: ['memory'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('StoreApiKeyManagement.issue', () => {
  test('前後の空白を除いた名前と権限スコープで、乱数のハッシュだけを保存し、平文を応答でだけ返す', async () => {
    const { management, store, generator } = createHarness();

    const issued = await management.issue(currentUserOf(), inputOf(), NOW);

    expect(generator.generated).toStrictEqual([generatedPlainOf(1)]);
    expect(issued).toStrictEqual({
      apiKey: {
        id: newKeyIdOf(1),
        name: '集計ツール',
        scopes: DEFAULT_ISSUE_SCOPES,
        createdAt: NOW,
      },
      plainKey: generatedPlainOf(1),
    });
    expect(store.inserted).toStrictEqual([
      {
        id: newKeyIdOf(1),
        userId: USER_ID,
        name: '集計ツール',
        keyHash: `hash-of-${generatedSequenceOf(1)}`,
        scopes: DEFAULT_ISSUE_SCOPES,
        at: NOW,
      },
    ]);
    expect(JSON.stringify(store.inserted)).not.toContain(generatedPlainOf(1));
  });

  test('空白だけの名前は未入力の項目の誤りにし、回数を消費せず保存しない', async () => {
    const { management, store, rateLimits } = createHarness();

    const error = await captureError(() =>
      management.issue(currentUserOf(), inputOf({ name: ' 　 ' }), NOW),
    );

    expect(summaryOf(error)).toStrictEqual({
      kind: 'bad_request',
      status: 400,
      code: 'validation_error',
      message: VALIDATION_MESSAGE,
    });
    expect(error.details).toStrictEqual([NAME_REQUIRED]);
    expect(rateLimits.issueCalls).toHaveLength(0);
    expect(store.inserted).toHaveLength(0);
  });

  test('前後の空白を除いて50文字(書記素)の名前は受け付け、51文字は文字数超過の項目の誤りにする', async () => {
    const { management } = createHarness();
    const family = '👨‍👩‍👧';

    const issued = await management.issue(
      currentUserOf(),
      inputOf({ name: ` ${family.repeat(50)} ` }),
      NOW,
    );
    const error = await captureError(() =>
      management.issue(
        currentUserOf(),
        inputOf({ name: family.repeat(51) }),
        NOW,
      ),
    );

    expect(issued.apiKey.name).toBe(family.repeat(50));
    expect(error.details).toStrictEqual([NAME_TOO_LONG]);
  });

  test('機能ごとに許されない権限スコープを項目ごとの誤りにし、名前の誤りと合わせて返す', async () => {
    const { management, rateLimits, store } = createHarness();

    const error = await captureError(() =>
      management.issue(
        currentUserOf(),
        inputOf({
          name: '',
          scopes: { products: 'read_write', ratings: 'write', profile: 'READ' },
        }),
        NOW,
      ),
    );

    expect(error.code).toBe('validation_error');
    expect(error.details).toStrictEqual([
      NAME_REQUIRED,
      scopeNotAllowed('products'),
      scopeNotAllowed('ratings'),
      scopeNotAllowed('profile'),
    ]);
    expect(rateLimits.issueCalls).toHaveLength(0);
    expect(store.inserted).toHaveLength(0);
  });

  test('「プロフィール」「プロダクトの説明文」の読み書きを受け付ける', async () => {
    const { management } = createHarness();

    const issued = await management.issue(
      currentUserOf(),
      inputOf({ scopes: READ_WRITE_SCOPES }),
      NOW,
    );

    expect(issued.apiKey.scopes).toStrictEqual(READ_WRITE_SCOPES);
  });

  test('回数の制限を乱数の生成と保存より先に掛け、4回目は429にして生成も保存もしない', async () => {
    const { management, store, generator, rateLimits } = createHarness();
    for (let count = 0; count < ISSUE_LIMIT; count += 1) {
      await management.issue(currentUserOf(), inputOf(), NOW);
    }

    const error = await captureError(() =>
      management.issue(currentUserOf(), inputOf(), NOW),
    );

    expect(error.code).toBe('rate_limit_exceeded');
    expect(STATUS_BY_KIND[error.kind]).toBe(429);
    expect(error.retryAfterSeconds).toBe(RETRY_AFTER_SECONDS);
    expect(rateLimits.issueCalls).toStrictEqual(
      Array.from({ length: ISSUE_LIMIT + 1 }, () => ({
        userId: USER_ID,
        now: NOW,
      })),
    );
    expect(generator.generated).toHaveLength(ISSUE_LIMIT);
    expect(store.inserted).toHaveLength(ISSUE_LIMIT);
  });

  test('保存の時点で停止中・退会済みならアカウントを利用できない旨にし、記録しない', async () => {
    const { management, store } = createHarness();

    const error = await captureError(() =>
      management.issue(currentUserOf(UNAVAILABLE_USER_ID), inputOf(), NOW),
    );

    expect(summaryOf(error)).toStrictEqual(ACCOUNT_UNAVAILABLE);
    expect(store.rows).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  test('発行をキーのIDと利用者のIDだけでinfoに記録し、平文と名前を含めない', async () => {
    const { management } = createHarness();

    await management.issue(currentUserOf(), inputOf(), NOW);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.category).toEqual(KEY_LOG_CATEGORY);
    expect(logs[0]?.properties).toStrictEqual({
      recordId: newKeyIdOf(1),
      userId: USER_ID,
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(generatedPlainOf(1));
    expect(serialized).not.toContain(generatedSequenceOf(1));
    expect(serialized).not.toContain('集計ツール');
  });
});

describe('StoreApiKeyManagement.update', () => {
  test('名前と権限スコープを検証して保存し、発行日時を保ったキーを返す。回数に数えず記録もしない', async () => {
    const original = storedKeyOf();
    const { management, store, rateLimits } = createHarness([original]);

    const updated = await management.update(
      currentUserOf(),
      original.id,
      inputOf({ name: ' 新しい名前 ' }),
      NOW,
    );

    expect(updated).toStrictEqual({
      id: original.id,
      name: '新しい名前',
      scopes: DEFAULT_ISSUE_SCOPES,
      createdAt: original.createdAt,
    });
    expect(store.rows).toStrictEqual([
      { ...original, name: '新しい名前', scopes: DEFAULT_ISSUE_SCOPES },
    ]);
    expect(rateLimits.issueCalls).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  test('発行と同じ規則の項目ごとの誤りにして保存しない', async () => {
    const original = storedKeyOf();
    const { management, store } = createHarness([original]);

    const error = await captureError(() =>
      management.update(
        currentUserOf(),
        original.id,
        inputOf({ name: 'あ'.repeat(51), scopes: { comments: 'read_write' } }),
        NOW,
      ),
    );

    expect(error.code).toBe('validation_error');
    expect(error.details).toStrictEqual([
      NAME_TOO_LONG,
      scopeNotAllowed('comments'),
    ]);
    expect(store.rows).toStrictEqual([original]);
  });

  test('他人のキーと存在しないキーを区別せず見つからない旨にする', async () => {
    const others = storedKeyOf({ userId: OTHER_USER_ID });
    const { management, store } = createHarness([others]);

    const othersError = await captureError(() =>
      management.update(currentUserOf(), others.id, inputOf(), NOW),
    );
    const missingError = await captureError(() =>
      management.update(currentUserOf(), MISSING_KEY_ID, inputOf(), NOW),
    );

    expect(summaryOf(othersError)).toStrictEqual(NOT_FOUND);
    expect(summaryOf(missingError)).toStrictEqual(NOT_FOUND);
    expect(store.rows).toStrictEqual([others]);
  });
});

describe('StoreApiKeyManagement.reissue', () => {
  test('元の名前と権限スコープを複写した新しいキーを加えて平文を返し、元のキーを変えない', async () => {
    const original = storedKeyOf();
    const { management, store, rateLimits } = createHarness([original]);

    const issued = await management.reissue(currentUserOf(), original.id, NOW);

    expect(issued).toStrictEqual({
      apiKey: {
        id: newKeyIdOf(1),
        name: original.name,
        scopes: original.scopes,
        createdAt: NOW,
      },
      plainKey: generatedPlainOf(1),
    });
    expect(store.rows).toStrictEqual([
      original,
      {
        id: newKeyIdOf(1),
        userId: USER_ID,
        name: original.name,
        scopes: original.scopes,
        createdAt: NOW,
        keyHash: `hash-of-${generatedSequenceOf(1)}`,
      },
    ]);
    expect(rateLimits.issueCalls).toStrictEqual([
      { userId: USER_ID, now: NOW },
    ]);
  });

  test('発行と同じ回数に数え、発行3回の後の再発行は429にして生成も保存もしない', async () => {
    const original = storedKeyOf();
    const { management, store, generator } = createHarness([original]);
    for (let count = 0; count < ISSUE_LIMIT; count += 1) {
      await management.issue(currentUserOf(), inputOf(), NOW);
    }

    const error = await captureError(() =>
      management.reissue(currentUserOf(), original.id, NOW),
    );

    expect(error.code).toBe('rate_limit_exceeded');
    expect(STATUS_BY_KIND[error.kind]).toBe(429);
    expect(generator.generated).toHaveLength(ISSUE_LIMIT);
    expect(store.inserted).toHaveLength(ISSUE_LIMIT);
  });

  test('他人のキーと存在しないキーを区別せず見つからない旨にし、回数を消費しない', async () => {
    const others = storedKeyOf({ userId: OTHER_USER_ID });
    const { management, store, rateLimits } = createHarness([others]);

    const othersError = await captureError(() =>
      management.reissue(currentUserOf(), others.id, NOW),
    );
    const missingError = await captureError(() =>
      management.reissue(currentUserOf(), MISSING_KEY_ID, NOW),
    );

    expect(summaryOf(othersError)).toStrictEqual(NOT_FOUND);
    expect(summaryOf(missingError)).toStrictEqual(NOT_FOUND);
    expect(rateLimits.issueCalls).toHaveLength(0);
    expect(store.inserted).toHaveLength(0);
  });

  test('保存の時点で停止中・退会済みならアカウントを利用できない旨にし、記録しない', async () => {
    const original = storedKeyOf({ userId: UNAVAILABLE_USER_ID });
    const { management, store } = createHarness([original]);

    const error = await captureError(() =>
      management.reissue(currentUserOf(UNAVAILABLE_USER_ID), original.id, NOW),
    );

    expect(summaryOf(error)).toStrictEqual(ACCOUNT_UNAVAILABLE);
    expect(store.rows).toStrictEqual([original]);
    expect(logs).toHaveLength(0);
  });

  test('再発行を新しいキーと元のキーのIDと利用者のIDだけでinfoに記録し、平文を含めない', async () => {
    const original = storedKeyOf();
    const { management } = createHarness([original]);

    await management.reissue(currentUserOf(), original.id, NOW);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.category).toEqual(KEY_LOG_CATEGORY);
    expect(logs[0]?.properties).toStrictEqual({
      recordId: newKeyIdOf(1),
      sourceRecordId: original.id,
      userId: USER_ID,
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(generatedPlainOf(1));
    expect(serialized).not.toContain(generatedSequenceOf(1));
  });
});

describe('StoreApiKeyManagement.delete', () => {
  test('自分のキーを削除してキーのIDと利用者のIDだけでinfoに記録し、回数に数えない', async () => {
    const original = storedKeyOf();
    const kept = storedKeyOf({ id: '01JC0APKEY0000000000000002' });
    const { management, store, rateLimits } = createHarness([original, kept]);

    await management.delete(currentUserOf(), original.id);

    expect(store.rows).toStrictEqual([kept]);
    expect(rateLimits.issueCalls).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('info');
    expect(logs[0]?.category).toEqual(KEY_LOG_CATEGORY);
    expect(logs[0]?.properties).toStrictEqual({
      recordId: original.id,
      userId: USER_ID,
    });
  });

  test('他人のキーと存在しないキーを区別せず見つからない旨にし、削除も記録もしない', async () => {
    const others = storedKeyOf({ userId: OTHER_USER_ID });
    const { management, store } = createHarness([others]);

    const othersError = await captureError(() =>
      management.delete(currentUserOf(), others.id),
    );
    const missingError = await captureError(() =>
      management.delete(currentUserOf(), MISSING_KEY_ID),
    );

    expect(summaryOf(othersError)).toStrictEqual(NOT_FOUND);
    expect(summaryOf(missingError)).toStrictEqual(NOT_FOUND);
    expect(store.rows).toStrictEqual([others]);
    expect(logs).toHaveLength(0);
  });
});

describe('StoreApiKeyManagement.list', () => {
  const OLDEST = new Date('2026-11-10T00:00:00.000Z');
  const NEWEST = new Date('2026-11-12T00:00:00.000Z');
  const keys: readonly StoredKey[] = [
    storedKeyOf({ id: '01JC0APKEY0000000000000001', createdAt: OLDEST }),
    storedKeyOf({
      id: '01JC0APKEY0000000000000003',
      name: '同じ時刻の後',
      createdAt: NEWEST,
    }),
    storedKeyOf({
      id: '01JC0APKEY0000000000000002',
      name: '同じ時刻の前',
      createdAt: NEWEST,
    }),
    storedKeyOf({
      id: '01JC0APKEY0000000000000004',
      userId: OTHER_USER_ID,
      createdAt: new Date('2026-11-15T00:00:00.000Z'),
    }),
  ];

  test('自分のキーだけを発行の新しい順に、ハッシュを含まない形で返し、続きのカーソルで残りを返す', async () => {
    const { management } = createHarness(keys);

    const head = await management.list(currentUserOf(), {
      first: 2,
      after: undefined,
    });
    const rest = await management.list(currentUserOf(), {
      first: 2,
      after: head.endCursor ?? undefined,
    });

    expect(head).toStrictEqual({
      nodes: [
        {
          id: '01JC0APKEY0000000000000003',
          name: '同じ時刻の後',
          scopes: READ_WRITE_SCOPES,
          createdAt: NEWEST,
        },
        {
          id: '01JC0APKEY0000000000000002',
          name: '同じ時刻の前',
          scopes: READ_WRITE_SCOPES,
          createdAt: NEWEST,
        },
      ],
      hasNextPage: true,
      endCursor: encodeCursor({
        c: NEWEST.getTime(),
        id: '01JC0APKEY0000000000000002',
      }),
    });
    expect(rest).toStrictEqual({
      nodes: [
        {
          id: '01JC0APKEY0000000000000001',
          name: '既存のキー',
          scopes: READ_WRITE_SCOPES,
          createdAt: OLDEST,
        },
      ],
      hasNextPage: false,
      endCursor: encodeCursor({
        c: OLDEST.getTime(),
        id: '01JC0APKEY0000000000000001',
      }),
    });
  });

  test('キーが無ければ空の一覧と続きの無い位置を返す', async () => {
    const { management } = createHarness();

    const page = await management.list(currentUserOf(), {
      first: 50,
      after: undefined,
    });

    expect(page).toStrictEqual({
      nodes: [],
      hasNextPage: false,
      endCursor: null,
    });
  });

  test.each([
    ['base64urlでない値', '!!!'],
    ['JSONでない値', 'bm90LWpzb24'],
    [
      '位置の形でない値',
      encodeCursor({ t: 1, id: '01JC0APKEY0000000000000001' }),
    ],
    ['小文字のULID', encodeCursor({ c: 1, id: '01jc0apkey0000000000000001' })],
    ['負の時刻', encodeCursor({ c: -1, id: '01JC0APKEY0000000000000001' })],
  ])('不正なカーソル(%s)はinvalid_cursorにする', async (_label, after) => {
    const { management } = createHarness(keys);

    const error = await captureError(() =>
      management.list(currentUserOf(), { first: 10, after }),
    );

    expect(error.code).toBe('invalid_cursor');
    expect(STATUS_BY_KIND[error.kind]).toBe(400);
  });

  test.each([0, 51, 1.5])(
    '件数(%p)が1〜50の整数でなければ呼び出し元の境界の検証漏れとしてRangeErrorにする',
    async (first) => {
      const { management } = createHarness(keys);

      let caught: unknown;
      try {
        await management.list(currentUserOf(), { first, after: undefined });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(RangeError);
    },
  );
});
