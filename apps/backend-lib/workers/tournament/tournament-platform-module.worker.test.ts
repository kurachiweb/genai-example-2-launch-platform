import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, expectTypeOf, test } from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../core/tournament/identifiers.ts';
import type { BracketStore } from '../../core/tournament/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1BracketStore } from './d1-bracket-store.ts';
import {
  SAMPLE_BRACKET_ID,
  SAMPLE_ENTRY_REFS,
  SAMPLE_MATCH_ID,
  SAMPLE_TOURNAMENT_ID,
  seedTournamentPlatformSample,
} from './testing/tournament-platform-fixtures.ts';
import { TOURNAMENT_PLATFORM_MODULE } from './tournament-platform-module.ts';

function createContainer(
  kind: InvocationScopeInfo['kind'] = 'fetch',
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
    [TOURNAMENT_PLATFORM_MODULE],
  );
}

beforeEach(seedTournamentPlatformSample);

describe('TOURNAMENT_PLATFORM_MODULE', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      TOURNAMENT_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(TOURNAMENT_PLATFORM_MODULE.name).toBe('tournament-platform');
    expect('routes' in TOURNAMENT_PLATFORM_MODULE).toBe(false);
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

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でもブラケットのストアを解決する',
    (kind) => {
      expect(
        createContainer(kind).get(TOURNAMENT_PLATFORM_TYPES.BracketStore),
      ).toBeInstanceOf(D1BracketStore);
    },
  );

  test('ストアは処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();
    const identifier = TOURNAMENT_PLATFORM_TYPES.BracketStore;

    expect(first.get(identifier)).toBe(first.get(identifier));
    expect(second.get(identifier)).not.toBe(first.get(identifier));
  });
});
