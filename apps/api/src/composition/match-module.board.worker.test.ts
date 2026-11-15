import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { CurrentUser } from '../../lib/core/identity/account-guard.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  entryIdOf,
  MATCH_DATE,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import {
  DirectoryMatchViewReader,
  type MatchViewReader,
} from '../application/match/match-view-reader.ts';
import type { MatchBoardStore } from '../application/match/ports.ts';
import {
  DirectoryQualifierBoardReader,
  type QualifierBoardReader,
} from '../application/match/qualifier-board-reader.ts';
import type { UpvoteService } from '../application/match/upvote-service.ts';
import { D1MatchBoardStore } from '../infrastructure/match/d1-match-board-store.ts';
import {
  DURING_MATCH,
  ENTRY_A,
  ENTRY_B,
  insertLiveMatch,
  LIVE_MATCH,
  OWNER_A,
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

describe('APIサーバーのマッチのモジュールの表示の束縛', () => {
  test('処理単位のコンテナから、トップページのストア・表示の組み立て・トップページの予選の照会をそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<MatchBoardStore>(MATCH_TYPES.MatchBoardStore),
    ).toBeInstanceOf(D1MatchBoardStore);
    expect(
      container.get<MatchViewReader>(MATCH_TYPES.MatchViewReader),
    ).toBeInstanceOf(DirectoryMatchViewReader);
    expect(
      container.get<QualifierBoardReader>(MATCH_TYPES.QualifierBoardReader),
    ).toBeInstanceOf(DirectoryQualifierBoardReader);
  });

  test('表示の組み立ては、実物の束縛でD1のマッチ・プロダクト・閲覧者のUpvoteから表示を作る', async () => {
    const container = createContainer();
    await container.get<UpvoteService>(MATCH_TYPES.UpvoteService).upvote({
      user: currentUserOf(VOTER),
      matchId: matchIdOf(LIVE_MATCH),
      entryId: entryIdOf(ENTRY_B),
      now: DURING_MATCH,
    });

    const views = await container
      .get<MatchViewReader>(MATCH_TYPES.MatchViewReader)
      .findViews({
        matchIds: [matchIdOf(LIVE_MATCH)],
        viewer: currentUserOf(VOTER),
        now: DURING_MATCH,
      });

    const view = views.get(matchIdOf(LIVE_MATCH));
    expect(view?.viewerUpvotedEntryId).toBe(entryIdOf(ENTRY_B));
    expect(view?.viewerRestriction).toBeNull();
    expect(view?.entries.map((entry) => entry.entryId)).toEqual([
      entryIdOf(ENTRY_A),
      entryIdOf(ENTRY_B),
    ]);
    expect(view?.entries.map((entry) => entry.upvoteCount)).toEqual([0, 1]);
    expect(view?.entries.every((entry) => entry.product !== null)).toBe(true);
  });

  test('トップページの予選の照会は、実物の束縛で当日の開始済みの予選を対戦カードにし、投稿者の側に印を付ける', async () => {
    const board = await createContainer()
      .get<QualifierBoardReader>(MATCH_TYPES.QualifierBoardReader)
      .read({ viewer: currentUserOf(OWNER_A), now: DURING_MATCH });

    expect(board.date).toBe(parseBusinessDate(MATCH_DATE));
    expect(board.phase).toBe('live');
    expect(board.cards.map((view) => view.record.matchId)).toEqual([
      matchIdOf(LIVE_MATCH),
    ]);
    expect(board.cards[0]?.entries.map((entry) => entry.isViewerOwn)).toEqual([
      true,
      false,
    ]);
    expect(board.cards[0]?.viewerRestriction).toBe('own_match');
    expect(board.heldCount).toBe(1);
    expect(board.awaitingKickoff).toBe(true);
  });
});
