import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { readMatchEvents } from '../../lib/workers/match/testing/event-fixtures.ts';
import {
  insertMatches,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  type MatchSettlement,
  StoreMatchSettlement,
} from '../application/match/match-settlement.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { SettlementStore } from '../application/match/ports.ts';
import { D1SettlementStore } from '../infrastructure/match/d1-settlement-store.ts';
import {
  ENDS_AT,
  readEntries,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
} from '../infrastructure/match/testing/upvote-store-fixtures.ts';
import { MODULES } from './modules.ts';

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'scheduled',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

beforeEach(async () => {
  await seedUpvoteParticipants();
});

describe('APIサーバーのマッチのモジュールの確定の束縛', () => {
  test('処理単位のコンテナから、確定のストアとユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<SettlementStore>(MATCH_TYPES.SettlementStore),
    ).toBeInstanceOf(D1SettlementStore);
    expect(
      container.get<MatchSettlement>(MATCH_TYPES.MatchSettlement),
    ).toBeInstanceOf(StoreMatchSettlement);
  });

  test('確定のユースケースは、実物の束縛で終了の日時を過ぎたマッチを確定し確定のイベントを作る', async () => {
    const match = twoSidedMatch(1, { startedAt: STARTS_AT });
    const [first, second] = match.entries;
    if (first === undefined || second === undefined) {
      throw new Error('側が2つありません');
    }
    await insertMatches([
      {
        ...match,
        entries: [
          { ...first, columns: { upvoteCount: 0 } },
          {
            ...second,
            columns: {
              upvoteCount: 2,
              lastUpvotedAt: STARTS_AT,
              lastUpvoteSeq: 1,
            },
          },
        ],
      },
    ]);
    const settlement = createContainer().get<MatchSettlement>(
      MATCH_TYPES.MatchSettlement,
    );

    const summary = await settlement.settleDue(
      new Date(ENDS_AT.getTime() + 1000),
    );

    expect(summary).toEqual({ settled: 1, truncated: false });
    expect((await readEntries(1)).map((entry) => entry.upvoteCount)).toEqual([
      0, 2,
    ]);
    expect(await readMatchEvents()).toEqual([
      expect.objectContaining({ matchId: matchIdOf(1), type: 'decided' }),
    ]);
  });
});
