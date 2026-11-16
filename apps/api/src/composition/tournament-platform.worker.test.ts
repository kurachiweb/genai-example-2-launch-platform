import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { TOURNAMENT_PLATFORM_TYPES } from '../../lib/core/tournament/identifiers.ts';
import type {
  BracketDraw,
  BracketProgression,
  BracketStore,
} from '../../lib/core/tournament/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1BracketDraw } from '../../lib/workers/tournament/d1-bracket-draw.ts';
import { D1BracketProgression } from '../../lib/workers/tournament/d1-bracket-progression.ts';
import { D1BracketStore } from '../../lib/workers/tournament/d1-bracket-store.ts';
import {
  SAMPLE_BRACKET_ID,
  SAMPLE_MATCH_ID,
  SAMPLE_TOURNAMENT_ID,
  seedTournamentPlatformSample,
} from '../../lib/workers/tournament/testing/tournament-platform-fixtures.ts';
import { MODULES } from './modules.ts';

function createContainer(): Container {
  return createInvocationContainer(
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
}

beforeEach(seedTournamentPlatformSample);

describe('APIサーバーのモジュールの一覧へのトーナメントの登録', () => {
  test('トーナメントの共通の束縛を1つだけ持つ', () => {
    expect(
      MODULES.filter(({ name }) => name === 'tournament-platform'),
    ).toHaveLength(1);
  });
});

describe('APIサーバーのトーナメントの共通の束縛', () => {
  test('処理単位のコンテナからブラケットのストアをD1の実装に解決し、マッチのIDからブラケットを引ける', async () => {
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
  });

  test('処理単位のコンテナからラウンドの進行をD1の実装に解決する', () => {
    expect(
      createContainer().get<BracketProgression>(
        TOURNAMENT_PLATFORM_TYPES.BracketProgression,
      ),
    ).toBeInstanceOf(D1BracketProgression);
  });

  test('処理単位のコンテナから組み合わせの作成をD1の実装に解決する', () => {
    expect(
      createContainer().get<BracketDraw>(TOURNAMENT_PLATFORM_TYPES.BracketDraw),
    ).toBeInstanceOf(D1BracketDraw);
  });

  test.each(Object.entries(TOURNAMENT_PLATFORM_TYPES))(
    '処理単位のコンテナからTOURNAMENT_PLATFORM_TYPESの%sを解決できる',
    (_, identifier) => {
      expect(createContainer().get(identifier)).toBeDefined();
    },
  );
});
