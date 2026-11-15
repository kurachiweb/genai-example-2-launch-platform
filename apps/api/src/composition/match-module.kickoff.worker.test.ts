import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import {
  readEntryRows,
  readMatchEvents,
  readMatchRows,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import {
  entryIdOf,
  type EntryFixture,
  insertMatches,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  insertLaunches,
  insertProducts,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { DirectoryEntryEligibilityChecker } from '../application/match/entry-eligibility.ts';
import {
  type MatchKickoff,
  StoreMatchKickoff,
} from '../application/match/match-kickoff.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type {
  EntryEligibilityChecker,
  KickoffStore,
  MatchIncidentReporter,
} from '../application/match/ports.ts';
import { D1KickoffStore } from '../infrastructure/match/d1-kickoff-store.ts';
import { SentryMatchIncidentReporter } from '../infrastructure/match/sentry-match-incident-reporter.ts';
import {
  OWNER_A,
  OWNER_B,
  seedUpvoteParticipants,
  STARTS_AT,
  SUSPENDED,
} from '../infrastructure/match/testing/upvote-store-fixtures.ts';
import { MODULES } from './modules.ts';

const KICKOFF_AT = new Date(STARTS_AT.getTime() + 5000);

const RECORDED_AT = new Date(STARTS_AT.getTime() - 3_600_000);

const ACTIVE_MATCH = 1;

const CANCELED_LAUNCH_MATCH = 2;

const HIDDEN_PRODUCT_MATCH = 3;

const RECORDED_FORFEIT_MATCH = 4;

const SUSPENDED_OWNER_MATCH = 5;

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

// マッチの番号nの側1はプロダクトとローンチ(2n+9)、側2は(2n+10)を持つ
function sideOf(
  match: number,
  slot: 1 | 2,
  owner: number,
  columns?: EntryFixture['columns'],
): EntryFixture {
  const resource = match * 2 + 8 + slot;
  return {
    index: match * 10 + slot,
    launch: resource,
    product: resource,
    owner,
    ...(columns === undefined ? {} : { columns }),
  };
}

function matchOf(
  match: number,
  firstOwner = OWNER_A,
  firstColumns?: EntryFixture['columns'],
) {
  return {
    index: match,
    entries: [
      sideOf(match, 1, firstOwner, firstColumns),
      sideOf(match, 2, OWNER_B),
    ],
  };
}

// 予選の開始の日時に、該当しないマッチ・取消のローンチ・非公開化したプロダクト・該当を記録した後に停止を解除したプロダクト・停止中の投稿者のプロダクトを持つ予選を用意する
async function seedKickoffScenario(): Promise<void> {
  const matches = [1, 2, 3, 4, 5];
  const ownerOf = (match: number) =>
    match === SUSPENDED_OWNER_MATCH ? SUSPENDED : OWNER_A;
  for (const match of matches) {
    const first = match * 2 + 9;
    await insertProducts([first], ownerOf(match), {
      hiddenAt: match === HIDDEN_PRODUCT_MATCH ? T0 : null,
    });
    await insertProducts([first + 1], OWNER_B);
  }
  await insertLaunches(
    matches.flatMap((match) => {
      const first = match * 2 + 9;
      return [
        {
          index: first,
          productIndex: first,
          columns: {
            cancelledAt: match === CANCELED_LAUNCH_MATCH ? T0 : null,
          },
        },
        { index: first + 1, productIndex: first + 1 },
      ];
    }),
  );
  await insertMatches(
    matches.map((match) =>
      matchOf(
        match,
        ownerOf(match),
        match === RECORDED_FORFEIT_MATCH
          ? { forfeitedAt: RECORDED_AT }
          : undefined,
      ),
    ),
  );
}

beforeEach(async () => {
  await seedUpvoteParticipants();
});

describe('APIサーバーのマッチのモジュールの開始の束縛', () => {
  test('処理単位のコンテナから、開始のストア・該当の判定・報告・ユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<KickoffStore>(MATCH_TYPES.KickoffStore),
    ).toBeInstanceOf(D1KickoffStore);
    expect(
      container.get<EntryEligibilityChecker>(
        MATCH_TYPES.EntryEligibilityChecker,
      ),
    ).toBeInstanceOf(DirectoryEntryEligibilityChecker);
    expect(
      container.get<MatchIncidentReporter>(MATCH_TYPES.MatchIncidentReporter),
    ).toBeInstanceOf(SentryMatchIncidentReporter);
    expect(
      container.get<MatchKickoff>(MATCH_TYPES.MatchKickoff),
    ).toBeInstanceOf(StoreMatchKickoff);
  });

  test('実物の束縛で、記録された該当・取消のローンチ・可視でないプロダクトの側を敗北にして決着し、他のマッチを開始する', async () => {
    await seedKickoffScenario();
    const kickoff = createContainer().get<MatchKickoff>(
      MATCH_TYPES.MatchKickoff,
    );

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 1, decided: 4 });
    expect(
      (await readMatchRows()).map((match) => [
        match.id,
        match.startedAt,
        match.decidedAt,
        match.decision,
      ]),
    ).toEqual([
      [matchIdOf(ACTIVE_MATCH), KICKOFF_AT, null, null],
      [matchIdOf(CANCELED_LAUNCH_MATCH), KICKOFF_AT, KICKOFF_AT, 'walkover'],
      [matchIdOf(HIDDEN_PRODUCT_MATCH), KICKOFF_AT, KICKOFF_AT, 'walkover'],
      [matchIdOf(RECORDED_FORFEIT_MATCH), KICKOFF_AT, KICKOFF_AT, 'walkover'],
      [matchIdOf(SUSPENDED_OWNER_MATCH), KICKOFF_AT, KICKOFF_AT, 'walkover'],
    ]);
    expect(
      (await readEntryRows()).map((entry) => [entry.id, entry.result]),
    ).toEqual([
      [entryIdOf(11), null],
      [entryIdOf(12), null],
      [entryIdOf(21), 'lost'],
      [entryIdOf(22), 'walkover'],
      [entryIdOf(31), 'lost'],
      [entryIdOf(32), 'walkover'],
      [entryIdOf(41), 'lost'],
      [entryIdOf(42), 'walkover'],
      [entryIdOf(51), 'lost'],
      [entryIdOf(52), 'walkover'],
    ]);
    expect(
      (await readMatchEvents()).map((event) => [event.matchId, event.type]),
    ).toEqual([
      [matchIdOf(ACTIVE_MATCH), 'started'],
      [matchIdOf(CANCELED_LAUNCH_MATCH), 'decided'],
      [matchIdOf(HIDDEN_PRODUCT_MATCH), 'decided'],
      [matchIdOf(RECORDED_FORFEIT_MATCH), 'decided'],
      [matchIdOf(SUSPENDED_OWNER_MATCH), 'decided'],
    ]);
  });

  test('2回実行しても、同じマッチを重複して開始・確定せずイベントも作らない', async () => {
    await seedKickoffScenario();
    const kickoff = createContainer().get<MatchKickoff>(
      MATCH_TYPES.MatchKickoff,
    );
    await kickoff.kickoffDue(KICKOFF_AT);
    const before = {
      matches: await readMatchRows(),
      entries: await readEntryRows(),
      events: await readMatchEvents(),
    };

    const second = await createContainer()
      .get<MatchKickoff>(MATCH_TYPES.MatchKickoff)
      .kickoffDue(new Date(KICKOFF_AT.getTime() + 60_000));

    expect(second).toEqual({ started: 0, decided: 0 });
    expect(await readMatchRows()).toEqual(before.matches);
    expect(await readEntryRows()).toEqual(before.entries);
    expect(await readMatchEvents()).toEqual(before.events);
  });
});
