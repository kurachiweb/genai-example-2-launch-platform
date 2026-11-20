import { describe, expect, test } from 'bun:test';

import {
  ADMIN_PRODUCT_VISIBILITY_VALUES,
  ADMIN_RATING_STATE_VALUES,
  ADMIN_USER_STATUS_VALUES,
  commentModerationFilterScopeOf,
  commentModerationListArgsOf,
  commentModerationSearchAt,
  MODERATION_SEARCH_TERM_MAX,
  productModerationFilterScopeOf,
  productModerationListArgsOf,
  productModerationSearchAt,
  quarantinedImageListArgsOf,
  ratingModerationFilterScopeOf,
  ratingModerationListArgsOf,
  ratingModerationSearchAt,
  toCommentModerationSearch,
  toProductModerationSearch,
  toQuarantinedImageSearch,
  toRatingModerationSearch,
  toUserModerationSearch,
  userModerationFilterScopeOf,
  userModerationListArgsOf,
  userModerationSearchAt,
} from './moderation-search.ts';

const CATEGORY_ID = '01JC0CATEG0RY0000000000001';

const UNSPECIFIED_USER_SEARCH = {
  handle: undefined,
  nickname: undefined,
  email: undefined,
  status: undefined,
  after: undefined,
};

const UNSPECIFIED_PRODUCT_SEARCH = {
  name: undefined,
  handle: undefined,
  ownerHandle: undefined,
  category: undefined,
  launchState: undefined,
  visibility: undefined,
  after: undefined,
};

const UNSPECIFIED_COMMENT_SEARCH = {
  authorHandle: undefined,
  productHandle: undefined,
  from: undefined,
  to: undefined,
  state: undefined,
  after: undefined,
};

const UNSPECIFIED_RATING_SEARCH = {
  productHandle: undefined,
  raterHandle: undefined,
  state: undefined,
  after: undefined,
};

describe('ユーザーの検索パラメータ', () => {
  test('ハンドル・ニックネーム・メールアドレス・停止状態とページの位置を取り出す', () => {
    expect(
      toUserModerationSearch({
        handle: 'maker_ai',
        nickname: 'サンプル太郎',
        email: 'user@launch.example',
        status: 'suspended',
        after: 'cursor-1',
      }),
    ).toStrictEqual({
      handle: 'maker_ai',
      nickname: 'サンプル太郎',
      email: 'user@launch.example',
      status: 'suspended',
      after: 'cursor-1',
    });
  });

  test.each(ADMIN_USER_STATUS_VALUES)('停止状態%sを受け付ける', (status) => {
    expect(toUserModerationSearch({ status })).toStrictEqual({
      ...UNSPECIFIED_USER_SEARCH,
      status,
    });
  });

  test('前後の空白を除き、空・空白だけの値は未指定にし、知らない項目を落とす', () => {
    expect(
      toUserModerationSearch({
        handle: '  maker_ai　',
        nickname: ' 　',
        email: '',
        after: '',
        page: 2,
      }),
    ).toStrictEqual({ ...UNSPECIFIED_USER_SEARCH, handle: 'maker_ai' });
  });

  test('ルーターが数として読んだ検索語は文字列に戻して受け付ける', () => {
    expect(toUserModerationSearch({ handle: 2026, nickname: 7 })).toStrictEqual(
      { ...UNSPECIFIED_USER_SEARCH, handle: '2026', nickname: '7' },
    );
  });

  test('上限を超える検索語は上限の書記素数で切り詰め、もう一度前後の空白を除く', () => {
    const term = `${'あ'.repeat(MODERATION_SEARCH_TERM_MAX - 1)} い`;

    expect(toUserModerationSearch({ nickname: term })).toStrictEqual({
      ...UNSPECIFIED_USER_SEARCH,
      nickname: 'あ'.repeat(MODERATION_SEARCH_TERM_MAX - 1),
    });
    expect(MODERATION_SEARCH_TERM_MAX).toBe(100);
  });

  test('254文字を超えるメールアドレス・知らない停止状態・大文字の停止状態・上限を超えるカーソル・文字列でない値は未指定にする', () => {
    expect(
      toUserModerationSearch({
        email: `${'a'.repeat(240)}@launch.example`,
        status: 'SUSPENDED',
        after: 'c'.repeat(257),
        handle: true,
        nickname: null,
      }),
    ).toStrictEqual(UNSPECIFIED_USER_SEARCH);
    expect(toUserModerationSearch({ status: 'withdrawn' })).toStrictEqual(
      UNSPECIFIED_USER_SEARCH,
    );
  });

  test('254文字のメールアドレスと256文字のカーソルは受け付ける', () => {
    const email = `${'a'.repeat(239)}@launch.example`;
    const after = 'c'.repeat(256);

    expect(toUserModerationSearch({ email, after })).toStrictEqual({
      ...UNSPECIFIED_USER_SEARCH,
      email,
      after,
    });
  });

  test('一覧の照会の引数は値のある条件とページの位置だけを持つ', () => {
    expect(userModerationListArgsOf(UNSPECIFIED_USER_SEARCH)).toStrictEqual({});
    expect(
      userModerationListArgsOf({
        ...UNSPECIFIED_USER_SEARCH,
        email: 'user@launch.example',
        status: 'active',
        after: 'cursor-2',
      }),
    ).toStrictEqual({
      email: 'user@launch.example',
      status: 'active',
      after: 'cursor-2',
    });
  });

  test('ページの位置だけを替え、ページの位置を除いた条件を1つの値にする', () => {
    const search = { handle: 'maker_ai', after: 'cursor-1' };

    expect(userModerationSearchAt(search, 'cursor-2')).toStrictEqual({
      handle: 'maker_ai',
      after: 'cursor-2',
    });
    expect(userModerationSearchAt(search, undefined)).toStrictEqual({
      handle: 'maker_ai',
    });
    expect(userModerationFilterScopeOf(search)).toBe(
      userModerationFilterScopeOf({ handle: 'maker_ai' }),
    );
    expect(userModerationFilterScopeOf({ handle: 'maker_ai' })).not.toBe(
      userModerationFilterScopeOf({ nickname: 'maker_ai' }),
    );
  });
});

describe('プロダクトの検索パラメータ', () => {
  test('名称・ハンドル・投稿者のハンドル・カテゴリ・ローンチ状態・公開状態とページの位置を取り出す', () => {
    expect(
      toProductModerationSearch({
        name: 'Pitch Notes',
        handle: 'pitch_notes',
        ownerHandle: 'maker_ai',
        category: CATEGORY_ID,
        launchState: 'in_progress',
        visibility: 'owner_suspended',
        after: 'cursor-1',
      }),
    ).toStrictEqual({
      name: 'Pitch Notes',
      handle: 'pitch_notes',
      ownerHandle: 'maker_ai',
      category: CATEGORY_ID,
      launchState: 'in_progress',
      visibility: 'owner_suspended',
      after: 'cursor-1',
    });
  });

  test.each(ADMIN_PRODUCT_VISIBILITY_VALUES)(
    '公開状態%sを受け付ける',
    (visibility) => {
      expect(toProductModerationSearch({ visibility })).toStrictEqual({
        ...UNSPECIFIED_PRODUCT_SEARCH,
        visibility,
      });
    },
  );

  test('ULIDの形でないカテゴリ・小文字のカテゴリ・知らないローンチ状態と公開状態・空の値は未指定にする', () => {
    expect(
      toProductModerationSearch({
        name: ' ',
        category: 'sports',
        launchState: 'WON',
        visibility: 'deleted',
      }),
    ).toStrictEqual(UNSPECIFIED_PRODUCT_SEARCH);
    expect(
      toProductModerationSearch({ category: CATEGORY_ID.toLowerCase() }),
    ).toStrictEqual(UNSPECIFIED_PRODUCT_SEARCH);
  });

  test('一覧の照会の引数ではカテゴリをカテゴリのIDにする', () => {
    expect(
      productModerationListArgsOf({
        ...UNSPECIFIED_PRODUCT_SEARCH,
        name: 'Pitch',
        category: CATEGORY_ID,
        launchState: 'won',
      }),
    ).toStrictEqual({
      name: 'Pitch',
      categoryId: CATEGORY_ID,
      launchState: 'won',
    });
    expect(productModerationListArgsOf({})).toStrictEqual({});
  });

  test('ページの位置だけを替え、ページの位置を除いた条件を1つの値にする', () => {
    const search = { visibility: 'hidden', after: 'cursor-1' } as const;

    expect(productModerationSearchAt(search, undefined)).toStrictEqual({
      visibility: 'hidden',
    });
    expect(productModerationFilterScopeOf(search)).toBe(
      productModerationFilterScopeOf({ visibility: 'hidden' }),
    );
    expect(productModerationFilterScopeOf({ handle: 'a' })).not.toBe(
      productModerationFilterScopeOf({ ownerHandle: 'a' }),
    );
  });
});

describe('コメントの検索パラメータ', () => {
  test('投稿者・プロダクトのハンドル・投稿日の開始日と終了日・状態とページの位置を取り出す', () => {
    expect(
      toCommentModerationSearch({
        authorHandle: 'maker_ai',
        productHandle: 'pitch_notes',
        from: '2026-11-01',
        to: '2026-11-04',
        state: 'author_unavailable',
        after: 'cursor-1',
      }),
    ).toStrictEqual({
      authorHandle: 'maker_ai',
      productHandle: 'pitch_notes',
      from: '2026-11-01',
      to: '2026-11-04',
      state: 'author_unavailable',
      after: 'cursor-1',
    });
  });

  test('暦に無い日付・形の違う日付・知らない状態は未指定にし、開始日が終了日より後なら両端とも未指定にする', () => {
    expect(
      toCommentModerationSearch({
        from: '2026-02-30',
        to: '20261104',
        state: 'removed',
      }),
    ).toStrictEqual(UNSPECIFIED_COMMENT_SEARCH);
    expect(
      toCommentModerationSearch({ from: '2026-11-05', to: '2026-11-04' }),
    ).toStrictEqual(UNSPECIFIED_COMMENT_SEARCH);
  });

  test('開始日と終了日が同じ日なら両端を残す', () => {
    expect(
      toCommentModerationSearch({ from: '2026-11-04', to: '2026-11-04' }),
    ).toStrictEqual({
      ...UNSPECIFIED_COMMENT_SEARCH,
      from: '2026-11-04',
      to: '2026-11-04',
    });
  });

  test('一覧の照会の引数では、閲覧者の地域の暦で開始日の0時を含み終了日の翌日0時を含まない投稿日時の範囲にする', () => {
    expect(
      commentModerationListArgsOf(
        {
          ...UNSPECIFIED_COMMENT_SEARCH,
          authorHandle: 'maker_ai',
          from: '2026-11-01',
          to: '2026-11-04',
          state: 'hidden',
          after: 'cursor-3',
        },
        'Asia/Tokyo',
      ),
    ).toStrictEqual({
      authorHandle: 'maker_ai',
      postedFrom: '2026-10-31T15:00:00.000Z',
      postedBefore: '2026-11-04T15:00:00.000Z',
      state: 'hidden',
      after: 'cursor-3',
    });
    expect(
      commentModerationListArgsOf({ to: '2026-11-04' }, 'UTC'),
    ).toStrictEqual({ postedBefore: '2026-11-05T00:00:00.000Z' });
    expect(commentModerationListArgsOf({}, 'UTC')).toStrictEqual({});
  });

  test('ページの位置だけを替え、ページの位置を除いた条件を1つの値にする', () => {
    const search = { from: '2026-11-01', after: 'cursor-1' };

    expect(commentModerationSearchAt(search, 'cursor-2')).toStrictEqual({
      from: '2026-11-01',
      after: 'cursor-2',
    });
    expect(commentModerationFilterScopeOf(search)).toBe(
      commentModerationFilterScopeOf({ from: '2026-11-01' }),
    );
    expect(commentModerationFilterScopeOf({ from: '2026-11-01' })).not.toBe(
      commentModerationFilterScopeOf({ to: '2026-11-01' }),
    );
  });
});

describe('評価の検索パラメータ', () => {
  test('プロダクト・評価者のハンドル・状態とページの位置を取り出す', () => {
    expect(
      toRatingModerationSearch({
        productHandle: 'pitch_notes',
        raterHandle: 'fan_1',
        state: 'invalidated',
        after: 'cursor-1',
      }),
    ).toStrictEqual({
      productHandle: 'pitch_notes',
      raterHandle: 'fan_1',
      state: 'invalidated',
      after: 'cursor-1',
    });
  });

  test.each(ADMIN_RATING_STATE_VALUES)('状態%sを受け付ける', (state) => {
    expect(toRatingModerationSearch({ state })).toStrictEqual({
      ...UNSPECIFIED_RATING_SEARCH,
      state,
    });
  });

  test('知らない状態・空の値は未指定にする', () => {
    expect(
      toRatingModerationSearch({ state: 'VALID', productHandle: '' }),
    ).toStrictEqual(UNSPECIFIED_RATING_SEARCH);
  });

  test('一覧の照会の引数は値のある条件とページの位置だけを持ち、ページの位置だけを替えられる', () => {
    expect(
      ratingModerationListArgsOf({
        ...UNSPECIFIED_RATING_SEARCH,
        raterHandle: 'fan_1',
        state: 'valid',
      }),
    ).toStrictEqual({ raterHandle: 'fan_1', state: 'valid' });
    expect(
      ratingModerationSearchAt({ state: 'valid', after: 'x' }, 'y'),
    ).toStrictEqual({ state: 'valid', after: 'y' });
    expect(ratingModerationFilterScopeOf({ state: 'valid', after: 'x' })).toBe(
      ratingModerationFilterScopeOf({ state: 'valid' }),
    );
  });
});

describe('画像モデレーションの検索パラメータ', () => {
  test('自動判定以外の隔離理由を取り出し、自動判定・無い値・不正な値は既定の自動判定としてURLに書かない', () => {
    expect(
      toQuarantinedImageSearch({ reason: 'user_suspended' }),
    ).toStrictEqual({ reason: 'user_suspended' });
    expect(toQuarantinedImageSearch({ reason: 'auto' })).toStrictEqual({
      reason: undefined,
    });
    expect(toQuarantinedImageSearch({})).toStrictEqual({ reason: undefined });
    expect(toQuarantinedImageSearch({ reason: 'AUTO', page: 2 })).toStrictEqual(
      { reason: undefined },
    );
  });

  test('一覧の照会の引数は、隔離理由が無ければ自動判定にする', () => {
    expect(quarantinedImageListArgsOf({ reason: undefined })).toStrictEqual({
      reason: 'auto',
    });
    expect(
      quarantinedImageListArgsOf({ reason: 'admin_action' }),
    ).toStrictEqual({ reason: 'admin_action' });
  });
});
