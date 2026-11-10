import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { qualifierPairings } from '../../db/schema/match/qualifier-pairings.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { DURING_MATCH } from '../../lib/workers/match/testing/directory-fixtures.ts';
import {
  clearMatchTables,
  MATCH_DATE,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  db,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import type { GraphQLContext } from '../../src/presentation/graphql/graphql-context.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { matchSchemaModule } from '../../src/presentation/graphql/modules/match/index.ts';
import { loadMatchView } from '../../src/presentation/graphql/modules/match/match-views.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { defineSchemaModule } from '../../src/presentation/graphql/schema-module.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';
import type {
  MediaImageFields,
  ProductCategoryFields,
} from './product-graphql-documents.ts';

export interface MatchProductFields {
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly category: ProductCategoryFields;
  readonly websiteUrl: string;
  readonly logo: MediaImageFields | null;
  readonly listed: boolean;
}

export interface MatchEntryFields {
  readonly id: string;
  readonly product: MatchProductFields | null;
  readonly isViewerOwn: boolean;
  readonly upvoteCount: number;
  readonly result: 'WON' | 'LOST' | 'BYE' | 'WALKOVER' | null;
  readonly colorIndex: number;
}

export interface MatchFields {
  readonly id: string;
  readonly kind: 'QUALIFIER' | 'WEEK' | 'YEAR';
  readonly round: number | null;
  readonly stage: 'QUARTERFINAL' | 'SEMIFINAL' | 'FINAL' | null;
  readonly date: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly phase: 'SCHEDULED' | 'LIVE' | 'TALLYING' | 'FINISHED';
  readonly decision:
    | 'VOTES'
    | 'LAST_UPVOTE'
    | 'NO_VOTES'
    | 'BYE'
    | 'WALKOVER'
    | 'BOTH_FORFEITED'
    | null;
  readonly endedEarly: boolean;
  readonly entries: readonly MatchEntryFields[];
  readonly viewerUpvotedEntryId: string | null;
  readonly viewerRestriction:
    | 'GUEST'
    | 'EMAIL_NOT_VERIFIED'
    | 'ACCOUNT_UNAVAILABLE'
    | 'OWN_MATCH'
    | 'NOT_ACCEPTING'
    | null;
}

export interface QualifierBoardFields {
  readonly date: string;
  readonly serverTime: string;
  readonly phase: 'LIVE' | 'RESULT';
  readonly fullTimeAt: string;
  readonly nextKickoffAt: string;
  readonly awaitingKickoff: boolean;
  readonly heldCount: number;
  readonly matches: readonly MatchFields[];
  readonly byes: readonly {
    readonly match: MatchFields;
    readonly entry: MatchEntryFields;
    readonly reason: 'ABSENT' | 'FORFEIT' | 'EARLY';
  }[];
}

// GraphQL Armorの深さの上限はフラグメントの展開も1段に数えるため、項目を直接書く
const MATCH_ENTRY_SELECTION = /* GraphQL */ `
  id
  product {
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
    listed
  }
  isViewerOwn
  upvoteCount
  result
  colorIndex
`;

const MATCH_SELECTION = /* GraphQL */ `
  id
  kind
  round
  stage
  date
  startsAt
  endsAt
  phase
  decision
  endedEarly
  entries {
    ${MATCH_ENTRY_SELECTION}
  }
  viewerUpvotedEntryId
  viewerRestriction
`;

export const QUALIFIER_BOARD = /* GraphQL */ `
  query QualifierBoard {
    qualifierBoard {
      date
      serverTime
      phase
      fullTimeAt
      nextKickoffAt
      awaitingKickoff
      heldCount
      matches {
        ${MATCH_SELECTION}
      }
      byes {
        match {
          ${MATCH_SELECTION}
        }
        entry {
          ${MATCH_ENTRY_SELECTION}
        }
        reason
      }
    }
  }
`;

export const MATCH_VIEWS = /* GraphQL */ `
  query MatchViews($ids: [ID!]!) {
    matchViews(ids: $ids) {
      ${MATCH_SELECTION}
    }
  }
`;

interface IdsArgs {
  readonly ids: readonly string[];
}

// 後続specが自分の型の項目からMatchを返す形を、テスト用の項目で再現する
const matchConsumerSchemaModule = defineSchemaModule({
  name: 'match-consumer',
  typeDefs: /* GraphQL */ `
    type Query {
      matchViews(ids: [ID!]!): [Match]!
    }
  `,
  resolvers: {
    Query: {
      matchViews: (_parent: unknown, args: IdsArgs, context: GraphQLContext) =>
        Promise.all(args.ids.map((id) => loadMatchView(context, id))),
    },
  },
});

let currentNow = DURING_MATCH;

const testClock: Clock = { now: () => currentNow };

// マッチの状態と業務日付が実行の時刻で変わらないよう、時計を固定する
export function setMatchTestNow(now: Date): void {
  currentNow = now;
}

const clockModule: AppModule<GatewayApp> = {
  name: 'match-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

const matchGateway = createGraphQLGateway({
  documents: [QUALIFIER_BOARD, MATCH_VIEWS],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    matchSchemaModule,
    matchConsumerSchemaModule,
  ],
  overrides: [clockModule],
});

// 各テストの前にマッチ・プロダクト・利用者・ファイルのテーブルを空にし、時計をマッチ中の時刻へ戻す
export function installMatchGraphQLTest(): void {
  beforeEach(async () => {
    currentNow = DURING_MATCH;
    await clearMediaTables();
    await clearMatchTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// セッションの検証が固定の時計で行われるため、発行も同じ時刻で行う
export async function issueMatchUserSession(
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
      now: currentNow,
    });
  return issued.token;
}

export async function completePairingDay(date: string = MATCH_DATE) {
  await db.insert(qualifierPairings).values({
    id: `01JD0PAIR${date.replaceAll('-', '').padStart(17, '0')}`,
    matchDate: date,
    status: 'completed',
    launchCount: 0,
    matchCount: 0,
    completedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function fetchQualifierBoard(options?: GatewayCallOptions) {
  return matchGateway.call<{ qualifierBoard: QualifierBoardFields | null }>(
    QUALIFIER_BOARD,
    {},
    options,
  );
}

export function fetchMatchViews(
  ids: readonly string[],
  options?: GatewayCallOptions,
) {
  return matchGateway.call<{ matchViews: readonly (MatchFields | null)[] }>(
    MATCH_VIEWS,
    { ids },
    options,
  );
}
