import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import { matches } from '../../db/schema/match/matches.ts';
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
import type { Database } from '../../db/client.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearDirectoryTables } from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import { matchIdOf } from '../../lib/workers/match/testing/match-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { D1UserProfileDirectory } from '../../lib/workers/profile/d1-user-profile-directory.ts';
import {
  clearProductTables,
  db,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { DIRECTORY_TYPES } from '../../src/application/directory/directory-types.ts';
import type {
  DirectoryItemMetricSource,
  RegisteredItemMetricSource,
} from '../../src/application/directory/item-metric-sources.ts';
import type {
  LaunchSummarySource,
  RegisteredDecisionSource,
} from '../../src/application/product/decision-sources.ts';
import { PRODUCT_TYPES } from '../../src/application/product/product-types.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { directorySchemaModule } from '../../src/presentation/graphql/modules/directory/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import type {
  MediaImageFields,
  ProductAwardFields,
  ProductCategoryFields,
} from './product-graphql-documents.ts';

// 業務日付と照会の時刻で決まる値が実行の時刻で変わらないよう、時計を業務時刻の2026-11-10 12:00に固定する
export const DIRECTORY_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-11-10'),
  { hour: 12, minute: 0 },
);

const testClock: Clock = { now: () => DIRECTORY_TEST_NOW };

const fixedClockModule: AppModule<GatewayApp> = {
  name: 'directory-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

type LaunchSummaryAnswer = Awaited<
  ReturnType<LaunchSummarySource['summarize']>
>;

const EMPTY_SUMMARY_ANSWER: LaunchSummaryAnswer = Object.freeze({
  launches: [],
  awards: [],
});

let summaryAnswer: LaunchSummaryAnswer = EMPTY_SUMMARY_ANSWER;

// 結果の要約と受賞の供給元を1つ登録し、この関数を呼んだテストの間だけ指定した答えを返させる
export function answerDirectoryLaunchSummaries(
  answer: LaunchSummaryAnswer,
): void {
  summaryAnswer = answer;
}

const testSummarySource: LaunchSummarySource = {
  summarize: () => Promise.resolve(summaryAnswer),
};

let metricAnswer: ReadonlyMap<string, number> | Error = new Map();

// 項目の値の供給元をkey「comments」で1つ登録し、この関数を呼んだテストの間だけ指定した値を返させる。Errorを渡すと例外を投げる
export function answerDirectoryItemMetrics(
  answer: ReadonlyMap<string, number> | Error,
): void {
  metricAnswer = answer;
}

const testMetricSource: DirectoryItemMetricSource = {
  metrics: () =>
    metricAnswer instanceof Error
      ? Promise.reject(metricAnswer)
      : Promise.resolve(metricAnswer),
};

let hiddenOwnerIds: ReadonlySet<string> = new Set();

// 一覧の照会の後に投稿者が退会・停止した競合を再現するため、指定した利用者を利用者の要約の照会からだけ除く
export function hideDirectoryOwnerSummaries(
  userIndexes: readonly number[],
): void {
  hiddenOwnerIds = new Set(userIndexes.map(userIdOf));
}

const sourcesModule: AppModule<GatewayApp> = {
  name: 'directory-graphql-test-sources',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<readonly RegisteredDecisionSource<LaunchSummarySource>[]>(
      PRODUCT_TYPES.LaunchSummarySources,
    ).toConstantValue([
      { name: 'directory-test.summary', source: testSummarySource },
    ]);
    rebind<readonly RegisteredItemMetricSource[]>(
      DIRECTORY_TYPES.ItemMetricSources,
    ).toConstantValue([
      {
        name: 'directory-test.comments',
        key: 'comments',
        source: testMetricSource,
      },
    ]);
  }),
};

// 利用者の要約の照会だけを包み、hideDirectoryOwnerSummariesで指定した利用者を除く
const ownerHidingModule: AppModule<GatewayApp> = {
  name: 'directory-graphql-test-owner-hiding',
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
            [...found].filter(([userId]) => !hiddenOwnerIds.has(userId)),
          );
        },
      };
    });
  }),
};

export const DIRECTORY = /* GraphQL */ `
  query Directory($input: DirectoryInput!) {
    directory(input: $input) {
      applied {
        q
        category
        from
        to
        sort
        page
      }
      searchTerms
      businessToday
      totalCount
      page
      pageCount
      items {
        handle
        name
        tagline
        category {
          id
          name
          handle
          systemDefault
        }
        websiteUrl
        logo {
          id
          objectKey
        }
        owner {
          handle
          nickname
          avatar {
            id
          }
        }
        isViewerOwn
        awards {
          kind
          count
          labels
        }
        win {
          launchDate
          kind
          upvoteCount
        }
        metrics {
          key
          value
        }
      }
    }
  }
`;

export const DIRECTORY_CATEGORIES = /* GraphQL */ `
  query DirectoryCategories {
    directoryCategories {
      id
      name
      handle
      systemDefault
    }
  }
`;

export interface DirectoryAppliedFields {
  readonly q: string | null;
  readonly category: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: 'RELEVANCE' | 'NEWEST' | 'OLDEST' | 'UPVOTES' | null;
  readonly page: number | null;
}

export interface DirectoryItemFields {
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryFields;
  readonly websiteUrl: string;
  readonly logo: MediaImageFields | null;
  readonly owner: {
    readonly handle: string;
    readonly nickname: string;
    readonly avatar: { readonly id: string } | null;
  } | null;
  readonly isViewerOwn: boolean;
  readonly awards: readonly ProductAwardFields[];
  readonly win: {
    readonly launchDate: string;
    readonly kind: 'VICTORY' | 'BYE' | 'EARLY';
    readonly upvoteCount: number | null;
  };
  readonly metrics: readonly { readonly key: string; readonly value: number }[];
}

export interface DirectoryPageFields {
  readonly applied: DirectoryAppliedFields;
  readonly searchTerms: readonly string[];
  readonly businessToday: string;
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly items: readonly DirectoryItemFields[];
}

const directoryGateway = createGraphQLGateway({
  documents: [DIRECTORY, DIRECTORY_CATEGORIES],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    directorySchemaModule,
  ],
  overrides: [fixedClockModule, sourcesModule, ownerHidingModule],
});

// 各テストの前にディレクトリ・マッチ・プロダクト・利用者・ファイルのテーブルと供給元の答えを空にする
export function installDirectoryGraphQLTest(): void {
  beforeEach(async () => {
    summaryAnswer = EMPTY_SUMMARY_ANSWER;
    metricAnswer = new Map();
    hiddenOwnerIds = new Set();
    await clearDirectoryTables();
    await clearMediaTables();
    await clearProductTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// セッションの検証が固定の時計で行われるため、発行も同じ時刻で行う
export async function issueDirectoryUserSession(
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
      now: DIRECTORY_TEST_NOW,
    });
  return issued.token;
}

// 予選のマッチをマッチ中の相手の該当による即時の終了にする
export async function markMatchEndedEarly(matchIndex: number): Promise<void> {
  await db
    .update(matches)
    .set({ endedEarlyAt: DIRECTORY_TEST_NOW })
    .where(eq(matches.id, matchIdOf(matchIndex)));
}

export function fetchDirectory(
  input: Readonly<Record<string, string | null>>,
  options?: GatewayCallOptions,
) {
  return directoryGateway.call<{ directory: DirectoryPageFields | null }>(
    DIRECTORY,
    { input },
    options,
  );
}

export function fetchDirectoryCategories(options?: GatewayCallOptions) {
  return directoryGateway.call<{
    directoryCategories: readonly ProductCategoryFields[] | null;
  }>(DIRECTORY_CATEGORIES, {}, options);
}
