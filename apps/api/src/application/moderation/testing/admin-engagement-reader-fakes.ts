import type { ModerationAction } from '../../../../common-lib/moderation/moderation-actions.ts';
import type {
  AdminCommentDirectory,
  AdminCommentRecord,
  AdminCommentSearchFilter,
  AdminDirectoryPage,
  AdminRatingDirectory,
  AdminRatingRecord,
  AdminRatingSearchFilter,
} from '../../../../lib/core/engagement/ports.ts';
import type {
  LatestModeration,
  ModerationRecordStore,
} from '../../../../lib/core/moderation/ports.ts';
import type {
  ProductDirectory,
  ProductHandleResolution,
  ProductLookupScope,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import type {
  UserHandleResolution,
  UserLookupScope,
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../lib/core/profile/ports.ts';

export const PRODUCT_ID = '01JQ0PRD000000000000000001';
export const OTHER_PRODUCT_ID = '01JQ0PRD000000000000000002';
export const DELETED_PRODUCT_ID = '01JQ0PRD000000000000000003';
export const USER_ID = '01JQ0USR000000000000000001';
export const OTHER_USER_ID = '01JQ0USR000000000000000002';
export const WITHDRAWN_USER_ID = '01JQ0USR000000000000000003';
export const LAUNCH_ID = '01JQ0LCH000000000000000001';
export const COMMENT_ID = '01JQ0CMT000000000000000001';
export const OTHER_COMMENT_ID = '01JQ0CMT000000000000000002';
export const THIRD_COMMENT_ID = '01JQ0CMT000000000000000003';
export const RATING_ID = '01JQ0RTG000000000000000001';
export const OTHER_RATING_ID = '01JQ0RTG000000000000000002';
export const NEXT_CURSOR =
  'MTc2MzYwNjgwMDAwMDowMUpRMFBSRDAwMDAwMDAwMDAwMDAwMDAwMg';

export const userOf = (
  overrides: Partial<UserSummaryRecord> = {},
): UserSummaryRecord => ({
  userId: USER_ID,
  handle: 'commenter',
  nickname: '投稿したひと',
  avatarFileId: null,
  suspended: false,
  ...overrides,
});

export const productOf = (
  overrides: Partial<ProductSummaryRecord> = {},
): ProductSummaryRecord => ({
  productId: PRODUCT_ID,
  ownerUserId: OTHER_USER_ID,
  handle: 'launch-stadium-tool',
  name: '試合を見守る道具',
  tagline: '投票の行方を見守る',
  category: { id: '01JQ0CAT000000000000000001', name: '開発', handle: 'dev' },
  websiteUrl: 'https://product.example/',
  logoFileId: '01JQ0FIL000000000000000001',
  hidden: false,
  visible: true,
  listed: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

export const commentOf = (
  overrides: Partial<AdminCommentRecord> = {},
): AdminCommentRecord => ({
  commentId: COMMENT_ID,
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  authorUserId: USER_ID,
  excerpt: '**太字**のままの抜粋',
  createdAt: new Date('2026-11-19T10:00:00.000Z'),
  editedAt: null,
  state: 'shown',
  ...overrides,
});

export const ratingOf = (
  overrides: Partial<AdminRatingRecord> = {},
): AdminRatingRecord => ({
  ratingId: RATING_ID,
  productId: PRODUCT_ID,
  userId: USER_ID,
  score: 4,
  invalidatedAt: null,
  createdAt: new Date('2026-11-18T10:00:00.000Z'),
  updatedAt: new Date('2026-11-19T10:00:00.000Z'),
  ...overrides,
});

const unexpected = (name: string) => () =>
  Promise.reject(new Error(`${name}は呼ばれない想定です`));

export interface EngagementReaderFakeOptions {
  readonly comments?: {
    readonly comments: readonly AdminCommentRecord[];
    readonly nextCursor: string | null;
  };
  readonly ratings?: {
    readonly ratings: readonly AdminRatingRecord[];
    readonly nextCursor: string | null;
  };
  readonly searchError?: Error;
  readonly userHandles?: ReadonlyMap<string, UserHandleResolution>;
  readonly productHandles?: ReadonlyMap<string, ProductHandleResolution>;
  readonly users?: readonly UserSummaryRecord[];
  readonly products?: readonly ProductSummaryRecord[];
  readonly latest?: ReadonlyMap<string, LatestModeration>;
}

export const createEngagementReaderFakes = (
  options: EngagementReaderFakeOptions = {},
) => {
  const calls = {
    commentSearch: [] as {
      filter: AdminCommentSearchFilter;
      page: AdminDirectoryPage;
    }[],
    ratingSearch: [] as {
      filter: AdminRatingSearchFilter;
      page: AdminDirectoryPage;
    }[],
    userHandles: [] as string[],
    productHandles: [] as string[],
    userSummaries: [] as { ids: readonly string[]; scope: UserLookupScope }[],
    productSummaries: [] as {
      ids: readonly string[];
      scope: ProductLookupScope;
    }[],
    latestFor: [] as {
      targetIds: readonly string[];
      actions: readonly ModerationAction[];
    }[],
  };
  const commentDirectory: AdminCommentDirectory = {
    search: (filter, page) => {
      calls.commentSearch.push({ filter, page });
      if (options.searchError !== undefined) {
        return Promise.reject(options.searchError);
      }
      return Promise.resolve(
        options.comments ?? { comments: [commentOf()], nextCursor: null },
      );
    },
  };
  const ratingDirectory: AdminRatingDirectory = {
    search: (filter, page) => {
      calls.ratingSearch.push({ filter, page });
      if (options.searchError !== undefined) {
        return Promise.reject(options.searchError);
      }
      return Promise.resolve(
        options.ratings ?? { ratings: [ratingOf()], nextCursor: null },
      );
    },
    findByIds: unexpected('AdminRatingDirectory.findByIds'),
  };
  const users = options.users ?? [userOf()];
  const profiles: UserProfileDirectory = {
    findSummaries: (ids, scope) => {
      calls.userSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          users
            .filter(({ userId }) => ids.includes(userId))
            .map((user) => [user.userId, user]),
        ),
      );
    },
    resolveHandle: (handle) => {
      calls.userHandles.push(handle);
      return Promise.resolve(
        options.userHandles?.get(handle) ?? { kind: 'none' },
      );
    },
  };
  const productSummaries = options.products ?? [productOf()];
  const products: ProductDirectory = {
    findSummaries: (ids, scope) => {
      calls.productSummaries.push({ ids, scope });
      return Promise.resolve(
        new Map(
          productSummaries
            .filter(({ productId }) => ids.includes(productId))
            .map((summary) => [summary.productId, summary]),
        ),
      );
    },
    resolveHandle: (handle) => {
      calls.productHandles.push(handle);
      return Promise.resolve(
        options.productHandles?.get(handle) ?? { kind: 'none' },
      );
    },
    findDetail: unexpected('ProductDirectory.findDetail'),
    listLaunches: unexpected('ProductDirectory.listLaunches'),
  };
  const records: ModerationRecordStore = {
    find: unexpected('find'),
    latestFor: (input) => {
      calls.latestFor.push(input);
      const latest = options.latest ?? new Map<string, LatestModeration>();
      return Promise.resolve(
        new Map(
          [...latest].filter(([targetId]) =>
            input.targetIds.includes(targetId),
          ),
        ),
      );
    },
    listPendingNotices: unexpected('listPendingNotices'),
    markNotice: unexpected('markNotice'),
    eraseBySubjectUser: unexpected('eraseBySubjectUser'),
    eraseByProduct: unexpected('eraseByProduct'),
    eraseOccurredBefore: unexpected('eraseOccurredBefore'),
  };
  return {
    commentDirectory,
    ratingDirectory,
    profiles,
    products,
    records,
    calls,
  };
};
