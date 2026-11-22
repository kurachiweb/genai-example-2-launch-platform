import { describe, expect, test } from 'bun:test';

import { REPORT_LIST_EXCERPT_MAX } from '../../../common-lib/reporting/report-case-rules.ts';
import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import type {
  CommentRecord,
  CommentStore,
} from '../../../lib/core/engagement/ports.ts';
import type {
  ProductDirectory,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import type {
  UserHandleResolution,
  UserLookupScope,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import type { ReportTargetKey, ReportTargetView } from './ports.ts';
import {
  DirectoryReportTargetResolver,
  reportTargetKeyOf,
} from './report-target-resolver.ts';

const USER_ID = '01JQ0USR000000000000000001';
const OWNER_ID = '01JQ0USR000000000000000002';
const AUTHOR_ID = '01JQ0USR000000000000000003';
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const OTHER_PRODUCT_ID = '01JQ0PRD000000000000000002';
const COMMENT_ID = '01JQ0CMT000000000000000001';
const OTHER_COMMENT_ID = '01JQ0CMT000000000000000002';
const MISSING_ID = '01JQ0MIS000000000000000001';

type UserState = 'active' | 'suspended' | 'withdrawn';

interface StoredUser {
  readonly summary: UserSummaryRecord;
  readonly state: UserState;
  readonly previousHandles?: readonly string[];
}

interface StoredProduct {
  readonly summary: ProductSummaryRecord;
  readonly deleted?: boolean;
}

const userOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: USER_ID,
  handle: 'reported-user',
  nickname: '通報されたひと',
  avatarFileId: null,
  suspended: false,
  ...overrides,
});

const productOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OWNER_ID,
  handle: 'stadium-tool',
  name: '試合を見守る道具',
  tagline: '投票の行方を見守る',
  category: { id: '01JQ0CAT000000000000000001', name: '開発', handle: 'dev' },
  websiteUrl: 'https://product.example/',
  logoFileId: '01JQ0FIL000000000000000001',
  hidden: false,
  visible: true,
  listed: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const commentOf = (overrides: Partial<CommentRecord> = {}): CommentRecord => ({
  commentId: COMMENT_ID,
  productId: PRODUCT_ID,
  launchId: '01JQ0LCH000000000000000001',
  parentId: null,
  rootId: COMMENT_ID,
  depth: 1,
  authorUserId: AUTHOR_ID,
  bodyMarkdown: '**太字**のままのコメント',
  createdAt: new Date('2026-11-19T10:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  anonymizedAt: null,
  ...overrides,
});

const HIDDEN_AT = new Date('2026-11-20T00:00:00.000Z');

const activeUser = (
  overrides: Partial<UserSummaryRecord> = {},
): StoredUser => ({
  summary: userOf(overrides),
  state: 'active',
});

const inScope = (state: UserState, scope: UserLookupScope): boolean => {
  switch (scope) {
    case 'visible': {
      return state === 'active';
    }
    case 'not-withdrawn': {
      return state !== 'withdrawn';
    }
    case 'including-withdrawn': {
      return true;
    }
  }
};

const createFakes = (
  options: {
    readonly users?: readonly StoredUser[];
    readonly products?: readonly StoredProduct[];
    readonly comments?: readonly CommentRecord[];
  } = {},
) => {
  const users = options.users ?? [];
  const products = options.products ?? [];
  const comments = options.comments ?? [];
  const calls = {
    userSummaries: [] as { ids: readonly string[]; scope: UserLookupScope }[],
    userHandles: [] as string[],
    productSummaries: [] as {
      ids: readonly string[];
      scope: ProductLookupScope;
    }[],
    comments: [] as (readonly string[])[],
  };
  const profiles: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.userSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          users
            .filter(
              (user) =>
                ids.includes(user.summary.userId) && inScope(user.state, scope),
            )
            .map((user) => [user.summary.userId, user.summary]),
        ),
      );
    },
    resolveHandle: (handle) => {
      calls.userHandles.push(handle);
      const lookup = handle.toLowerCase();
      const resolution = users
        .filter((user) => user.state !== 'withdrawn')
        .map((user): UserHandleResolution | undefined => {
          if (user.summary.handle.toLowerCase() === lookup) {
            return { kind: 'current', user: user.summary };
          }
          if (
            user.previousHandles?.some(
              (previous) => previous.toLowerCase() === lookup,
            ) === true
          ) {
            return { kind: 'previous', user: user.summary };
          }
          return undefined;
        })
        .find((found) => found !== undefined);
      return Promise.resolve(resolution ?? { kind: 'none' });
    },
  };
  const productDirectory: ProductDirectory = {
    findSummaries: (ids, scope) => {
      calls.productSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          products
            .filter(
              (product) =>
                ids.includes(product.summary.productId) &&
                product.deleted !== true &&
                (scope === 'not-deleted' || product.summary.visible),
            )
            .map((product) => [product.summary.productId, product.summary]),
        ),
      );
    },
    resolveHandle: () =>
      Promise.reject(new Error('resolveHandleは呼ばれない想定です')),
    findDetail: () =>
      Promise.reject(new Error('findDetailは呼ばれない想定です')),
    listLaunches: () =>
      Promise.reject(new Error('listLaunchesは呼ばれない想定です')),
  };
  const commentStore: CommentStore = {
    findByIds: (ids) => {
      calls.comments.push(ids);
      return Promise.resolve(
        new Map(
          comments
            .filter((comment) => ids.includes(comment.commentId))
            .map((comment) => [comment.commentId, comment]),
        ),
      );
    },
  };
  const resolver = new DirectoryReportTargetResolver(
    profiles,
    productDirectory,
    commentStore,
  );
  return { resolver, calls };
};

const UNAVAILABLE: ReportTargetView = {
  available: false,
  handle: null,
  label: null,
  excerpt: null,
  productName: null,
  productHandle: null,
  anonymized: false,
};

describe('DirectoryReportTargetResolver.resolveForSubmission(ユーザー)', () => {
  test('現在のハンドルで本人を投稿者とする対象を返す', async () => {
    const { resolver, calls } = createFakes({ users: [activeUser()] });

    const resolved = await resolver.resolveForSubmission(
      'user',
      'reported-user',
    );

    expect(resolved).toEqual({
      kind: 'user',
      targetId: USER_ID,
      ownerUserId: USER_ID,
      productId: null,
    });
    expect(calls.userHandles).toEqual(['reported-user']);
  });

  test('旧のハンドルでも現在の利用者を対象とする', async () => {
    const { resolver } = createFakes({
      users: [{ ...activeUser(), previousHandles: ['old-handle'] }],
    });

    const resolved = await resolver.resolveForSubmission('user', 'old-handle');

    expect(resolved?.targetId).toBe(USER_ID);
  });

  test.each([
    ['空', ''],
    ['26文字', 'a'.repeat(26)],
    ['使えない文字', 'bad handle!'],
  ])(
    'ハンドルの形式が誤っていれば(%s)照会せずに見つからない',
    async (_, ref) => {
      const { resolver, calls } = createFakes({ users: [activeUser()] });

      const resolved = await resolver.resolveForSubmission('user', ref);

      expect(resolved).toBeUndefined();
      expect(calls.userHandles).toEqual([]);
    },
  );

  test('引けないハンドルは見つからない', async () => {
    const { resolver } = createFakes({ users: [activeUser()] });

    expect(
      await resolver.resolveForSubmission('user', 'someone-else'),
    ).toBeUndefined();
  });

  test('停止中の利用者は見つからない', async () => {
    const { resolver } = createFakes({
      users: [{ summary: userOf({ suspended: true }), state: 'suspended' }],
    });

    expect(
      await resolver.resolveForSubmission('user', 'reported-user'),
    ).toBeUndefined();
  });

  test('退会済みの利用者は見つからない', async () => {
    const { resolver } = createFakes({
      users: [{ summary: userOf(), state: 'withdrawn' }],
    });

    expect(
      await resolver.resolveForSubmission('user', 'reported-user'),
    ).toBeUndefined();
  });
});

describe('DirectoryReportTargetResolver.resolveForSubmission(プロダクト)', () => {
  test('掲載中のプロダクトを投稿者とプロダクトとともに返す', async () => {
    const { resolver, calls } = createFakes({
      products: [{ summary: productOf() }],
    });

    const resolved = await resolver.resolveForSubmission('product', PRODUCT_ID);

    expect(resolved).toEqual({
      kind: 'product',
      targetId: PRODUCT_ID,
      ownerUserId: OWNER_ID,
      productId: PRODUCT_ID,
    });
    expect(calls.productSummaries).toEqual([
      { ids: [PRODUCT_ID], scope: 'visible' },
    ]);
  });

  test.each([
    ['未掲載', { summary: productOf({ listed: false }) }],
    [
      '非公開化',
      {
        summary: productOf({ hidden: true, visible: false, listed: false }),
      },
    ],
    [
      '投稿者が停止中',
      { summary: productOf({ visible: false, listed: false }) },
    ],
    ['論理削除', { summary: productOf(), deleted: true }],
  ] satisfies [string, StoredProduct][])(
    '%sのプロダクトは見つからない',
    async (_, product) => {
      const { resolver } = createFakes({ products: [product] });

      expect(
        await resolver.resolveForSubmission('product', PRODUCT_ID),
      ).toBeUndefined();
    },
  );

  test('引けないIDは見つからない', async () => {
    const { resolver } = createFakes({ products: [{ summary: productOf() }] });

    expect(
      await resolver.resolveForSubmission('product', MISSING_ID),
    ).toBeUndefined();
  });
});

describe('DirectoryReportTargetResolver.resolveForSubmission(コメント)', () => {
  const visibleAuthor = activeUser({
    userId: AUTHOR_ID,
    handle: 'comment-author',
  });

  test('表示中のコメントを投稿者と対象のプロダクトとともに返す', async () => {
    const { resolver, calls } = createFakes({
      users: [visibleAuthor],
      products: [{ summary: productOf() }],
      comments: [commentOf()],
    });

    const resolved = await resolver.resolveForSubmission('comment', COMMENT_ID);

    expect(resolved).toEqual({
      kind: 'comment',
      targetId: COMMENT_ID,
      ownerUserId: AUTHOR_ID,
      productId: PRODUCT_ID,
    });
    expect(calls.comments).toEqual([[COMMENT_ID]]);
    expect(calls.userSummaries).toEqual([
      { ids: [AUTHOR_ID], scope: 'visible' },
    ]);
    expect(calls.productSummaries).toEqual([
      { ids: [PRODUCT_ID], scope: 'visible' },
    ]);
  });

  test.each([
    ['削除', commentOf({ deletedAt: HIDDEN_AT })],
    ['非公開化', commentOf({ hiddenAt: HIDDEN_AT })],
    [
      '匿名化',
      commentOf({
        anonymizedAt: HIDDEN_AT,
        authorUserId: null,
        bodyMarkdown: '',
      }),
    ],
    ['投稿者が無い', commentOf({ authorUserId: null })],
  ])('%sのコメントは見つからない', async (_, comment) => {
    const { resolver } = createFakes({
      users: [visibleAuthor],
      products: [{ summary: productOf() }],
      comments: [comment],
    });

    expect(
      await resolver.resolveForSubmission('comment', COMMENT_ID),
    ).toBeUndefined();
  });

  test.each([
    [
      '停止中',
      {
        summary: userOf({ userId: AUTHOR_ID, suspended: true }),
        state: 'suspended',
      },
    ],
    [
      '退会済み',
      { summary: userOf({ userId: AUTHOR_ID }), state: 'withdrawn' },
    ],
  ] satisfies [string, StoredUser][])(
    '投稿者が%sのコメントは見つからない',
    async (_, author) => {
      const { resolver } = createFakes({
        users: [author],
        products: [{ summary: productOf() }],
        comments: [commentOf()],
      });

      expect(
        await resolver.resolveForSubmission('comment', COMMENT_ID),
      ).toBeUndefined();
    },
  );

  test.each([
    ['未掲載', { summary: productOf({ listed: false }) }],
    [
      '非公開化',
      {
        summary: productOf({ hidden: true, visible: false, listed: false }),
      },
    ],
    ['論理削除', { summary: productOf(), deleted: true }],
  ] satisfies [string, StoredProduct][])(
    '対象のプロダクトが%sのコメントは見つからない',
    async (_, product) => {
      const { resolver } = createFakes({
        users: [visibleAuthor],
        products: [product],
        comments: [commentOf()],
      });

      expect(
        await resolver.resolveForSubmission('comment', COMMENT_ID),
      ).toBeUndefined();
    },
  );

  test('引けないIDは見つからず、投稿者とプロダクトを照会しない', async () => {
    const { resolver, calls } = createFakes({
      users: [visibleAuthor],
      products: [{ summary: productOf() }],
    });

    expect(
      await resolver.resolveForSubmission('comment', MISSING_ID),
    ).toBeUndefined();
    expect(calls.userSummaries).toEqual([]);
    expect(calls.productSummaries).toEqual([]);
  });
});

describe('DirectoryReportTargetResolver.describe', () => {
  const userKey: ReportTargetKey = {
    kind: 'user',
    targetId: USER_ID,
    productId: null,
  };
  const productKey: ReportTargetKey = {
    kind: 'product',
    targetId: PRODUCT_ID,
    productId: PRODUCT_ID,
  };
  const commentKey: ReportTargetKey = {
    kind: 'comment',
    targetId: COMMENT_ID,
    productId: OTHER_PRODUCT_ID,
  };

  const describeFakes = () =>
    createFakes({
      users: [
        { summary: userOf({ suspended: true }), state: 'suspended' },
        { summary: userOf({ userId: AUTHOR_ID }), state: 'withdrawn' },
      ],
      products: [
        {
          summary: productOf({ hidden: true, visible: false, listed: false }),
        },
        {
          summary: productOf({
            productId: OTHER_PRODUCT_ID,
            handle: 'other-tool',
            name: 'もう一つの道具',
          }),
        },
      ],
      comments: [
        commentOf({ productId: OTHER_PRODUCT_ID, hiddenAt: HIDDEN_AT }),
        commentOf({
          commentId: OTHER_COMMENT_ID,
          productId: OTHER_PRODUCT_ID,
          anonymizedAt: HIDDEN_AT,
          authorUserId: null,
          bodyMarkdown: '',
        }),
      ],
    });

  test('停止中のユーザーと非公開化のプロダクトも表示名を返す', async () => {
    const { resolver } = describeFakes();

    const views = await resolver.describe([userKey, productKey]);

    expect(views.get(reportTargetKeyOf(userKey))).toEqual({
      available: true,
      handle: 'reported-user',
      label: '通報されたひと',
      excerpt: null,
      productName: null,
      productHandle: null,
      anonymized: false,
    });
    expect(views.get(reportTargetKeyOf(productKey))).toEqual({
      available: true,
      handle: 'stadium-tool',
      label: '試合を見守る道具',
      excerpt: null,
      productName: null,
      productHandle: null,
      anonymized: false,
    });
  });

  test('非公開化のコメントも抜粋と対象のプロダクトを返す', async () => {
    const { resolver } = describeFakes();

    const views = await resolver.describe([commentKey]);

    expect(views.get(reportTargetKeyOf(commentKey))).toEqual({
      available: true,
      handle: null,
      label: null,
      excerpt: '**太字**のままのコメント',
      productName: 'もう一つの道具',
      productHandle: 'other-tool',
      anonymized: false,
    });
  });

  test('匿名化のコメントは匿名化の印と空の抜粋を返す', async () => {
    const { resolver } = describeFakes();
    const key: ReportTargetKey = {
      kind: 'comment',
      targetId: OTHER_COMMENT_ID,
      productId: OTHER_PRODUCT_ID,
    };

    const views = await resolver.describe([key]);

    expect(views.get(reportTargetKeyOf(key))).toMatchObject({
      available: true,
      excerpt: '',
      anonymized: true,
      productName: 'もう一つの道具',
    });
  });

  test('コメントの抜粋を一覧の文字数で切る', async () => {
    const body = `${'👍🏽'.repeat(REPORT_LIST_EXCERPT_MAX)}あいう`;
    const { resolver } = createFakes({
      comments: [commentOf({ bodyMarkdown: body })],
    });
    const key: ReportTargetKey = {
      kind: 'comment',
      targetId: COMMENT_ID,
      productId: PRODUCT_ID,
    };

    const views = await resolver.describe([key]);

    const excerpt = views.get(reportTargetKeyOf(key))?.excerpt ?? '';
    expect(countGraphemes(excerpt)).toBe(REPORT_LIST_EXCERPT_MAX);
    expect(excerpt).toBe('👍🏽'.repeat(REPORT_LIST_EXCERPT_MAX));
  });

  test('対象のプロダクトが引けないコメントはプロダクトの表示をnullにする', async () => {
    const { resolver } = createFakes({ comments: [commentOf()] });
    const key: ReportTargetKey = {
      kind: 'comment',
      targetId: COMMENT_ID,
      productId: PRODUCT_ID,
    };

    const views = await resolver.describe([key]);

    expect(views.get(reportTargetKeyOf(key))).toMatchObject({
      available: true,
      productName: null,
      productHandle: null,
    });
  });

  test('照会は種類ごとに1回で、コメントのプロダクトもプロダクトの照会にまとめる', async () => {
    const { resolver, calls } = describeFakes();
    const otherUserKey: ReportTargetKey = {
      kind: 'user',
      targetId: AUTHOR_ID,
      productId: null,
    };
    const otherCommentKey: ReportTargetKey = {
      kind: 'comment',
      targetId: OTHER_COMMENT_ID,
      productId: OTHER_PRODUCT_ID,
    };

    await resolver.describe([
      userKey,
      otherUserKey,
      productKey,
      commentKey,
      otherCommentKey,
    ]);

    expect(calls.userSummaries).toEqual([
      { ids: [USER_ID, AUTHOR_ID], scope: 'not-withdrawn' },
    ]);
    expect(calls.productSummaries).toEqual([
      { ids: [PRODUCT_ID, OTHER_PRODUCT_ID], scope: 'not-deleted' },
    ]);
    expect(calls.comments).toEqual([[COMMENT_ID, OTHER_COMMENT_ID]]);
  });

  test('引けない対象は表示できない対象とする', async () => {
    const { resolver } = describeFakes();
    const keys: readonly ReportTargetKey[] = [
      { kind: 'user', targetId: AUTHOR_ID, productId: null },
      { kind: 'product', targetId: MISSING_ID, productId: MISSING_ID },
      { kind: 'comment', targetId: MISSING_ID, productId: PRODUCT_ID },
    ];

    const views = await resolver.describe(keys);

    expect(keys.map((key) => views.get(reportTargetKeyOf(key)))).toEqual([
      UNAVAILABLE,
      UNAVAILABLE,
      UNAVAILABLE,
    ]);
  });

  test('対象への参照を消した案件は照会せずに表示できない対象とする', async () => {
    const { resolver, calls } = describeFakes();
    const keys: readonly ReportTargetKey[] = [
      { kind: 'user', targetId: null, productId: null },
      { kind: 'product', targetId: null, productId: null },
      { kind: 'comment', targetId: null, productId: PRODUCT_ID },
    ];

    const views = await resolver.describe(keys);

    expect(keys.map((key) => views.get(reportTargetKeyOf(key)))).toEqual([
      UNAVAILABLE,
      UNAVAILABLE,
      UNAVAILABLE,
    ]);
    expect(calls).toEqual({
      userSummaries: [],
      userHandles: [],
      productSummaries: [],
      comments: [],
    });
  });

  test('空の鍵の一覧は照会しない', async () => {
    const { resolver, calls } = describeFakes();

    const views = await resolver.describe([]);

    expect(views.size).toBe(0);
    expect(calls.userSummaries).toEqual([]);
    expect(calls.productSummaries).toEqual([]);
    expect(calls.comments).toEqual([]);
  });
});

describe('reportTargetKeyOf', () => {
  test('種類と対象のIDを鍵にする', () => {
    expect(reportTargetKeyOf({ kind: 'comment', targetId: COMMENT_ID })).toBe(
      `comment:${COMMENT_ID}`,
    );
  });

  test('対象への参照を消した案件は種類だけの鍵にする', () => {
    expect(reportTargetKeyOf({ kind: 'product', targetId: null })).toBe(
      'product:',
    );
  });
});
