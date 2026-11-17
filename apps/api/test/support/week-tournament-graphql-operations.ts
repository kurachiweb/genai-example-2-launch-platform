import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../lib/core/tournament/ports.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearWeekTournamentTables } from '../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import { MATCH_TYPES } from '../../src/application/match/match-types.ts';
import type { MatchViewReader } from '../../src/application/match/match-view-reader.ts';
import { buildBracketRoundsView } from '../../src/application/tournament/bracket-view-builder.ts';
import type { GraphQLContext } from '../../src/presentation/graphql/graphql-context.ts';
import { matchSchemaModule } from '../../src/presentation/graphql/modules/match/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { weekTournamentSchemaModule } from '../../src/presentation/graphql/modules/week-tournament/index.ts';
import { defineSchemaModule } from '../../src/presentation/graphql/schema-module.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import {
  MATCH_SELECTION,
  type MatchEntryFields,
  type MatchFields,
  type MatchProductFields,
} from './match-graphql-operations.ts';

// トップページの区画の業務日付。1回戦(2026-11-24)のマッチ中の時刻に時計を固定する
export const BOARD_DATE = '2026-11-24';

export const WEEK_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate(BOARD_DATE),
  { hour: 12, minute: 0 },
);

export interface WeekTournamentSummaryFields {
  readonly week: string;
  readonly label: string;
  readonly firstRoundDate: string | null;
  readonly finalDate: string | null;
  readonly status: 'OPEN' | 'DRAWING' | 'IN_PROGRESS' | 'FINISHED';
  readonly awarded: boolean | null;
}

export interface WeekTournamentRoundBoardFields {
  readonly tournament: WeekTournamentSummaryFields;
  readonly round: number;
  readonly roundName: string;
  readonly final: boolean;
  readonly matches: readonly MatchFields[];
  readonly byes: readonly {
    readonly match: MatchFields;
    readonly entry: MatchEntryFields;
    readonly reason: 'ABSENT' | 'FORFEIT' | 'EARLY';
  }[];
  readonly bracketPath: string;
}

export interface WeekTournamentBoardFields {
  readonly date: string;
  readonly serverTime: string;
  readonly rounds: readonly WeekTournamentRoundBoardFields[];
}

export interface BracketSlotFields {
  readonly participantNo: number | null;
  readonly seed: number | null;
  readonly feedLabel: string | null;
  readonly product: { readonly handle: string; readonly name: string } | null;
  readonly upvoteCount: number | null;
  readonly result: MatchEntryFields['result'];
}

export interface BracketRoundFields {
  readonly round: number;
  readonly name: string;
  readonly date: string;
  readonly nodes: readonly {
    readonly position: number;
    readonly match: {
      readonly id: string;
      readonly kind: MatchFields['kind'];
      readonly phase: MatchFields['phase'];
      readonly decision: MatchFields['decision'];
    } | null;
    readonly slots: readonly BracketSlotFields[];
  }[];
}

export interface WeekBracketFields {
  readonly tournament: WeekTournamentSummaryFields;
  readonly participantCount: number;
  readonly seedCount: number;
  readonly rounds: readonly BracketRoundFields[];
  readonly champion: MatchProductFields | null;
}

export interface TrophyFields {
  readonly kind: 'WEEK' | 'YEAR';
  readonly period: string;
  readonly periodLabel: string;
  readonly awardedAt: string;
  readonly bracketPath: string | null;
}

const SUMMARY_SELECTION = /* GraphQL */ `
  week
  label
  firstRoundDate
  finalDate
  status
  awarded
`;

const BYE_ENTRY_SELECTION = /* GraphQL */ `
  id
  product {
    handle
    name
  }
  isViewerOwn
  upvoteCount
  result
  colorIndex
`;

export const WEEK_TOURNAMENT_BOARD = /* GraphQL */ `
  query WeekTournamentBoard($date: String!) {
    weekTournamentBoard(date: $date) {
      date
      serverTime
      rounds {
        tournament {
          ${SUMMARY_SELECTION}
        }
        round
        roundName
        final
        matches {
          ${MATCH_SELECTION}
        }
        byes {
          match {
            id
            kind
            round
            decision
            endedEarly
          }
          entry {
            ${BYE_ENTRY_SELECTION}
          }
          reason
        }
        bracketPath
      }
    }
  }
`;

const BRACKET_ROUND_SELECTION = /* GraphQL */ `
  round
  name
  date
  nodes {
    position
    match {
      id
      kind
      phase
      decision
    }
    slots {
      participantNo
      seed
      feedLabel
      product {
        handle
        name
      }
      upvoteCount
      result
    }
  }
`;

export const WEEK_BRACKET = /* GraphQL */ `
  query WeekBracket($week: String!) {
    weekBracket(week: $week) {
      tournament {
        ${SUMMARY_SELECTION}
      }
      participantCount
      seedCount
      rounds {
        ${BRACKET_ROUND_SELECTION}
      }
      champion {
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
    }
  }
`;

export const PRODUCT_TROPHIES = /* GraphQL */ `
  query ProductTrophies($productHandle: String!) {
    productTrophies(productHandle: $productHandle) {
      kind
      period
      periodLabel
      awardedAt
      bracketPath
    }
  }
`;

export const CONSUMER_BRACKET_ROUNDS = /* GraphQL */ `
  query ConsumerBracketRounds($bracketId: ID!) {
    consumerBracketRounds(bracketId: $bracketId) {
      ${BRACKET_ROUND_SELECTION}
    }
  }
`;

interface BracketIdArgs {
  readonly bracketId: string;
}

// 後続spec(tournament-year)が自分の型の項目からBracketRoundを返す形を、WeekBracketを介さずにbuildBracketRoundsViewの値だけで再現する
const bracketConsumerSchemaModule = defineSchemaModule({
  name: 'bracket-consumer',
  typeDefs: /* GraphQL */ `
    type Query {
      consumerBracketRounds(bracketId: ID!): [BracketRound!]!
    }
  `,
  resolvers: {
    Query: {
      consumerBracketRounds: async (
        _parent: unknown,
        args: BracketIdArgs,
        context: GraphQLContext,
      ) => {
        const record = await context
          .resolve<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore)
          .findById(args.bracketId);
        if (record === undefined) {
          return [];
        }
        const matchViews = await context
          .resolve<MatchViewReader>(MATCH_TYPES.MatchViewReader)
          .findViews({
            matchIds: record.matches.map(({ matchId }) => matchId),
            viewer: undefined,
            now: WEEK_TEST_NOW,
          });
        return [
          ...buildBracketRoundsView({ record, matchViews, now: WEEK_TEST_NOW })
            .rounds,
        ];
      },
    },
  },
});

const testClock: Clock = { now: () => WEEK_TEST_NOW };

// マッチの状態・業務日付・受賞の範囲が実行の時刻で変わらないよう、時計を固定する
const clockModule: AppModule<GatewayApp> = {
  name: 'week-tournament-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

// Weekトーナメントの型定義は参加費の導線と決済の開始でpaymentsのMoney・CheckoutStartを参照するため、paymentsのスキーマモジュールも載せる
const weekGateway = createGraphQLGateway({
  documents: [
    WEEK_TOURNAMENT_BOARD,
    WEEK_BRACKET,
    PRODUCT_TROPHIES,
    CONSUMER_BRACKET_ROUNDS,
  ],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    matchSchemaModule,
    paymentsSchemaModule,
    weekTournamentSchemaModule,
    bracketConsumerSchemaModule,
  ],
  overrides: [clockModule],
});

// 各テストの前にトーナメント・マッチ・プロダクト・利用者・ファイルのテーブルを空にする
export function installWeekTournamentGraphQLTest(): void {
  beforeEach(async () => {
    await clearMediaTables();
    await clearWeekTournamentTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function fetchWeekTournamentBoard(
  date: string,
  options?: GatewayCallOptions,
) {
  return weekGateway.call<{
    weekTournamentBoard: WeekTournamentBoardFields | null;
  }>(WEEK_TOURNAMENT_BOARD, { date }, options);
}

export function fetchWeekBracket(week: string, options?: GatewayCallOptions) {
  return weekGateway.call<{ weekBracket: WeekBracketFields | null }>(
    WEEK_BRACKET,
    { week },
    options,
  );
}

export function fetchProductTrophies(
  productHandle: string,
  options?: GatewayCallOptions,
) {
  return weekGateway.call<{ productTrophies: readonly TrophyFields[] | null }>(
    PRODUCT_TROPHIES,
    { productHandle },
    options,
  );
}

export function fetchConsumerBracketRounds(
  bracketId: string,
  options?: GatewayCallOptions,
) {
  return weekGateway.call<{
    consumerBracketRounds: readonly BracketRoundFields[] | null;
  }>(CONSUMER_BRACKET_ROUNDS, { bracketId }, options);
}
