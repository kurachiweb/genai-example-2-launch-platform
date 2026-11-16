import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { Database } from '../../db/client.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { PROFILE_PLATFORM_TYPES } from '../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../lib/core/profile/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearEngagementTables,
  userIdOf,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { D1UserProfileDirectory } from '../../lib/workers/profile/d1-user-profile-directory.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { engagementSchemaModule } from '../../src/presentation/graphql/modules/engagement/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';

// ローンチの状態が実行の時刻で変わらないよう、時計を業務時刻の2026-11-10 12:00に固定する
export const ENGAGEMENT_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-11-10'),
  { hour: 12, minute: 0 },
);

const testClock: Clock = { now: () => ENGAGEMENT_TEST_NOW };

const fixedClockModule: AppModule<GatewayApp> = {
  name: 'engagement-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

let hiddenAuthorIds: ReadonlySet<string> = new Set();

// コメントの照会の後に投稿者が退会・停止した競合を再現するため、指定した利用者を利用者の要約の照会からだけ除く
export function hideEngagementAuthorSummaries(
  userIndexes: readonly number[],
): void {
  hiddenAuthorIds = new Set(userIndexes.map(userIdOf));
}

const authorHidingModule: AppModule<GatewayApp> = {
  name: 'engagement-graphql-test-author-hiding',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<UserProfileDirectory>(
      PROFILE_PLATFORM_TYPES.UserProfileDirectory,
    ).toDynamicValue((context) => {
      const directory = new D1UserProfileDirectory(
        context.get<Database>(PLATFORM_TYPES.Database),
      );
      return {
        resolveHandle: (handle) => directory.resolveHandle(handle),
        findSummaries: async (userIds, scope) => {
          const found = await directory.findSummaries(userIds, scope);
          return new Map<string, UserSummaryRecord>(
            [...found].filter(([userId]) => !hiddenAuthorIds.has(userId)),
          );
        },
      };
    });
  }),
};

// 返信の投稿者の画像の項目まで選び、平たい返信の一覧が深さの上限(8)に収まることを確かめる
const LAUNCH_COMMENT_SELECTION = /* GraphQL */ `
  id
  parentId
  depth
  state
  author {
    handle
    nickname
    avatar {
      id
      objectKey
    }
  }
  body
  createdAt
  edited
  byProductOwner
  viewerIsAuthor
`;

export const LAUNCH_COMMENTS = /* GraphQL */ `
  query LaunchComments($productId: ID!, $launchId: ID!, $after: String) {
    launchComments(productId: $productId, launchId: $launchId, after: $after) {
      nodes {
        comment {
          ${LAUNCH_COMMENT_SELECTION}
        }
        replies {
          ${LAUNCH_COMMENT_SELECTION}
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const LAUNCH_COMMENT_COUNTS = /* GraphQL */ `
  query LaunchCommentCounts($productId: ID!) {
    launchCommentCounts(productId: $productId) {
      launchId
      count
    }
  }
`;

const PRODUCT_RATING_SELECTION = /* GraphQL */ `
  productId
  average
  count
  viewerScore
`;

const COMMENT_MUTATION_RESULT_SELECTION = /* GraphQL */ `
  comment {
    ${LAUNCH_COMMENT_SELECTION}
  }
  rating {
    ${PRODUCT_RATING_SELECTION}
  }
`;

export const POST_COMMENT = /* GraphQL */ `
  mutation PostComment($input: PostCommentInput!) {
    postComment(input: $input) {
      ${COMMENT_MUTATION_RESULT_SELECTION}
    }
  }
`;

export const UPDATE_COMMENT = /* GraphQL */ `
  mutation UpdateComment($input: UpdateCommentInput!) {
    updateComment(input: $input) {
      ${COMMENT_MUTATION_RESULT_SELECTION}
    }
  }
`;

export const DELETE_COMMENT = /* GraphQL */ `
  mutation DeleteComment($commentId: ID!) {
    deleteComment(commentId: $commentId) {
      ${LAUNCH_COMMENT_SELECTION}
    }
  }
`;

export const PRODUCT_RATING = /* GraphQL */ `
  query ProductRating($productId: ID!) {
    productRating(productId: $productId) {
      ${PRODUCT_RATING_SELECTION}
    }
  }
`;

export const RATE_PRODUCT = /* GraphQL */ `
  mutation RateProduct($productId: ID!, $score: Int!) {
    rateProduct(productId: $productId, score: $score) {
      ${PRODUCT_RATING_SELECTION}
    }
  }
`;

export const CANCEL_PRODUCT_RATING = /* GraphQL */ `
  mutation CancelProductRating($productId: ID!) {
    cancelProductRating(productId: $productId) {
      ${PRODUCT_RATING_SELECTION}
    }
  }
`;

export interface LaunchCommentFields {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly state: 'SHOWN' | 'REMOVED';
  readonly author: {
    readonly handle: string;
    readonly nickname: string;
    readonly avatar: {
      readonly id: string;
      readonly objectKey: string | null;
    } | null;
  } | null;
  readonly body: string | null;
  readonly createdAt: string | null;
  readonly edited: boolean;
  readonly byProductOwner: boolean;
  readonly viewerIsAuthor: boolean;
}

export interface LaunchCommentConnectionFields {
  readonly nodes: readonly {
    readonly comment: LaunchCommentFields;
    readonly replies: readonly LaunchCommentFields[];
  }[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface LaunchCommentCountFields {
  readonly launchId: string;
  readonly count: number;
}

export interface ProductRatingFields {
  readonly productId: string;
  readonly average: number | null;
  readonly count: number;
  readonly viewerScore: number | null;
}

export interface CommentMutationResultFields {
  readonly comment: LaunchCommentFields;
  readonly rating: ProductRatingFields | null;
}

const engagementGateway = createGraphQLGateway({
  documents: [
    LAUNCH_COMMENTS,
    LAUNCH_COMMENT_COUNTS,
    POST_COMMENT,
    UPDATE_COMMENT,
    DELETE_COMMENT,
    PRODUCT_RATING,
    RATE_PRODUCT,
    CANCEL_PRODUCT_RATING,
  ],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    engagementSchemaModule,
  ],
  overrides: [fixedClockModule, authorHidingModule],
});

// 各テストの前にコメント・評価・プロダクト・利用者・ファイルのテーブルと、要約から除く利用者を空にする
export function installEngagementGraphQLTest(): void {
  beforeEach(async () => {
    hiddenAuthorIds = new Set();
    await clearEngagementTables();
    await clearMediaTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// セッションの検証が固定の時計で行われるため、発行も同じ時刻で行う
export async function issueEngagementUserSession(
  userIndex: number,
): Promise<string> {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
  const issued = await container
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: ENGAGEMENT_TEST_NOW,
    });
  return issued.token;
}

export function fetchLaunchComments(
  variables: {
    readonly productId: string;
    readonly launchId: string;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    launchComments: LaunchCommentConnectionFields | null;
  }>(LAUNCH_COMMENTS, variables, options);
}

export function fetchLaunchCommentCounts(
  productId: string,
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    launchCommentCounts: readonly LaunchCommentCountFields[] | null;
  }>(LAUNCH_COMMENT_COUNTS, { productId }, options);
}

// 省略できる項目を送らないことと明示したnullを送ることを区別して確かめるため、渡した項目だけを送る
export interface PostCommentVariables {
  readonly productId: string;
  readonly launchId: string;
  readonly parentId?: string | null;
  readonly body: string;
  readonly rating?: number | null;
}

export interface UpdateCommentVariables {
  readonly commentId: string;
  readonly body: string;
  readonly rating?: number | null;
}

export function postComment(
  input: PostCommentVariables,
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    postComment: CommentMutationResultFields | null;
  }>(POST_COMMENT, { input }, options);
}

export function updateComment(
  input: UpdateCommentVariables,
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    updateComment: CommentMutationResultFields | null;
  }>(UPDATE_COMMENT, { input }, options);
}

export function deleteComment(commentId: string, options?: GatewayCallOptions) {
  return engagementGateway.call<{
    deleteComment: LaunchCommentFields | null;
  }>(DELETE_COMMENT, { commentId }, options);
}

export function fetchProductRating(
  productId: string,
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    productRating: ProductRatingFields | null;
  }>(PRODUCT_RATING, { productId }, options);
}

export function rateProduct(
  variables: { readonly productId: string; readonly score: number },
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    rateProduct: ProductRatingFields | null;
  }>(RATE_PRODUCT, variables, options);
}

export function cancelProductRating(
  productId: string,
  options?: GatewayCallOptions,
) {
  return engagementGateway.call<{
    cancelProductRating: ProductRatingFields | null;
  }>(CANCEL_PRODUCT_RATING, { productId }, options);
}
