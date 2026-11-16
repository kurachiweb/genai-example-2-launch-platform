import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import { bracketMatches } from '../../../db/schema/tournament/bracket-matches.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type {
  BracketProgression,
  BracketStore,
} from '../../core/tournament/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { dailyRoundPolicy } from '../../core/tournament/round-schedule.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { createMatchPlatformModule } from '../match/match-platform-module.ts';
import { db } from '../product/testing/product-fixtures.ts';
import { D1BracketProgression } from './d1-bracket-progression.ts';
import { D1BracketStore } from './d1-bracket-store.ts';
import {
  SAMPLE_BRACKET_ID,
  SAMPLE_ENTRY_REFS,
  SAMPLE_MATCH_ID,
  SAMPLE_TOURNAMENT_ID,
  seedTournamentPlatformSample,
} from './testing/tournament-platform-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from './testing/observability-fixtures.ts';
import { createTournamentPlatformModule } from './tournament-platform-module.ts';

const FIRST_ROUND_DATE = parseBusinessDate('2026-11-24');

const PROGRESSED_AT = new Date('2026-11-24T07:45:00.000Z');

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
  appName: LoggingOptions['appName'] = 'api',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [
      createMatchPlatformModule(appName),
      createTournamentPlatformModule(appName),
    ],
  );
}

beforeEach(seedTournamentPlatformSample);

describe('createTournamentPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const module = createTournamentPlatformModule('api');
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      module,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(module.name).toBe('tournament-platform');
    expect('routes' in module).toBe(false);
  });

  test('進行の遅れのログを、渡したアプリの名前で始まるカテゴリに出す', async () => {
    const logs = recordLogs('event');
    installRecordingSentry();
    await db
      .update(bracketMatches)
      .set({ status: 'planned' })
      .where(eq(bracketMatches.matchId, SAMPLE_MATCH_ID));
    const progression = createContainer(
      'scheduled',
      'event',
    ).get<BracketProgression>(TOURNAMENT_PLATFORM_TYPES.BracketProgression);
    const afterMidnight = new Date('2026-11-24T08:10:00.000Z');

    try {
      await expect(
        progression.advance(
          SAMPLE_BRACKET_ID,
          dailyRoundPolicy(FIRST_ROUND_DATE, afterMidnight),
          afterMidnight,
        ),
      ).resolves.toMatchObject({ kind: 'scheduled', round: 1, late: true });
      expect(logs).toEqual([
        expect.objectContaining({
          level: 'warning',
          category: 'event.tournament.progression',
          bracketId: SAMPLE_BRACKET_ID,
          matchIds: [SAMPLE_MATCH_ID],
        }),
      ]);
    } finally {
      resetObservability();
    }
  });

  test('ブラケットのストアをD1の実装に解決し、マッチのIDからブラケットを引ける', async () => {
    const store = createContainer().get<BracketStore>(
      TOURNAMENT_PLATFORM_TYPES.BracketStore,
    );

    expect(store).toBeInstanceOf(D1BracketStore);
    await expect(store.findByMatchIds([SAMPLE_MATCH_ID])).resolves.toEqual(
      new Map([
        [
          SAMPLE_MATCH_ID,
          {
            bracketId: SAMPLE_BRACKET_ID,
            kind: 'week',
            tournamentId: SAMPLE_TOURNAMENT_ID,
          },
        ],
      ]),
    );
    await expect(
      store.findAliveRefs('week', SAMPLE_ENTRY_REFS),
    ).resolves.toEqual(new Set(SAMPLE_ENTRY_REFS));
  });

  test('ラウンドの進行をマッチの共通の束縛と組んだD1の実装に解決し、未確定の決勝を予定済みのブラケットを進めると予定済みの結果を返す', async () => {
    const progression = createContainer().get<BracketProgression>(
      TOURNAMENT_PLATFORM_TYPES.BracketProgression,
    );

    expect(progression).toBeInstanceOf(D1BracketProgression);
    await expect(
      progression.advance(
        SAMPLE_BRACKET_ID,
        dailyRoundPolicy(FIRST_ROUND_DATE, PROGRESSED_AT),
        PROGRESSED_AT,
      ),
    ).resolves.toEqual({
      kind: 'scheduled',
      bracketId: SAMPLE_BRACKET_ID,
      round: 1,
      late: false,
      decidedMatchIds: [],
      previewMatchIds: [SAMPLE_MATCH_ID],
    });
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でもブラケットのストアと進行を解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get(TOURNAMENT_PLATFORM_TYPES.BracketStore),
      ).toBeInstanceOf(D1BracketStore);
      expect(
        container.get(TOURNAMENT_PLATFORM_TYPES.BracketProgression),
      ).toBeInstanceOf(D1BracketProgression);
    },
  );

  test.each([
    TOURNAMENT_PLATFORM_TYPES.BracketStore,
    TOURNAMENT_PLATFORM_TYPES.BracketProgression,
  ])(
    '%sは処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す',
    (identifier) => {
      const first = createContainer();
      const second = createContainer();

      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    },
  );
});
