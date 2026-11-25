import { describe, expect, test } from 'bun:test';

import {
  ADMIN_COMMENTS_ARGS,
  ADMIN_PRODUCT_ARGS,
  ADMIN_PRODUCT_RATINGS_ARGS,
  ADMIN_PRODUCTS_ARGS,
  ADMIN_QUARANTINED_IMAGES_ARGS,
  ADMIN_RATINGS_ARGS,
  ADMIN_USERS_ARGS,
  ADMINISTRATIVE_WITHDRAWAL_ARGS,
  COMMENT_MODERATION_ARGS,
  IMAGE_MODERATION_ARGS,
  PRODUCT_MODERATION_ARGS,
  RATING_MODERATION_ARGS,
  USER_MODERATION_ARGS,
} from './inputs.ts';

const USER_ID = '01JC0000000000000000000001';
const PRODUCT_ID = '01JC0000000000000000000002';
const CATEGORY_ID = '01JC0000000000000000000003';
const FILE_ID = '01JC0000000000000000000004';

const PAGE_SIZE_MESSAGE = '表示する件数は1〜50件の整数で指定してください。';
const SEARCH_TERM_MESSAGE = '検索語は100文字以内で入力してください。';
const EMAIL_MESSAGE = 'メールアドレスは254文字以内で入力してください。';
const PERIOD_MESSAGE = '終了日には開始日と同じか後の日付を入力してください。';
const REASON_MESSAGE = '理由は500文字以内で入力してください。';

interface IssueSummary {
  readonly field: string;
  readonly message: string;
}

function issuesOf(result: {
  readonly success: boolean;
  readonly error?: {
    readonly issues: readonly {
      readonly path: readonly PropertyKey[];
      readonly message: string;
    }[];
  };
}): readonly IssueSummary[] {
  return (
    result.error?.issues.map(({ path, message }) => ({
      field: path.map(String).join('.'),
      message,
    })) ?? []
  );
}

const INVALID_IDS = [USER_ID.toLowerCase(), 'not-a-ulid', '', `${USER_ID}0`];

describe('一覧の件数と位置', () => {
  test.each([1, 50])(
    '件数%iを受け付け、位置の省略とnullを未指定にする',
    (first) => {
      expect(ADMIN_USERS_ARGS.parse({ first, after: null })).toEqual({
        filter: {},
        first,
        after: undefined,
      });
      expect(ADMIN_COMMENTS_ARGS.parse({ first })).toEqual({
        filter: {},
        first,
        after: undefined,
      });
    },
  );

  test.each([0, 51, 100, 1.5])(
    '件数%sを、上流の共通の上限(100)でなく1〜50の規則の文言で拒否する',
    (first) => {
      for (const schema of [
        ADMIN_USERS_ARGS,
        ADMIN_PRODUCTS_ARGS,
        ADMIN_COMMENTS_ARGS,
        ADMIN_RATINGS_ARGS,
      ]) {
        expect(issuesOf(schema.safeParse({ first }))).toEqual([
          { field: 'first', message: PAGE_SIZE_MESSAGE },
        ]);
      }
      expect(
        issuesOf(
          ADMIN_PRODUCT_RATINGS_ARGS.safeParse({
            productId: PRODUCT_ID,
            first,
          }),
        ),
      ).toEqual([{ field: 'first', message: PAGE_SIZE_MESSAGE }]);
    },
  );

  test('位置の文字列は検証せずに上流へ中継する(不正な位置は上流がinvalid_cursorにする)', () => {
    expect(ADMIN_USERS_ARGS.parse({ first: 50, after: 'broken' }).after).toBe(
      'broken',
    );
    expect(
      ADMIN_QUARANTINED_IMAGES_ARGS.parse({ reason: 'AUTO', after: 'broken' }),
    ).toEqual({ reason: 'auto', after: 'broken' });
  });
});

describe('ユーザーの一覧の絞り込み', () => {
  test('検索語とメールアドレスの前後の空白を除き、停止状態を上流の値へ写す', () => {
    expect(
      ADMIN_USERS_ARGS.parse({
        filter: {
          handle: '  pitch  ',
          nickname: '　ニック　',
          email: ' user@example.example ',
          status: 'SUSPENDED',
        },
        first: 50,
      }).filter,
    ).toEqual({
      handle: 'pitch',
      nickname: 'ニック',
      email: 'user@example.example',
      status: 'suspended',
    });
  });

  test('空白だけの検索語・メールアドレスとnullは未指定にする', () => {
    expect(
      ADMIN_USERS_ARGS.parse({
        filter: { handle: '   ', nickname: null, email: '', status: null },
        first: 50,
      }).filter,
    ).toEqual({});
  });

  test('前後の空白を除いて100書記素の検索語を受け付け、101書記素を拒否する', () => {
    const term = '👨‍👩‍👧'.repeat(100);

    expect(
      ADMIN_USERS_ARGS.parse({ filter: { handle: ` ${term} ` }, first: 50 })
        .filter,
    ).toEqual({ handle: term });
    expect(
      issuesOf(
        ADMIN_USERS_ARGS.safeParse({
          filter: { nickname: `${term}あ` },
          first: 50,
        }),
      ),
    ).toEqual([{ field: 'filter.nickname', message: SEARCH_TERM_MESSAGE }]);
  });

  test('前後の空白を除いて254文字のメールアドレスを受け付け、255文字を拒否する', () => {
    const local = 'a'.repeat(254 - '@example.example'.length);

    expect(
      ADMIN_USERS_ARGS.parse({
        filter: { email: ` ${local}@example.example ` },
        first: 50,
      }).filter,
    ).toEqual({ email: `${local}@example.example` });
    expect(
      issuesOf(
        ADMIN_USERS_ARGS.safeParse({
          filter: { email: `${local}a@example.example` },
          first: 50,
        }),
      ),
    ).toEqual([{ field: 'filter.email', message: EMAIL_MESSAGE }]);
  });
});

describe('プロダクトの一覧の絞り込みと詳細', () => {
  test('検索語の空白を除き、カテゴリのID・ローンチ状態・公開状態を上流の値へ写す', () => {
    expect(
      ADMIN_PRODUCTS_ARGS.parse({
        filter: {
          name: ' ノート ',
          handle: 'notes',
          ownerHandle: ' owner ',
          categoryId: CATEGORY_ID,
          launchState: 'IN_PROGRESS',
          visibility: 'OWNER_SUSPENDED',
        },
        first: 20,
        after: 'cursor',
      }),
    ).toEqual({
      filter: {
        name: 'ノート',
        handle: 'notes',
        ownerHandle: 'owner',
        categoryId: CATEGORY_ID,
        launchState: 'in_progress',
        visibility: 'owner_suspended',
      },
      first: 20,
      after: 'cursor',
    });
  });

  test.each(INVALID_IDS)(
    '形式の違うカテゴリのID(%s)を、存在しないカテゴリと同じ文言の1件で拒否する',
    (categoryId) => {
      expect(
        issuesOf(
          ADMIN_PRODUCTS_ARGS.safeParse({ filter: { categoryId }, first: 50 }),
        ),
      ).toEqual([
        {
          field: 'filter.categoryId',
          message: 'カテゴリをもう一度選択してください。',
        },
      ]);
    },
  );

  test.each(INVALID_IDS)(
    '形式の違うプロダクトのID(%s)を、存在しないプロダクトと同じ文言の1件で拒否する',
    (id) => {
      const message = 'プロダクトが見つかりません。';

      expect(issuesOf(ADMIN_PRODUCT_ARGS.safeParse({ id }))).toEqual([
        { field: 'id', message },
      ]);
      expect(
        issuesOf(
          ADMIN_PRODUCT_RATINGS_ARGS.safeParse({ productId: id, first: 50 }),
        ),
      ).toEqual([{ field: 'productId', message }]);
    },
  );
});

describe('コメントと評価の一覧の絞り込み', () => {
  test('投稿日の期間を日時へ写し、状態を上流の値へ写す', () => {
    const from = Date.parse('2026-11-01T00:00:00.000Z');
    const before = Date.parse('2026-11-02T00:00:00.000Z');

    expect(
      ADMIN_COMMENTS_ARGS.parse({
        filter: {
          authorHandle: ' author ',
          productHandle: 'notes',
          postedFrom: from,
          postedBefore: before,
          state: 'AUTHOR_UNAVAILABLE',
        },
        first: 50,
      }).filter,
    ).toEqual({
      authorHandle: 'author',
      productHandle: 'notes',
      postedFrom: new Date(from),
      postedBefore: new Date(before),
      state: 'author_unavailable',
    });
    expect(
      ADMIN_RATINGS_ARGS.parse({
        filter: {
          productHandle: 'notes',
          raterHandle: ' rater ',
          state: 'INVALIDATED',
        },
        first: 50,
      }).filter,
    ).toEqual({
      productHandle: 'notes',
      raterHandle: 'rater',
      state: 'invalidated',
    });
  });

  test.each([0, -1])(
    '期間の終わりが始まりより%iミリ秒後(後でない)なら、終わりの欄に逆順の文言で拒否する',
    (offset) => {
      const from = Date.parse('2026-11-02T00:00:00.000Z');

      expect(
        issuesOf(
          ADMIN_COMMENTS_ARGS.safeParse({
            filter: { postedFrom: from, postedBefore: from + offset },
            first: 50,
          }),
        ),
      ).toEqual([{ field: 'filter.postedBefore', message: PERIOD_MESSAGE }]);
    },
  );

  test('期間の片方だけの指定と、検索語の上限の超過の欄を確かめる', () => {
    const from = Date.parse('2026-11-02T00:00:00.000Z');

    expect(
      ADMIN_COMMENTS_ARGS.parse({ filter: { postedFrom: from }, first: 50 })
        .filter,
    ).toEqual({ postedFrom: new Date(from) });
    expect(
      issuesOf(
        ADMIN_RATINGS_ARGS.safeParse({
          filter: { raterHandle: 'a'.repeat(101) },
          first: 50,
        }),
      ),
    ).toEqual([{ field: 'filter.raterHandle', message: SEARCH_TERM_MESSAGE }]);
  });
});

describe('隔離画像の一覧', () => {
  test.each([
    ['AUTO', 'auto'],
    ['PRODUCT_HIDDEN', 'product_hidden'],
    ['USER_SUSPENDED', 'user_suspended'],
    ['ADMIN_ACTION', 'admin_action'],
  ] as const)('隔離理由%sを上流の値%sへ写す', (reason, expected) => {
    expect(ADMIN_QUARANTINED_IMAGES_ARGS.parse({ reason })).toEqual({
      reason: expected,
      after: undefined,
    });
  });
});

describe('措置の引数', () => {
  const REQUIRED_REASON_ARGS = [
    ['利用者', USER_MODERATION_ARGS, '利用者が見つかりません。'],
    ['プロダクト', PRODUCT_MODERATION_ARGS, 'プロダクトが見つかりません。'],
    [
      'コメント',
      COMMENT_MODERATION_ARGS,
      'コメントが見つかりません。削除された可能性があります。',
    ],
    ['評価', RATING_MODERATION_ARGS, '評価が見つかりません。'],
  ] as const;

  test.each(REQUIRED_REASON_ARGS)(
    '%sの措置は、理由の要否をユースケースに任せて理由をそのまま渡す',
    (_name, schema) => {
      expect(schema.parse({ id: USER_ID, reason: '  ' })).toEqual({
        id: USER_ID,
        reason: '  ',
      });
    },
  );

  test.each(REQUIRED_REASON_ARGS)(
    '%sの措置の形式の違うIDを、存在しない対象と同じ文言の1件で拒否する',
    (_name, schema, message) => {
      for (const id of INVALID_IDS) {
        expect(issuesOf(schema.safeParse({ id, reason: '理由' }))).toEqual([
          { field: 'id', message },
        ]);
      }
    },
  );

  test.each(REQUIRED_REASON_ARGS)(
    '%sの措置の理由は、前後の空白を除いて500書記素までを受け付け、501書記素を拒否する',
    (_name, schema) => {
      const reason = '👍🏽'.repeat(500);

      expect(
        schema.safeParse({ id: USER_ID, reason: ` ${reason} ` }).success,
      ).toBe(true);
      expect(
        issuesOf(schema.safeParse({ id: USER_ID, reason: `${reason}あ` })),
      ).toEqual([{ field: 'reason', message: REASON_MESSAGE }]);
    },
  );

  test('代理の退会は入力の利用者のIDと理由を検証する', () => {
    expect(
      ADMINISTRATIVE_WITHDRAWAL_ARGS.parse({
        input: { userId: USER_ID, reason: '本人の依頼' },
      }),
    ).toEqual({ input: { userId: USER_ID, reason: '本人の依頼' } });
    expect(
      issuesOf(
        ADMINISTRATIVE_WITHDRAWAL_ARGS.safeParse({
          input: { userId: 'user-1', reason: 'あ'.repeat(501) },
        }),
      ),
    ).toEqual([
      { field: 'input.userId', message: '利用者が見つかりません。' },
      { field: 'input.reason', message: REASON_MESSAGE },
    ]);
  });

  test('画像の操作は理由の省略とnullを未指定にし、上限だけを確かめる', () => {
    expect(IMAGE_MODERATION_ARGS.parse({ fileId: FILE_ID })).toEqual({
      fileId: FILE_ID,
      reason: undefined,
    });
    expect(
      IMAGE_MODERATION_ARGS.parse({ fileId: FILE_ID, reason: null }),
    ).toEqual({ fileId: FILE_ID, reason: undefined });
    expect(
      issuesOf(
        IMAGE_MODERATION_ARGS.safeParse({
          fileId: FILE_ID,
          reason: 'あ'.repeat(501),
        }),
      ),
    ).toEqual([{ field: 'reason', message: REASON_MESSAGE }]);
  });

  test.each(INVALID_IDS)(
    '画像の操作の形式の違うファイルのID(%s)を、存在しない画像と同じ文言の1件で拒否する',
    (fileId) => {
      expect(issuesOf(IMAGE_MODERATION_ARGS.safeParse({ fileId }))).toEqual([
        { field: 'fileId', message: '画像が見つかりません。' },
      ]);
    },
  );
});
