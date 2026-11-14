import { beforeEach, describe, expect, test } from 'vitest';

import { matches } from '../../../db/schema/match/matches.ts';
import { notificationEvents } from '../../../db/schema/notifications/notification-events.ts';

import {
  type NotificationEvent,
  NotificationPublishError,
} from '../../core/notifications/notification-event-contract.ts';
import {
  eveningSlot,
  previewSlotFor,
  resultSlotFor,
} from '../../core/notifications/notification-slots.ts';
import type {
  NotificationNoticeStore,
  NotificationWorkRequester,
} from '../../core/notifications/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import { createSequentialIds } from '../identity/testing/identity-store-fixtures.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import {
  AFTER_DECISION,
  STARTS_AT,
} from '../match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  matchIdOf,
} from '../match/testing/match-fixtures.ts';
import { productIdOf } from '../product/testing/product-fixtures.ts';
import { D1NotificationEventPublisher } from './d1-notification-event-publisher.ts';
import { D1NotificationNoticeStore } from './d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import {
  awardProductIdOf,
  createRecordingWorkRequester,
  MATCH_DAY,
  seedMatchOwners,
  tournamentMatch,
} from './testing/notification-event-fixtures.ts';
import {
  db,
  readEventRows,
  readNoticeRows,
  readSlotRow,
  userIdOf,
} from './testing/notification-store-fixtures.ts';

const PUBLISHED_AT = new Date('2026-11-19T10:00:00.000Z');
const LEASE_SECONDS = 120;

const slots = new D1NotificationSlotStore(db, createSequentialIds(9000));

const IDS_PER_PUBLISHER = 100;

let publisherCount = 0;

// 発行の部品を作り直しても、前の部品が記録した行と識別子が重ならないようにする
function createNoticeStore(): NotificationNoticeStore {
  publisherCount += 1;
  return new D1NotificationNoticeStore(
    db,
    createSequentialIds(5000 + publisherCount * IDS_PER_PUBLISHER),
    new D1NotificationSlotStore(
      db,
      createSequentialIds(20_000 + publisherCount * IDS_PER_PUBLISHER),
    ),
  );
}

function createPublisher(
  requester: NotificationWorkRequester = createRecordingWorkRequester(),
  notices: NotificationNoticeStore = createNoticeStore(),
): D1NotificationEventPublisher {
  return new D1NotificationEventPublisher({
    db,
    ids: createSequentialIds(1000 + publisherCount * IDS_PER_PUBLISHER),
    matches: new D1MatchDirectory(db),
    preferences: new D1NotificationPreferenceStore(db),
    notices,
    requester,
    appName: 'api',
  });
}

// 通知の記録が1回だけ失敗する発行の部品
function createPublisherFailingOnce(): D1NotificationEventPublisher {
  const notices = createNoticeStore();
  let failed = false;
  return createPublisher(createRecordingWorkRequester(), {
    record: (drafts, at) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error('D1の障害'));
      }
      return notices.record(drafts, at);
    },
    nextPendingGroups: (slotKey, limit) =>
      notices.nextPendingGroups(slotKey, limit),
    settle: (entries, at) => notices.settle(entries, at),
    deleteByRecipient: (userId, limit) =>
      notices.deleteByRecipient(userId, limit),
  });
}

function preview(match: number): NotificationEvent {
  return { type: 'match_preview', matchId: matchIdOf(match) };
}

function result(match: number): NotificationEvent {
  return { type: 'match_result', matchId: matchIdOf(match) };
}

const WEEK_AWARD: NotificationEvent = {
  type: 'award',
  award: 'product_of_the_week',
  period: '2026-W47',
  productId: awardProductIdOf(1),
};

async function publish(
  events: readonly NotificationEvent[],
  options: {
    readonly at?: Date;
    readonly publisher?: D1NotificationEventPublisher;
  } = {},
) {
  return (options.publisher ?? createPublisher()).publish({
    publisher: 'tournament-week',
    events,
    at: options.at ?? PUBLISHED_AT,
  });
}

async function rejectionOf(
  events: readonly NotificationEvent[],
  at: Date = PUBLISHED_AT,
): Promise<NotificationPublishError> {
  const error = await publish(events, { at }).catch(
    (caught: unknown) => caught,
  );
  if (!(error instanceof NotificationPublishError)) {
    throw new Error('発行が拒否されませんでした');
  }
  return error;
}

async function moveSlotTo(
  key: string,
  phase: 'sending' | 'done',
): Promise<void> {
  await slots.acquireLease(key, 'test', PUBLISHED_AT, LEASE_SECONDS);
  await slots.advance(key, 'test', { phase, cursor: null }, PUBLISHED_AT);
  await slots.releaseLease(key, 'test');
}

beforeEach(async () => {
  await seedMatchOwners();
});

describe('開始予告と結果の発行', () => {
  test('開始予告は予告を受信する設定の投稿者の通知を前日の夜の枠へ記録し、通知イベントを展開済みにする', async () => {
    await insertMatches([tournamentMatch(1, 'scheduled', [1, 2])]);
    const requester = createRecordingWorkRequester();

    const outcome = await publish([preview(1)], {
      publisher: createPublisher(requester),
    });

    expect(outcome).toEqual({ recorded: 1, duplicates: 0 });
    const slot = previewSlotFor(MATCH_DAY);
    expect(slot.key).toBe('evening:2026-11-19');
    expect(await readNoticeRows()).toEqual([
      expect.objectContaining({
        topic: 'match_preview',
        recipientUserId: userIdOf(1),
        slotKey: slot.key,
        groupKey: `${slot.key}:${userIdOf(1)}:${productIdOf(1)}`,
        matchId: matchIdOf(1),
        entryId: entryIdOf(11),
        productId: productIdOf(1),
        eventId: null,
        status: 'pending',
      }),
    ]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        type: 'match_preview',
        dedupeKey: `match_preview:${matchIdOf(1)}`,
        publisher: 'tournament-week',
        matchId: matchIdOf(1),
        award: null,
        period: null,
        productId: null,
        status: 'expanded',
        occurredAt: PUBLISHED_AT,
        expandedAt: PUBLISHED_AT,
        dispatchCount: 1,
        lastDispatchedAt: PUBLISHED_AT,
      }),
    ]);
    expect(requester.flushes).toEqual([]);
    expect(requester.expansions).toEqual([]);
  });

  test('結果は結果を受信する設定の投稿者の通知を実施日の夜の枠へ記録する', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [2, 3])]);

    const outcome = await publish([result(1)], { at: AFTER_DECISION });

    expect(outcome).toEqual({ recorded: 1, duplicates: 0 });
    expect(await readNoticeRows()).toEqual([
      expect.objectContaining({
        topic: 'match_result',
        recipientUserId: userIdOf(2),
        slotKey: resultSlotFor(MATCH_DAY).key,
        entryId: entryIdOf(11),
        productId: productIdOf(2),
      }),
    ]);
    expect(await readSlotRow('evening:2026-11-20')).toMatchObject({
      phase: 'waiting',
    });
  });

  test('1回の発行で複数のマッチの予告と結果を記録し、受信しない投稿者の通知を作らない', async () => {
    await insertMatches([
      tournamentMatch(1, 'decided', [1, 2]),
      tournamentMatch(2, 'scheduled', [1, 4], {
        matchDate: '2026-11-21',
      }),
    ]);

    const outcome = await publish([result(1), preview(2)], {
      at: AFTER_DECISION,
    });

    expect(outcome).toEqual({ recorded: 2, duplicates: 0 });
    const rows = await readNoticeRows();
    expect(
      rows.map((row) => [row.topic, row.recipientUserId, row.slotKey]),
    ).toEqual(
      expect.arrayContaining([
        ['match_result', userIdOf(1), 'evening:2026-11-20'],
        ['match_result', userIdOf(2), 'evening:2026-11-20'],
        ['match_preview', userIdOf(1), 'evening:2026-11-20'],
      ]),
    );
    expect(rows).toHaveLength(3);
  });

  test('Yearの1回戦のように前日より前に発行した予告も、前日の夜の枠へ記録して保持する', async () => {
    const matchDate = parseBusinessDate('2026-12-10');
    await insertMatches([
      tournamentMatch(1, 'scheduled', [1, 3], {
        kind: 'year',
        matchDate,
        startsAt: new Date('2026-12-10T00:00:00.000Z'),
        endsAt: new Date('2026-12-10T23:40:00.000Z'),
      }),
    ]);

    await publish([preview(1)], { at: new Date('2026-11-14T03:00:00.000Z') });

    const slot = eveningSlot(parseBusinessDate('2026-12-09'));
    const rows = await readNoticeRows();
    expect(rows.map((row) => [row.recipientUserId, row.slotKey])).toEqual(
      expect.arrayContaining([
        [userIdOf(1), slot.key],
        [userIdOf(3), slot.key],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(await readSlotRow(slot.key)).toMatchObject({
      phase: 'waiting',
      dueAt: slot.dueAt,
    });
  });

  test('対戦相手のいないマッチの予告は記録するが、通知を作らない', async () => {
    await insertMatches([tournamentMatch(1, 'scheduled', [1])]);

    const outcome = await publish([preview(1)]);

    expect(outcome).toEqual({ recorded: 1, duplicates: 0 });
    expect(await readNoticeRows()).toEqual([]);
  });
});

describe('拒否', () => {
  test('未確定の結果を拒否し、違反した要素の位置を返して何も記録しない', async () => {
    await insertMatches([
      tournamentMatch(1, 'scheduled', [1, 2]),
      tournamentMatch(2, 'live', [3, 4]),
    ]);

    const error = await rejectionOf([preview(1), result(2)]);

    expect(error).toMatchObject({ reason: 'match-not-decided', eventIndex: 1 });
    expect(await readEventRows()).toEqual([]);
    expect(await readNoticeRows()).toEqual([]);
  });

  test.each([
    ['開始済み', 'live'],
    ['決着済み', 'decided'],
  ] as const)('%sのマッチの予告を拒否する', async (_label, state) => {
    await insertMatches([tournamentMatch(1, state, [1, 2])]);

    const error = await rejectionOf([preview(1)], AFTER_DECISION);

    expect(error).toMatchObject({
      reason: 'match-not-previewable',
      eventIndex: 0,
    });
    expect(await readEventRows()).toEqual([]);
  });

  test('存在しないマッチの通知イベントを拒否する', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);

    const error = await rejectionOf([result(1), WEEK_AWARD, result(9)]);

    expect(error).toMatchObject({ reason: 'match-not-found', eventIndex: 2 });
    expect(await readEventRows()).toEqual([]);
  });

  test('51件の発行を件数の違反として拒否する', async () => {
    await insertMatches([tournamentMatch(1, 'scheduled', [1, 2])]);

    const error = await rejectionOf(
      Array.from({ length: 51 }, () => preview(1)),
    );

    expect(error).toMatchObject({
      reason: 'invalid-request',
      eventIndex: null,
    });
    expect(await readEventRows()).toEqual([]);
  });

  test('契約に合わない通知イベントを形式の違反として拒否する', async () => {
    const error = await rejectionOf([
      WEEK_AWARD,
      { type: 'match_result', matchId: 'not-a-ulid' },
    ]);

    expect(error).toMatchObject({ reason: 'invalid-event', eventIndex: 1 });
    expect(await readEventRows()).toEqual([]);
  });
});

describe('重複', () => {
  test('同じ発行を繰り返すと重複として数え、通知を増やさない', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    await publish([result(1)], { at: AFTER_DECISION });

    const outcome = await publish([result(1)], { at: AFTER_DECISION });

    expect(outcome).toEqual({ recorded: 0, duplicates: 1 });
    expect(await readEventRows()).toHaveLength(1);
    expect(await readNoticeRows()).toHaveLength(2);
  });

  test('1回の発行の中の同じ通知イベントも重複として数える', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);

    const outcome = await publish([result(1), result(1)], {
      at: AFTER_DECISION,
    });

    expect(outcome).toEqual({ recorded: 1, duplicates: 1 });
    expect(await readEventRows()).toHaveLength(1);
    expect(await readNoticeRows()).toHaveLength(2);
  });

  test('記録済みの予告はマッチの開始の後に発行し直しても拒否せず重複として数える', async () => {
    await insertMatches([tournamentMatch(1, 'scheduled', [1, 3])]);
    await publish([preview(1)]);
    await db.update(matches).set({ startedAt: STARTS_AT });

    const outcome = await publish([preview(1)], { at: AFTER_DECISION });

    expect(outcome).toEqual({ recorded: 0, duplicates: 1 });
    expect(await readNoticeRows()).toHaveLength(2);
  });
});

describe('未展開の記録済みの通知イベント', () => {
  test('展開に失敗した発行を繰り返すと、記録済みの予告を展開し直して前日の夜の枠へ記録する', async () => {
    await insertMatches([tournamentMatch(1, 'scheduled', [1, 3])]);
    const failure = await publish([preview(1)], {
      publisher: createPublisherFailingOnce(),
    }).catch((caught: unknown) => caught);
    expect(failure).toEqual(new Error('D1の障害'));
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
    expect(await readNoticeRows()).toEqual([]);

    const outcome = await publish([preview(1)]);

    expect(outcome).toEqual({ recorded: 0, duplicates: 1 });
    const slot = previewSlotFor(MATCH_DAY);
    expect(
      (await readNoticeRows()).map((row) => [
        row.topic,
        row.recipientUserId,
        row.slotKey,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['match_preview', userIdOf(1), slot.key],
        ['match_preview', userIdOf(3), slot.key],
      ]),
    );
    expect(await readNoticeRows()).toHaveLength(2);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        status: 'expanded',
        expandedAt: PUBLISHED_AT,
      }),
    ]);
  });

  test('展開し直しても通知を増やさず、送り出し済みの枠の送り出しを依頼する', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    await publish([result(1)], { at: AFTER_DECISION });
    await db.update(notificationEvents).set({ status: 'pending' });
    const slot = resultSlotFor(MATCH_DAY);
    await moveSlotTo(slot.key, 'done');
    const requester = createRecordingWorkRequester();

    const outcome = await publish([result(1)], {
      at: AFTER_DECISION,
      publisher: createPublisher(requester),
    });

    expect(outcome).toEqual({ recorded: 0, duplicates: 1 });
    expect(await readNoticeRows()).toHaveLength(2);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'expanded' }),
    ]);
    expect(requester.flushes).toEqual([{ slotKey: slot.key, delaySeconds: 0 }]);
  });

  test('未展開の予告の重複がマッチの開始の後に来ると、拒否せず通知を作らずに展開済みにする', async () => {
    await insertMatches([tournamentMatch(1, 'scheduled', [1, 3])]);
    await publish([preview(1)], {
      publisher: createPublisherFailingOnce(),
    }).catch(() => undefined);
    await db.update(matches).set({ startedAt: STARTS_AT });

    const outcome = await publish([preview(1)], { at: AFTER_DECISION });

    expect(outcome).toEqual({ recorded: 0, duplicates: 1 });
    expect(await readNoticeRows()).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'expanded' }),
    ]);
  });

  test('未展開の受賞の重複は展開を依頼し直さない', async () => {
    await publish([WEEK_AWARD]);
    const requester = createRecordingWorkRequester();

    await publish([WEEK_AWARD], { publisher: createPublisher(requester) });

    expect(requester.expansions).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'pending' }),
    ]);
  });
});

describe('送り出しの依頼', () => {
  test.each(['sending', 'done'] as const)(
    '%sの枠に入った通知はその場で枠の送り出しを依頼する',
    async (phase) => {
      await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
      const slot = resultSlotFor(MATCH_DAY);
      await slots.ensure(slot, PUBLISHED_AT);
      await moveSlotTo(slot.key, phase);
      const requester = createRecordingWorkRequester();

      await publish([result(1)], {
        at: AFTER_DECISION,
        publisher: createPublisher(requester),
      });

      expect(requester.flushes).toEqual([
        { slotKey: slot.key, delaySeconds: 0 },
      ]);
      expect(await readNoticeRows()).toHaveLength(2);
    },
  );

  test('待機中の枠に入った通知は送り出しを依頼しない', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    const requester = createRecordingWorkRequester();

    await publish([result(1)], {
      at: AFTER_DECISION,
      publisher: createPublisher(requester),
    });

    expect(requester.flushes).toEqual([]);
  });

  test('受賞は通知イベントを記録して展開を依頼するだけで、通知を作らない', async () => {
    const requester = createRecordingWorkRequester();

    const outcome = await publish([WEEK_AWARD], {
      publisher: createPublisher(requester),
    });

    expect(outcome).toEqual({ recorded: 1, duplicates: 0 });
    const rows = await readEventRows();
    expect(rows).toEqual([
      expect.objectContaining({
        type: 'award',
        dedupeKey: `award:product_of_the_week:2026-W47:${awardProductIdOf(1)}`,
        matchId: null,
        award: 'product_of_the_week',
        period: '2026-W47',
        productId: awardProductIdOf(1),
        status: 'pending',
        cursor: null,
        expandedAt: null,
        dispatchCount: 1,
        lastDispatchedAt: PUBLISHED_AT,
      }),
    ]);
    expect(requester.expansions).toEqual(rows.map((row) => row.id));
    expect(requester.flushes).toEqual([]);
    expect(await readNoticeRows()).toEqual([]);
  });

  test('依頼の送信に失敗しても発行を成功させ、受賞の通知イベントを未展開のまま残す', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    const slot = resultSlotFor(MATCH_DAY);
    await slots.ensure(slot, PUBLISHED_AT);
    await moveSlotTo(slot.key, 'done');
    const requester = createRecordingWorkRequester(new Error('Queueの障害'));

    const outcome = await publish([result(1), WEEK_AWARD], {
      at: AFTER_DECISION,
      publisher: createPublisher(requester),
    });

    expect(outcome).toEqual({ recorded: 2, duplicates: 0 });
    expect(requester.flushes).toHaveLength(1);
    expect(requester.expansions).toHaveLength(1);
    expect(
      (await readEventRows()).map((row) => [row.type, row.status]),
    ).toEqual(
      expect.arrayContaining([
        ['match_result', 'expanded'],
        ['award', 'pending'],
      ]),
    );
  });
});
