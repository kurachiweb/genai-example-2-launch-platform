import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  insertUpvotes,
  MATCH_DATE,
  matchIdOf,
  upvoteIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  productIdOf,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { UpvoteHistoryStore } from '../application/match/ports.ts';
import {
  StoreUpvoteHistoryReader,
  type UpvoteHistoryReader,
} from '../application/match/upvote-history-reader.ts';
import { D1UpvoteHistoryStore } from '../infrastructure/match/d1-upvote-history-store.ts';
import {
  DURING_MATCH,
  ENTRY_B,
  insertLiveMatch,
  LIVE_MATCH,
  OWNER_B,
  secondsAfterStart,
  seedUpvoteParticipants,
  VOTER,
} from '../infrastructure/match/testing/upvote-store-fixtures.ts';
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

beforeEach(async () => {
  await seedUpvoteParticipants();
  await insertLiveMatch();
  await insertUpvotes([
    {
      index: 1,
      match: LIVE_MATCH,
      entry: ENTRY_B,
      user: VOTER,
      upvotedAt: secondsAfterStart(10),
    },
  ]);
});

describe('APIサーバーのマッチのモジュールのUpvote履歴の束縛', () => {
  test('処理単位のコンテナから、Upvote履歴のストアと照会をそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<UpvoteHistoryStore>(MATCH_TYPES.UpvoteHistoryStore),
    ).toBeInstanceOf(D1UpvoteHistoryStore);
    expect(
      container.get<UpvoteHistoryReader>(MATCH_TYPES.UpvoteHistoryReader),
    ).toBeInstanceOf(StoreUpvoteHistoryReader);
  });

  test('Upvote履歴の照会は、実物の束縛でハンドルの利用者の有効なUpvoteをマッチ中の印とプロダクト付きで返す', async () => {
    const page = await createContainer()
      .get<UpvoteHistoryReader>(MATCH_TYPES.UpvoteHistoryReader)
      .read({
        userHandle: `user${String(VOTER)}`,
        viewer: undefined,
        first: 20,
        after: undefined,
        now: DURING_MATCH,
      });

    expect(page?.totalCount).toBe(1);
    expect(page?.dateTotals).toEqual([
      { date: parseBusinessDate(MATCH_DATE), count: 1 },
    ]);
    expect(page?.entries).toEqual([
      expect.objectContaining({
        upvoteId: upvoteIdOf(1),
        matchId: matchIdOf(LIVE_MATCH),
        kind: 'qualifier',
        live: true,
        ownerUserId: userIdOf(OWNER_B),
      }),
    ]);
    expect(page?.entries[0]?.product.productId).toBe(productIdOf(3));
    expect(page?.hasNextPage).toBe(false);
  });
});
