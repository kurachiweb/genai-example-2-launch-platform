import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { MATCH_PLATFORM_TYPES } from '../../lib/core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchEventDispatcher,
  MatchEventStore,
  MatchExport,
  MatchScheduler,
  SupporterDirectory,
  UpvoteExport,
} from '../../lib/core/match/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  D1MatchDirectory,
  D1SupporterDirectory,
} from '../../lib/workers/match/d1-match-directory.ts';
import { D1MatchEventStore } from '../../lib/workers/match/d1-match-event-store.ts';
import {
  D1MatchExport,
  D1UpvoteExport,
} from '../../lib/workers/match/d1-match-export.ts';
import { D1MatchScheduler } from '../../lib/workers/match/d1-match-scheduler.ts';
import { QueueMatchEventDispatcher } from '../../lib/workers/match/queue-match-event-dispatcher.ts';
import {
  SAMPLE_MATCH_ID,
  SAMPLE_SUPPORTER_ID,
  SAMPLE_UPVOTE_ID,
  SAMPLE_WINNER_ENTRY_ID,
  SAMPLE_WINNER_LAUNCH_ID,
  seedMatchPlatformSample,
} from '../../lib/workers/match/testing/match-platform-fixtures.ts';
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

beforeEach(seedMatchPlatformSample);

describe('APIサーバーのマッチの共通の束縛', () => {
  test('処理単位のコンテナからマッチとサポーターの照会をD1の実装に解決し、確定した予選の結果とサポーターを引ける', async () => {
    const container = createContainer();
    const matches = container.get<MatchDirectory>(
      MATCH_PLATFORM_TYPES.MatchDirectory,
    );
    const supporters = container.get<SupporterDirectory>(
      MATCH_PLATFORM_TYPES.SupporterDirectory,
    );

    expect(matches).toBeInstanceOf(D1MatchDirectory);
    expect(supporters).toBeInstanceOf(D1SupporterDirectory);
    await expect(
      matches.findQualifierResults([SAMPLE_WINNER_LAUNCH_ID]),
    ).resolves.toEqual(
      new Map([
        [
          SAMPLE_WINNER_LAUNCH_ID,
          expect.objectContaining({ matchId: SAMPLE_MATCH_ID, result: 'won' }),
        ],
      ]),
    );
    await expect(
      supporters.listSupporters({
        entryId: SAMPLE_WINNER_ENTRY_ID,
        after: undefined,
        limit: 20,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ upvoteId: SAMPLE_UPVOTE_ID }),
    ]);
  });

  test('処理単位のコンテナから予定の作成とイベントの記録と送信をD1とQueueの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<MatchScheduler>(MATCH_PLATFORM_TYPES.MatchScheduler),
    ).toBeInstanceOf(D1MatchScheduler);
    expect(
      container.get<MatchEventStore>(MATCH_PLATFORM_TYPES.MatchEventStore),
    ).toBeInstanceOf(D1MatchEventStore);
    expect(
      container.get<MatchEventDispatcher>(
        MATCH_PLATFORM_TYPES.MatchEventDispatcher,
      ),
    ).toBeInstanceOf(QueueMatchEventDispatcher);
  });

  test('処理単位のコンテナからデータエクスポートの照会をD1の実装に解決し、ローンチのマッチと利用者のUpvoteを引ける', async () => {
    const container = createContainer();
    const matchExport = container.get<MatchExport>(
      MATCH_PLATFORM_TYPES.MatchExport,
    );
    const upvoteExport = container.get<UpvoteExport>(
      MATCH_PLATFORM_TYPES.UpvoteExport,
    );

    expect(matchExport).toBeInstanceOf(D1MatchExport);
    expect(upvoteExport).toBeInstanceOf(D1UpvoteExport);
    await expect(
      matchExport.listForLaunches([SAMPLE_WINNER_LAUNCH_ID]),
    ).resolves.toEqual(
      new Map([
        [
          SAMPLE_WINNER_LAUNCH_ID,
          [expect.objectContaining({ matchId: SAMPLE_MATCH_ID })],
        ],
      ]),
    );
    await expect(upvoteExport.listByUser(SAMPLE_SUPPORTER_ID)).resolves.toEqual(
      [expect.objectContaining({ matchId: SAMPLE_MATCH_ID })],
    );
  });
});
