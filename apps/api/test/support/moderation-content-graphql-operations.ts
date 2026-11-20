import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { launchComments } from '../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../db/schema/engagement/product-ratings.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { clearMatchTables } from '../../lib/workers/match/testing/match-fixtures.ts';
import { clearMediaState } from '../../lib/workers/media/testing/media-operations-fixtures.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import {
  adminIdOf,
  clearAdminTables,
  db,
  insertAdmin,
} from '../../src/infrastructure/admin/testing/admin-store-fixtures.ts';
import { clearModerationWrites } from '../../src/infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { moderationSchemaModule } from '../../src/presentation/graphql/modules/moderation/index.ts';
import { issueAdminSession } from './admin-graphql-harness.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';

export { codesOf, detailsOf } from './payments-graphql-operations.ts';

// 管理画面の照会と措置の日時を固定し、ローンチの状態と措置の記録の日時を予測できるようにする
export const MODERATION_TEST_NOW = new Date('2026-11-25T00:00:00.000Z');

export interface MediaFileFields {
  readonly id: string;
  readonly path: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly string[];
}

export interface UserSummaryFields {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly suspended: boolean;
}

export interface ModerationNoteFields {
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface PageInfoFields {
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
}

export interface Connection<TNode> {
  readonly nodes: readonly TNode[];
  readonly pageInfo: PageInfoFields;
}

export interface AdminProductFields {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly logo: MediaFileFields | null;
  readonly owner: UserSummaryFields | null;
  readonly category: { readonly id: string; readonly name: string };
  readonly latestLaunchDate: string | null;
  readonly latestLaunchState: string | null;
  readonly visibility: string;
}

export interface AdminMatchResultFields {
  readonly id: string;
  readonly kind: string;
  readonly round: number | null;
  readonly stage: string | null;
  readonly matchDate: string;
  readonly upvoteCount: number;
  readonly result: string | null;
  readonly opponentName: string | null;
}

export interface AdminProductDetailFields {
  readonly product: AdminProductFields;
  readonly tagline: string;
  readonly descriptionMarkdown: string;
  readonly websiteUrl: string;
  readonly screenshots: readonly MediaFileFields[];
  readonly hiddenAt: string | null;
  readonly latestHide: ModerationNoteFields | null;
  readonly ratingSummary: {
    readonly average: number | null;
    readonly count: number;
  };
  readonly launches: readonly {
    readonly id: string;
    readonly number: number;
    readonly launchDate: string;
    readonly status: string;
    readonly matches: readonly AdminMatchResultFields[];
  }[];
}

export interface AdminCommentFields {
  readonly id: string;
  readonly excerpt: string;
  readonly author: UserSummaryFields | null;
  readonly productName: string | null;
  readonly productId: string;
  readonly launchId: string;
  readonly launchNumber: number | null;
  readonly createdAt: string;
  readonly state: string;
  readonly latestHide: ModerationNoteFields | null;
}

export interface AdminRatingFields {
  readonly id: string;
  readonly rater: UserSummaryFields | null;
  readonly productName: string | null;
  readonly productId: string;
  readonly score: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: string;
  readonly latestInvalidation: ModerationNoteFields | null;
}

export interface AdminQuarantinedImageFields {
  readonly file: MediaFileFields;
  readonly purpose: string;
  readonly owner: {
    readonly kind: string;
    readonly id: string;
    readonly nickname: string | null;
    readonly handle: string | null;
  } | null;
  readonly quarantinedAt: string;
  readonly findings: readonly string[];
}

const MEDIA_FILE_SELECTION = /* GraphQL */ `
  id
  path
  quarantined
  quarantineReasons
`;

const USER_SUMMARY_SELECTION = /* GraphQL */ `
  id
  handle
  nickname
  suspended
`;

const NOTE_SELECTION = /* GraphQL */ `
  reason
  occurredAt
`;

const PAGE_INFO_SELECTION = /* GraphQL */ `
  pageInfo {
    hasNextPage
    endCursor
  }
`;

const PRODUCT_SELECTION = /* GraphQL */ `
  id
  handle
  name
  logo { ${MEDIA_FILE_SELECTION} }
  owner { ${USER_SUMMARY_SELECTION} }
  category {
    id
    name
  }
  latestLaunchDate
  latestLaunchState
  visibility
`;

const RATING_SELECTION = /* GraphQL */ `
  id
  rater { ${USER_SUMMARY_SELECTION} }
  productName
  productId
  score
  createdAt
  updatedAt
  state
  latestInvalidation { ${NOTE_SELECTION} }
`;

export const ADMIN_PRODUCTS = /* GraphQL */ `
  query AdminProducts(
    $filter: AdminProductFilter
    $first: Int!
    $after: String
  ) {
    adminProducts(filter: $filter, first: $first, after: $after) {
      nodes { ${PRODUCT_SELECTION} }
      ${PAGE_INFO_SELECTION}
    }
  }
`;

export const ADMIN_PRODUCT = /* GraphQL */ `
  query AdminProduct($id: ID!) {
    adminProduct(id: $id) {
      product { ${PRODUCT_SELECTION} }
      tagline
      descriptionMarkdown
      websiteUrl
      screenshots { ${MEDIA_FILE_SELECTION} }
      hiddenAt
      latestHide { ${NOTE_SELECTION} }
      ratingSummary {
        average
        count
      }
      launches {
        id
        number
        launchDate
        status
        matches {
          id
          kind
          round
          stage
          matchDate
          upvoteCount
          result
          opponentName
        }
      }
    }
  }
`;

export const ADMIN_MODERATION_CATEGORY_OPTIONS = /* GraphQL */ `
  query AdminModerationCategoryOptions {
    adminModerationCategoryOptions {
      id
      name
    }
  }
`;

export const ADMIN_PRODUCT_RATINGS = /* GraphQL */ `
  query AdminProductRatings($productId: ID!, $first: Int!, $after: String) {
    adminProductRatings(productId: $productId, first: $first, after: $after) {
      nodes { ${RATING_SELECTION} }
      ${PAGE_INFO_SELECTION}
    }
  }
`;

export const ADMIN_COMMENTS = /* GraphQL */ `
  query AdminComments(
    $filter: AdminCommentFilter
    $first: Int!
    $after: String
  ) {
    adminComments(filter: $filter, first: $first, after: $after) {
      nodes {
        id
        excerpt
        author { ${USER_SUMMARY_SELECTION} }
        productName
        productId
        launchId
        launchNumber
        createdAt
        state
        latestHide { ${NOTE_SELECTION} }
      }
      ${PAGE_INFO_SELECTION}
    }
  }
`;

export const ADMIN_RATINGS = /* GraphQL */ `
  query AdminRatings(
    $filter: AdminRatingFilter
    $first: Int!
    $after: String
  ) {
    adminRatings(filter: $filter, first: $first, after: $after) {
      nodes { ${RATING_SELECTION} }
      ${PAGE_INFO_SELECTION}
    }
  }
`;

export const ADMIN_QUARANTINED_IMAGES = /* GraphQL */ `
  query AdminQuarantinedImages($reason: QuarantineReason!, $after: String) {
    adminQuarantinedImages(reason: $reason, after: $after) {
      items {
        file { ${MEDIA_FILE_SELECTION} }
        purpose
        owner {
          kind
          id
          nickname
          handle
        }
        quarantinedAt
        findings
      }
      nextCursor
    }
  }
`;

const requiredReasonMutation = (
  operation: string,
  field: string,
) => /* GraphQL */ `
  mutation ${operation}($id: ID!, $reason: String!) {
    ${field}(id: $id, reason: $reason) {
      changed
    }
  }
`;

const imageMutation = (operation: string, field: string) => /* GraphQL */ `
  mutation ${operation}($fileId: ID!, $reason: String) {
    ${field}(fileId: $fileId, reason: $reason) {
      changed
    }
  }
`;

export const TARGET_MODERATIONS = Object.freeze({
  hideProduct: requiredReasonMutation('AdminHideProduct', 'hideProduct'),
  unhideProduct: requiredReasonMutation('AdminUnhideProduct', 'unhideProduct'),
  hideComment: requiredReasonMutation('AdminHideComment', 'hideComment'),
  unhideComment: requiredReasonMutation('AdminUnhideComment', 'unhideComment'),
  invalidateRating: requiredReasonMutation(
    'AdminInvalidateRating',
    'invalidateRating',
  ),
  revalidateRating: requiredReasonMutation(
    'AdminRevalidateRating',
    'revalidateRating',
  ),
});

export const IMAGE_MODERATIONS = Object.freeze({
  approveQuarantinedImage: imageMutation(
    'AdminApproveQuarantinedImage',
    'approveQuarantinedImage',
  ),
  quarantineImage: imageMutation('AdminQuarantineImage', 'quarantineImage'),
  releaseQuarantinedImage: imageMutation(
    'AdminReleaseQuarantinedImage',
    'releaseQuarantinedImage',
  ),
  deleteQuarantinedImage: imageMutation(
    'AdminDeleteQuarantinedImage',
    'deleteQuarantinedImage',
  ),
});

export type TargetModeration = keyof typeof TARGET_MODERATIONS;

export type ImageModeration = keyof typeof IMAGE_MODERATIONS;

const testClock: Clock = { now: () => MODERATION_TEST_NOW };

const publishedTypes: string[] = [];

const failingTypes = new Set<string>();

// 通知と移動の依頼をキューへ送らずに記録し、指定した種類だけ送信の失敗を起こす
const recordingPublisher: MessagePublisher = {
  publish: (contract) => {
    if (failingTypes.has(contract.type)) {
      return Promise.reject(new Error('キューへ送れません'));
    }
    publishedTypes.push(contract.type);
    return Promise.resolve(crypto.randomUUID());
  },
};

const overridesModule: AppModule<GatewayApp> = {
  name: 'moderation-content-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher).toConstantValue(
      recordingPublisher,
    );
  }),
};

const gateway = createGraphQLGateway({
  documents: [
    ADMIN_PRODUCTS,
    ADMIN_PRODUCT,
    ADMIN_MODERATION_CATEGORY_OPTIONS,
    ADMIN_PRODUCT_RATINGS,
    ADMIN_COMMENTS,
    ADMIN_RATINGS,
    ADMIN_QUARANTINED_IMAGES,
    ...Object.values(TARGET_MODERATIONS),
    ...Object.values(IMAGE_MODERATIONS),
  ],
  schemaModules: [moderationSchemaModule],
  overrides: [overridesModule],
});

export const MODERATION_ADMINS = Object.freeze({
  superAdmin: 1,
  moderator: 2,
  viewer: 3,
});

const ADMIN_ROLES: readonly (readonly [number, AdminRole])[] = [
  [MODERATION_ADMINS.superAdmin, 'super_admin'],
  [MODERATION_ADMINS.moderator, 'moderator'],
  [MODERATION_ADMINS.viewer, 'viewer'],
];

const adminSessionTokens = new Map<number, string>();

export function asModerationAdmin(adminIndex: number): GatewayCallOptions {
  const sessionToken = adminSessionTokens.get(adminIndex);
  if (sessionToken === undefined) {
    throw new Error(`管理者${String(adminIndex)}のセッションがありません`);
  }
  return { caller: 'admin', sessionToken };
}

export const asViewer = (): GatewayCallOptions =>
  asModerationAdmin(MODERATION_ADMINS.viewer);

export const asModerator = (): GatewayCallOptions =>
  asModerationAdmin(MODERATION_ADMINS.moderator);

export function failPublishing(type: string): void {
  failingTypes.add(type);
}

export function readPublishedTypes(): readonly string[] {
  return [...publishedTypes];
}

// 各テストの前に利用者・プロダクト・ローンチ・マッチ・コメント・評価・画像・措置の記録・監査ログと管理者の表を空にし、3人の管理者とそのセッションを用意する
export function installModerationContentGraphQLTest(): void {
  beforeEach(async () => {
    publishedTypes.length = 0;
    failingTypes.clear();
    await clearModerationWrites();
    await clearMediaState();
    await db.delete(productRatings);
    await db.delete(launchComments);
    await clearMatchTables();
    await clearAdminTables();
    adminSessionTokens.clear();
    for (const [index, role] of ADMIN_ROLES) {
      await insertAdmin(index, { role });
      // セッションの検証は差し替えた時計で行われるため、発行も同じ時刻で行う
      const issued = await issueAdminSession(adminIdOf(index), {
        now: MODERATION_TEST_NOW,
      });
      adminSessionTokens.set(index, issued.token);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function fetchAdminProducts(
  variables: {
    readonly filter?: Record<string, unknown>;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return gateway.call<{
    adminProducts: Connection<AdminProductFields> | null;
  }>(ADMIN_PRODUCTS, variables, options);
}

export function fetchAdminProduct(id: string, options?: GatewayCallOptions) {
  return gateway.call<{ adminProduct: AdminProductDetailFields | null }>(
    ADMIN_PRODUCT,
    { id },
    options,
  );
}

export function fetchCategoryOptions(options?: GatewayCallOptions) {
  return gateway.call<{
    adminModerationCategoryOptions:
      readonly { readonly id: string; readonly name: string }[] | null;
  }>(ADMIN_MODERATION_CATEGORY_OPTIONS, {}, options);
}

export function fetchAdminProductRatings(
  variables: {
    readonly productId: string;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return gateway.call<{
    adminProductRatings: Connection<AdminRatingFields> | null;
  }>(ADMIN_PRODUCT_RATINGS, variables, options);
}

export function fetchAdminComments(
  variables: {
    readonly filter?: Record<string, unknown>;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return gateway.call<{
    adminComments: Connection<AdminCommentFields> | null;
  }>(ADMIN_COMMENTS, variables, options);
}

export function fetchAdminRatings(
  variables: {
    readonly filter?: Record<string, unknown>;
    readonly first: number;
    readonly after?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return gateway.call<{
    adminRatings: Connection<AdminRatingFields> | null;
  }>(ADMIN_RATINGS, variables, options);
}

export function fetchQuarantinedImages(
  variables: { readonly reason: string; readonly after?: string | null },
  options?: GatewayCallOptions,
) {
  return gateway.call<{
    adminQuarantinedImages: {
      readonly items: readonly AdminQuarantinedImageFields[];
      readonly nextCursor: string | null;
    } | null;
  }>(ADMIN_QUARANTINED_IMAGES, variables, options);
}

export type ModerationResponse = GatewayResponse<
  Record<string, { readonly changed: boolean } | null>
>;

export function moderateTarget(
  operation: TargetModeration,
  variables: { readonly id: string; readonly reason: string },
  options?: GatewayCallOptions,
): Promise<ModerationResponse> {
  return gateway.call(TARGET_MODERATIONS[operation], variables, options);
}

export function moderateImage(
  operation: ImageModeration,
  variables: { readonly fileId: string; readonly reason?: string | null },
  options?: GatewayCallOptions,
): Promise<ModerationResponse> {
  return gateway.call(IMAGE_MODERATIONS[operation], variables, options);
}
