import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { TOURNAMENT_PLATFORM_TYPES } from '../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../lib/core/tournament/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1BracketStore } from '../../lib/workers/tournament/d1-bracket-store.ts';
import {
  SAMPLE_BRACKET_ID,
  SAMPLE_MATCH_ID,
  SAMPLE_TOURNAMENT_ID,
  seedTournamentPlatformSample,
} from '../../lib/workers/tournament/testing/tournament-platform-fixtures.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'queue'] as const;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
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
    MODULES,
  );
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(seedTournamentPlatformSample);

describe('イベントサーバーのモジュールの一覧へのトーナメントの登録', () => {
  test('トーナメントの共通の束縛を1つだけ持つ', () => {
    expect(
      MODULES.filter(({ name }) => name === 'tournament-platform'),
    ).toHaveLength(1);
  });
});

describe.each(INVOCATION_KINDS)(
  'イベントサーバーのトーナメントの共通の束縛(%s)',
  (kind) => {
    test('処理単位のコンテナからブラケットのストアをD1の実装に解決し、マッチのIDからブラケットを引ける', async () => {
      const store = createContainer(kind).get<BracketStore>(
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
  },
);
