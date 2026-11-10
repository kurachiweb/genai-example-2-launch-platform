import { beforeEach, describe, expect, test } from 'vitest';

import type {
  MatchScheduleInput,
  ScheduledEntryInput,
} from '../../core/match/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import {
  createRecordingDatabase,
  expectWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1MatchScheduler } from './d1-match-scheduler.ts';
import { QueueMatchEventDispatcher } from './queue-match-event-dispatcher.ts';
import { seedDirectoryOwners } from './testing/directory-fixtures.ts';
import {
  createControlledPublisher,
  createRecordingDispatcher,
  createSequentialIds,
  readEntryRows,
  readMatchEvents,
  readMatchRows,
} from './testing/event-fixtures.ts';
import {
  MATCH_DATE,
  MATCH_WINDOW,
  matchIdOf,
} from './testing/match-fixtures.ts';

const AT = new Date('2026-11-19T14:45:00.000Z');

const LATER = new Date(AT.getTime() + 60_000);

const MAX_MATCHES_PER_CALL = 50;

// 利用者1のプロダクトとローンチ1・2、利用者2のプロダクトとローンチ3・4(seedDirectoryOwners)
function entryOf(index: number): ScheduledEntryInput {
  return {
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(index <= 2 ? 1 : 2),
  };
}

function qualifierOf(
  index: number,
  entries: MatchScheduleInput['entries'],
): MatchScheduleInput {
  return {
    matchId: matchIdOf(index),
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: parseBusinessDate(MATCH_DATE),
    startsAt: MATCH_WINDOW.startsAt,
    endsAt: MATCH_WINDOW.endsAt,
    entries,
  };
}

function weekOf(
  index: number,
  entries: MatchScheduleInput['entries'],
): MatchScheduleInput {
  return {
    ...qualifierOf(index, entries),
    kind: 'week',
    round: 1,
    stage: 'quarterfinal',
  };
}

beforeEach(seedDirectoryOwners);

describe('schedule', () => {
  test('マッチ・側・予定のイベントを作り、確定の後に作ったイベントを送る', async () => {
    const dispatcher = createRecordingDispatcher();
    const scheduler = new D1MatchScheduler(
      db,
      dispatcher,
      createSequentialIds(),
    );

    const result = await scheduler.schedule(
      [qualifierOf(1, [entryOf(1), entryOf(3)])],
      AT,
    );

    expect(result).toEqual({ created: [matchIdOf(1)], skipped: [] });
    expect(await readMatchRows()).toMatchObject([
      {
        id: matchIdOf(1),
        kind: 'qualifier',
        matchDate: MATCH_DATE,
        round: null,
        stage: null,
        startsAt: MATCH_WINDOW.startsAt,
        endsAt: MATCH_WINDOW.endsAt,
        startedAt: null,
        decidedAt: null,
        decision: null,
        createdAt: AT,
        updatedAt: AT,
      },
    ]);
    expect(await readEntryRows()).toMatchObject([
      {
        matchId: matchIdOf(1),
        slot: 1,
        matchKind: 'qualifier',
        matchDate: MATCH_DATE,
        launchId: launchIdOf(1),
        productId: productIdOf(1),
        ownerUserId: userIdOf(1),
        upvoteCount: 0,
        lastUpvotedAt: null,
        result: null,
      },
      {
        matchId: matchIdOf(1),
        slot: 2,
        launchId: launchIdOf(3),
        productId: productIdOf(3),
        ownerUserId: userIdOf(2),
      },
    ]);
    const events = await readMatchEvents();
    expect(events).toMatchObject([
      {
        matchId: matchIdOf(1),
        matchKind: 'qualifier',
        type: 'scheduled',
        occurredAt: AT,
        status: 'pending',
        dispatchCount: 1,
        lastDispatchedAt: AT,
        completedAt: null,
      },
    ]);
    const eventId = events[0]?.id;
    expect(dispatcher.published).toEqual([[eventId]]);
    expect(dispatcher.committedAtPublish).toEqual([[eventId]]);
  });

  test('同じマッチのIDを2回渡しても、マッチ・側・イベントを重複して作らず送らない', async () => {
    const dispatcher = createRecordingDispatcher();
    const scheduler = new D1MatchScheduler(
      db,
      dispatcher,
      createSequentialIds(),
    );
    const input = qualifierOf(1, [entryOf(1), entryOf(3)]);
    await scheduler.schedule([input], AT);

    const result = await scheduler.schedule([input], LATER);

    expect(result).toEqual({ created: [], skipped: [matchIdOf(1)] });
    expect(await readMatchRows()).toHaveLength(1);
    expect(await readEntryRows()).toHaveLength(2);
    expect(await readMatchEvents()).toMatchObject([{ occurredAt: AT }]);
    expect(dispatcher.published).toHaveLength(1);
  });

  test('既に予選に組まれたローンチを含むマッチは、別のIDでもマッチも側も作らずに飛ばし、残りのマッチを作る', async () => {
    const scheduler = new D1MatchScheduler(
      db,
      createRecordingDispatcher(),
      createSequentialIds(),
    );
    await scheduler.schedule([qualifierOf(1, [entryOf(1), entryOf(3)])], AT);

    const result = await scheduler.schedule(
      [
        qualifierOf(2, [entryOf(4), entryOf(1)]),
        qualifierOf(3, [entryOf(2), entryOf(4)]),
      ],
      LATER,
    );

    expect(result).toEqual({
      created: [matchIdOf(3)],
      skipped: [matchIdOf(2)],
    });
    expect((await readMatchRows()).map((row) => row.id)).toEqual([
      matchIdOf(1),
      matchIdOf(3),
    ]);
    expect(
      (await readEntryRows()).map((row) => [row.matchId, row.launchId]),
    ).toEqual([
      [matchIdOf(1), launchIdOf(1)],
      [matchIdOf(1), launchIdOf(3)],
      [matchIdOf(3), launchIdOf(2)],
      [matchIdOf(3), launchIdOf(4)],
    ]);
  });

  test('同じ呼び出しの中で同じローンチを2つの予選に渡すと、先のマッチだけを作る', async () => {
    const scheduler = new D1MatchScheduler(
      db,
      createRecordingDispatcher(),
      createSequentialIds(),
    );

    const result = await scheduler.schedule(
      [
        qualifierOf(1, [entryOf(1), entryOf(3)]),
        qualifierOf(2, [entryOf(3), entryOf(2)]),
      ],
      AT,
    );

    expect(result).toEqual({
      created: [matchIdOf(1)],
      skipped: [matchIdOf(2)],
    });
    expect(await readEntryRows()).toHaveLength(2);
  });

  test('同じ予選の2つの側に同じローンチを渡すと、例外にし何も書かず送らない', async () => {
    const dispatcher = createRecordingDispatcher();
    const scheduler = new D1MatchScheduler(
      db,
      dispatcher,
      createSequentialIds(),
    );

    await expect(
      scheduler.schedule(
        [
          qualifierOf(1, [entryOf(2), entryOf(4)]),
          qualifierOf(2, [entryOf(1), entryOf(1)]),
        ],
        AT,
      ),
    ).rejects.toThrow();

    expect(await readMatchRows()).toEqual([]);
    expect(await readEntryRows()).toEqual([]);
    expect(await readMatchEvents()).toEqual([]);
    expect(dispatcher.published).toEqual([]);
  });

  test('トーナメントは同じ口で1つまたは2つの側のマッチを作れ、予選に組まれたローンチも入れられる', async () => {
    const scheduler = new D1MatchScheduler(
      db,
      createRecordingDispatcher(),
      createSequentialIds(),
    );
    await scheduler.schedule([qualifierOf(1, [entryOf(1), entryOf(3)])], AT);

    const result = await scheduler.schedule(
      [weekOf(2, [entryOf(1), entryOf(3)]), weekOf(3, [entryOf(2)])],
      LATER,
    );

    expect(result).toEqual({
      created: [matchIdOf(2), matchIdOf(3)],
      skipped: [],
    });
    expect(await readMatchRows()).toMatchObject([
      { id: matchIdOf(1), kind: 'qualifier' },
      { id: matchIdOf(2), kind: 'week', round: 1, stage: 'quarterfinal' },
      { id: matchIdOf(3), kind: 'week', round: 1, stage: 'quarterfinal' },
    ]);
    expect(
      (await readEntryRows()).map((row) => [
        row.matchId,
        row.slot,
        row.matchKind,
      ]),
    ).toEqual([
      [matchIdOf(1), 1, 'qualifier'],
      [matchIdOf(1), 2, 'qualifier'],
      [matchIdOf(2), 1, 'week'],
      [matchIdOf(2), 2, 'week'],
      [matchIdOf(3), 1, 'week'],
    ]);
    expect(
      (await readMatchEvents()).map((event) => [
        event.matchId,
        event.matchKind,
      ]),
    ).toEqual([
      [matchIdOf(1), 'qualifier'],
      [matchIdOf(2), 'week'],
      [matchIdOf(3), 'week'],
    ]);
  });

  test('1つの文が失敗すると、同じ呼び出しのどのマッチも作らず送らない', async () => {
    const dispatcher = createRecordingDispatcher();
    const scheduler = new D1MatchScheduler(
      db,
      dispatcher,
      createSequentialIds(),
    );
    const missingProduct: ScheduledEntryInput = {
      ...entryOf(2),
      productId: productIdOf(999),
    };

    await expect(
      scheduler.schedule(
        [
          qualifierOf(1, [entryOf(1), entryOf(3)]),
          qualifierOf(2, [missingProduct, entryOf(4)]),
        ],
        AT,
      ),
    ).rejects.toThrow();

    expect(await readMatchRows()).toEqual([]);
    expect(await readEntryRows()).toEqual([]);
    expect(await readMatchEvents()).toEqual([]);
    expect(dispatcher.published).toEqual([]);
  });

  test('空の入力は何も書かず送らない', async () => {
    const dispatcher = createRecordingDispatcher();
    const scheduler = new D1MatchScheduler(
      db,
      dispatcher,
      createSequentialIds(),
    );

    await expect(scheduler.schedule([], AT)).resolves.toEqual({
      created: [],
      skipped: [],
    });
    expect(await readMatchRows()).toEqual([]);
    expect(dispatcher.published).toEqual([]);
  });

  test('51件以上はRangeErrorにし、何も書かない', async () => {
    const scheduler = new D1MatchScheduler(
      db,
      createRecordingDispatcher(),
      createSequentialIds(),
    );
    const inputs = Array.from({ length: MAX_MATCHES_PER_CALL + 1 }, (_, i) =>
      weekOf(i + 1, [entryOf(1)]),
    );

    await expect(scheduler.schedule(inputs, AT)).rejects.toThrow(RangeError);
    expect(await readMatchRows()).toEqual([]);
  });

  test('50件のマッチを各文のバインド変数を上限内にして作り、50件のイベントを1回で送る', async () => {
    const products = Array.from({ length: 100 }, (_, i) => i + 5);
    await insertProducts(products, 1);
    await insertLaunches(
      products.map((index) => ({
        index,
        productIndex: index,
        columns: { launchDate: MATCH_DATE },
      })),
    );
    const { database, placeholderCounts } = createRecordingDatabase();
    const dispatcher = createRecordingDispatcher();
    const scheduler = new D1MatchScheduler(
      database,
      dispatcher,
      createSequentialIds(),
    );
    const inputs = Array.from({ length: MAX_MATCHES_PER_CALL }, (_, i) =>
      qualifierOf(i + 1, [
        { ...entryOf(1), launchId: launchIdOf(i * 2 + 5) },
        { ...entryOf(1), launchId: launchIdOf(i * 2 + 6) },
      ]),
    );

    const result = await scheduler.schedule(inputs, AT);

    expect(result.created).toHaveLength(MAX_MATCHES_PER_CALL);
    expect(await readEntryRows()).toHaveLength(MAX_MATCHES_PER_CALL * 2);
    expectWithinBindLimit(placeholderCounts);
    expect(dispatcher.published).toHaveLength(1);
    expect(dispatcher.published[0]).toHaveLength(MAX_MATCHES_PER_CALL);
  });

  test('送信に失敗しても予定の作成は成功し、イベントはpendingのまま残る', async () => {
    const publisher = createControlledPublisher(() => true);
    const scheduler = new D1MatchScheduler(
      db,
      new QueueMatchEventDispatcher(publisher, 'api'),
      createSequentialIds(),
    );

    const result = await scheduler.schedule(
      [qualifierOf(1, [entryOf(1), entryOf(3)])],
      AT,
    );

    expect(result.created).toEqual([matchIdOf(1)]);
    expect(await readMatchEvents()).toMatchObject([
      { status: 'pending', dispatchCount: 1 },
    ]);
    expect(publisher.bodies).toEqual([]);
  });
});
