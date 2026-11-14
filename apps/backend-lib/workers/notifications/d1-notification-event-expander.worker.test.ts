import { beforeEach, describe, expect, test } from 'vitest';

import { notificationEvents } from '../../../db/schema/notifications/notification-events.ts';
import { resultSlotFor } from '../../core/notifications/notification-slots.ts';
import type { NotificationEventExpander } from '../../core/notifications/ports.ts';
import { createSequentialIds } from '../identity/testing/identity-store-fixtures.ts';
import { D1MatchDirectory } from '../match/d1-match-directory.ts';
import { AFTER_DECISION } from '../match/testing/directory-fixtures.ts';
import { insertMatches, matchIdOf } from '../match/testing/match-fixtures.ts';
import { D1NotificationEventExpander } from './d1-notification-event-expander.ts';
import { D1NotificationNoticeStore } from './d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from './d1-notification-preference-store.ts';
import { D1NotificationSlotStore } from './d1-notification-slot-store.ts';
import {
  insertEventRow,
  MATCH_DAY,
  seedMatchOwners,
  tournamentMatch,
} from './testing/notification-event-fixtures.ts';
import {
  db,
  readEventRows,
  readNoticeRows,
  T0,
  userIdOf,
} from './testing/notification-store-fixtures.ts';

const EVENT_ID = `01JC0EVNT${'1'.padStart(17, '0')}`;
const MISSING_EVENT_ID = `01JC0EVNT${'9'.padStart(17, '0')}`;
const BUDGET = 2000;
const LEASE_SECONDS = 120;

const slots = new D1NotificationSlotStore(db, createSequentialIds(9000));

const expander: NotificationEventExpander = new D1NotificationEventExpander(
  db,
  new D1MatchDirectory(db),
  new D1NotificationPreferenceStore(db),
  new D1NotificationNoticeStore(
    db,
    createSequentialIds(5000),
    new D1NotificationSlotStore(db, createSequentialIds(8000)),
  ),
);

async function insertResultEvent(
  match: number,
  columns: Partial<typeof notificationEvents.$inferInsert> = {},
): Promise<void> {
  await insertEventRow({
    id: EVENT_ID,
    type: 'match_result',
    dedupeKey: `match_result:${matchIdOf(match)}`,
    publisher: 'tournament-week',
    matchId: matchIdOf(match),
    occurredAt: T0,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
}

const DONE = { kind: 'done', lateSlotKeys: [], flushSlotKey: null } as const;

beforeEach(async () => {
  await seedMatchOwners();
});

describe('マッチの通知イベントの展開', () => {
  test('未展開の結果を受信する設定の投稿者の通知へ展開し、展開済みにする', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 3])]);
    await insertResultEvent(1);

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(
      (await readNoticeRows()).map((row) => [
        row.topic,
        row.recipientUserId,
        row.slotKey,
      ]),
    ).toEqual([['match_result', userIdOf(1), resultSlotFor(MATCH_DAY).key]]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({
        status: 'expanded',
        expandedAt: AFTER_DECISION,
        updatedAt: AFTER_DECISION,
      }),
    ]);
  });

  test('送り出し中の枠に入った通知は、遅れた枠として返す', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    await insertResultEvent(1);
    const slot = resultSlotFor(MATCH_DAY);
    await slots.ensure(slot, T0);
    await slots.acquireLease(slot.key, 'test', T0, LEASE_SECONDS);
    await slots.advance(
      slot.key,
      'test',
      { phase: 'sending', cursor: null },
      T0,
    );

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual({ ...DONE, lateSlotKeys: [slot.key] });
  });

  test('展開済みの通知イベントは何もせずに完了する', async () => {
    await insertMatches([tournamentMatch(1, 'decided', [1, 2])]);
    await insertResultEvent(1, { status: 'expanded', expandedAt: T0 });

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(await readNoticeRows()).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ expandedAt: T0 }),
    ]);
  });

  test('無い通知イベントは何もせずに完了する', async () => {
    const outcome = await expander.expand(
      MISSING_EVENT_ID,
      AFTER_DECISION,
      BUDGET,
    );

    expect(outcome).toEqual(DONE);
  });

  test('マッチが消えた通知イベントは通知を作らずに展開済みにする', async () => {
    await insertResultEvent(1);

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(await readNoticeRows()).toEqual([]);
    expect(await readEventRows()).toEqual([
      expect.objectContaining({ status: 'expanded' }),
    ]);
  });

  test('開始した後に展開する予告は通知を作らない', async () => {
    await insertMatches([tournamentMatch(1, 'live', [1, 3])]);
    await insertResultEvent(1, {
      type: 'match_preview',
      dedupeKey: `match_preview:${matchIdOf(1)}`,
    });

    const outcome = await expander.expand(EVENT_ID, AFTER_DECISION, BUDGET);

    expect(outcome).toEqual(DONE);
    expect(await readNoticeRows()).toEqual([]);
  });
});
