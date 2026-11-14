import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../lib/core/identity/account-guard.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  entryIdOf,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { UpvoteStore } from '../application/match/ports.ts';
import {
  StoreUpvoteService,
  type UpvoteService,
} from '../application/match/upvote-service.ts';
import { D1UpvoteStore } from '../infrastructure/match/d1-upvote-store.ts';
import {
  DURING_MATCH,
  ENTRY_A,
  ENTRY_B,
  insertLiveMatch,
  LIVE_MATCH,
  OWNER_A,
  readEntries,
  readUpvotes,
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

const currentUserOf = (index: number): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: userIdOf(index),
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: userIdOf(index),
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: T0,
    deletedAt: null,
    email: 'voter@mail.example',
    nickname: 'サポーター',
    handle: 'voter',
  },
});

beforeEach(async () => {
  await seedUpvoteParticipants();
  await insertLiveMatch();
});

describe('APIサーバーのマッチのモジュールの束縛', () => {
  test('処理単位のコンテナから、Upvoteのストアとユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(container.get<UpvoteStore>(MATCH_TYPES.UpvoteStore)).toBeInstanceOf(
      D1UpvoteStore,
    );
    expect(
      container.get<UpvoteService>(MATCH_TYPES.UpvoteService),
    ).toBeInstanceOf(StoreUpvoteService);
  });

  test('Upvoteのユースケースは、実物の束縛で引数の利用者のUpvoteをD1へ記録し、付け替えと取り消しで側の集計値を求め直す', async () => {
    const service = createContainer().get<UpvoteService>(
      MATCH_TYPES.UpvoteService,
    );
    const request = {
      user: currentUserOf(VOTER),
      matchId: matchIdOf(LIVE_MATCH),
      now: DURING_MATCH,
    };

    await service.upvote({ ...request, entryId: entryIdOf(ENTRY_A) });

    expect(await readUpvotes(LIVE_MATCH)).toEqual([
      expect.objectContaining({
        entryId: entryIdOf(ENTRY_A),
        userId: userIdOf(VOTER),
        upvotedAt: DURING_MATCH,
        seq: 1,
      }),
    ]);

    await service.upvote({ ...request, entryId: entryIdOf(ENTRY_B) });

    expect(
      (await readEntries(LIVE_MATCH)).map((entry) => entry.upvoteCount),
    ).toEqual([0, 1]);

    await service.cancel(request);

    expect(await readUpvotes(LIVE_MATCH)).toEqual([]);
    expect(
      (await readEntries(LIVE_MATCH)).map((entry) => entry.upvoteCount),
    ).toEqual([0, 0]);
  });

  test('Upvoteのユースケースは、実物の束縛で投稿者のUpvoteをupvote_own_matchで拒否し、記録しない', async () => {
    const service = createContainer().get<UpvoteService>(
      MATCH_TYPES.UpvoteService,
    );

    const rejection = service.upvote({
      user: currentUserOf(OWNER_A),
      matchId: matchIdOf(LIVE_MATCH),
      entryId: entryIdOf(ENTRY_B),
      now: DURING_MATCH,
    });

    await expect(rejection).rejects.toBeInstanceOf(AppError);
    await expect(rejection).rejects.toMatchObject({
      code: 'upvote_own_match',
    });
    expect(await readUpvotes(LIVE_MATCH)).toEqual([]);
  });
});
