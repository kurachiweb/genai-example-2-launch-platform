import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import {
  addBusinessDays,
  fromBusinessDateTime,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  clearYearTournamentTables,
  YEAR_SCHEDULE,
} from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import { matchSchemaModule } from '../../src/presentation/graphql/modules/match/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { weekTournamentSchemaModule } from '../../src/presentation/graphql/modules/week-tournament/index.ts';
import { yearTournamentSchemaModule } from '../../src/presentation/graphql/modules/year-tournament/index.ts';
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
import {
  BRACKET_ROUND_SELECTION,
  type BracketRoundFields,
  BYE_ENTRY_SELECTION,
} from './week-tournament-graphql-operations.ts';

// 2027年の既定の決勝日は5/30(日)。参加16の1回戦は3日前の5/27に行う
export const YEAR_FINAL_DATE = YEAR_SCHEDULE.finalDate;

export const YEAR_BOARD_DATE = addBusinessDays(YEAR_FINAL_DATE, -3);

// トップページの区画の1回戦のマッチ中の時刻
export const YEAR_TEST_NOW = fromBusinessDateTime(YEAR_BOARD_DATE, {
  hour: 12,
  minute: 0,
});

export interface YearTournamentSummaryFields {
  readonly year: number;
  readonly label: string;
  readonly finalDate: string;
  readonly firstRoundDate: string | null;
  readonly status: 'OPEN' | 'DRAWING' | 'IN_PROGRESS' | 'FINISHED';
  readonly awarded: boolean | null;
}

export interface YearTournamentRoundBoardFields {
  readonly tournament: YearTournamentSummaryFields;
  readonly round: number;
  readonly roundName: string;
  readonly final: boolean;
  readonly finalDate: string;
  readonly matches: readonly MatchFields[];
  readonly byes: readonly {
    readonly match: Pick<
      MatchFields,
      'id' | 'kind' | 'round' | 'decision' | 'endedEarly'
    >;
    readonly entry: MatchEntryFields;
    readonly reason: 'ABSENT' | 'FORFEIT' | 'EARLY';
  }[];
  readonly bracketPath: string;
}

export interface YearTournamentBoardFields {
  readonly date: string;
  readonly serverTime: string;
  readonly rounds: readonly YearTournamentRoundBoardFields[];
}

export interface YearBracketFields {
  readonly tournament: YearTournamentSummaryFields;
  readonly participantCount: number;
  readonly seedCount: number;
  readonly rounds: readonly BracketRoundFields[];
  readonly champion: MatchProductFields | null;
}

const SUMMARY_SELECTION = /* GraphQL */ `
  year
  label
  finalDate
  firstRoundDate
  status
  awarded
`;

export const YEAR_TOURNAMENT_BOARD = /* GraphQL */ `
  query YearTournamentBoard($date: String!) {
    yearTournamentBoard(date: $date) {
      date
      serverTime
      rounds {
        tournament {
          ${SUMMARY_SELECTION}
        }
        round
        roundName
        final
        finalDate
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

export const YEAR_BRACKET = /* GraphQL */ `
  query YearBracket($year: String!) {
    yearBracket(year: $year) {
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

let currentNow = YEAR_TEST_NOW;

const testClock: Clock = { now: () => currentNow };

// マッチの状態・業務日付・ブラケットの見込みの日が実行の時刻で変わらないよう、時計を固定する
export function setYearTestNow(now: Date): void {
  currentNow = now;
}

const clockModule: AppModule<GatewayApp> = {
  name: 'year-tournament-graphql-test-clock',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
  }),
};

// Yearのブラケットはtournament-weekのブラケットの型とリゾルバを使い、Weekの型定義はpaymentsの型を参照するため、両方のスキーマモジュールを載せる
const yearGateway = createGraphQLGateway({
  documents: [YEAR_TOURNAMENT_BOARD, YEAR_BRACKET],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    matchSchemaModule,
    paymentsSchemaModule,
    weekTournamentSchemaModule,
    yearTournamentSchemaModule,
  ],
  overrides: [clockModule],
});

// 各テストの前にトーナメント・マッチ・プロダクト・利用者・ファイルのテーブルを空にし、時計を1回戦のマッチ中へ戻す
export function installYearTournamentGraphQLTest(): void {
  beforeEach(async () => {
    currentNow = YEAR_TEST_NOW;
    await clearMediaTables();
    await clearYearTournamentTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function fetchYearTournamentBoard(
  date: string,
  options?: GatewayCallOptions,
) {
  return yearGateway.call<{
    yearTournamentBoard: YearTournamentBoardFields | null;
  }>(YEAR_TOURNAMENT_BOARD, { date }, options);
}

export function fetchYearBracket(year: string, options?: GatewayCallOptions) {
  return yearGateway.call<{ yearBracket: YearBracketFields | null }>(
    YEAR_BRACKET,
    { year },
    options,
  );
}
