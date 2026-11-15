import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { qualifierWindow } from '../../../lib/core/match/match-model.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import {
  eveningSlot,
  morningSlot,
} from '../../../lib/core/notifications/notification-slots.ts';
import type { StoredSlot } from '../../../lib/core/notifications/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { createSequentialIds } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { D1MatchDirectory } from '../../../lib/workers/match/d1-match-directory.ts';
import {
  DECIDED_AT,
  STARTS_AT,
} from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import { D1NotificationNoticeStore } from '../../../lib/workers/notifications/d1-notification-notice-store.ts';
import { D1NotificationPreferenceStore } from '../../../lib/workers/notifications/d1-notification-preference-store.ts';
import { D1NotificationSlotStore } from '../../../lib/workers/notifications/d1-notification-slot-store.ts';
import {
  clearFollows,
  MATCH_DAY,
  seedMatchOwners,
} from '../../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  db,
  insertPreference,
  insertUser,
  readNoticeRows,
  T0,
  userIdOf,
} from '../../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { insertProduct } from '../../../lib/workers/product/testing/product-fixtures.ts';
import type { SlotCollector } from '../../application/notifications/ports.ts';
import { EveningCollector } from './evening-collector.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const NEXT_DAY = parseBusinessDate('2026-11-21');
const NEXT_DAY_WINDOW = qualifierWindow(NEXT_DAY);
const NOW = fromBusinessDateTime(MATCH_DAY, { hour: 23, minute: 46 });
const SLOT = eveningSlot(MATCH_DAY);

// 予告を受信する利用者5(不戦勝の側)と、予告と結果を受信するがメールアドレスを確認していない利用者6
const BYE_OWNER = 5;
const UNVERIFIED_OWNER = 6;

const slots = new D1NotificationSlotStore(db, createSequentialIds(8000));

let matchDirectory: MatchDirectory = new D1MatchDirectory(db);

function createCollector(): SlotCollector {
  return new EveningCollector(
    matchDirectory,
    new D1NotificationPreferenceStore(db),
    new D1NotificationNoticeStore(db, createSequentialIds(5000), slots),
  );
}

let collector = createCollector();

function qualifier(
  index: number,
  owners: readonly number[],
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return {
    index,
    columns,
    entries: owners.map((owner, position) => ({
      index: index * 10 + position + 1,
      launch: null,
      product: owner,
      owner,
    })),
  };
}

const DECIDED = {
  startedAt: STARTS_AT,
  decidedAt: DECIDED_AT,
  decision: 'votes',
} as const;

const NEXT_DAY_COLUMNS = {
  matchDate: NEXT_DAY,
  startsAt: NEXT_DAY_WINDOW.startsAt,
  endsAt: NEXT_DAY_WINDOW.endsAt,
} as const;

async function storedSlot(): Promise<StoredSlot> {
  return slots.ensure(SLOT, T0);
}

async function readNoticeSummaries() {
  return (await readNoticeRows()).map((row) => [
    row.topic,
    row.recipientUserId,
    row.matchId,
    row.entryId,
    row.slotKey,
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearFollows();
  await seedMatchOwners();
  await insertUser(BYE_OWNER, { emailVerifiedAt: T0 });
  await insertProduct(BYE_OWNER, BYE_OWNER);
  await insertPreference(BYE_OWNER, 'match_preview', true);
  await insertPreference(BYE_OWNER, 'match_result', true);
  await insertUser(UNVERIFIED_OWNER);
  await insertProduct(UNVERIFIED_OWNER, UNVERIFIED_OWNER);
  await insertPreference(UNVERIFIED_OWNER, 'match_preview', true);
  await insertPreference(UNVERIFIED_OWNER, 'match_result', true);
  matchDirectory = new D1MatchDirectory(db);
  collector = createCollector();
});

describe('EveningCollector.step', () => {
  test('当日の確定した予選の結果と翌日の2つの側の予選の予告を、受信する設定の送信の対象者に夜の枠へ記録して完了する', async () => {
    await insertMatches([
      qualifier(1, [1, 2], DECIDED),
      qualifier(2, [3, 4], DECIDED),
      qualifier(3, [UNVERIFIED_OWNER], DECIDED),
      qualifier(4, [1, 3], NEXT_DAY_COLUMNS),
      qualifier(5, [2, UNVERIFIED_OWNER], NEXT_DAY_COLUMNS),
    ]);

    const step = await collector.step(await storedSlot(), NOW);

    expect(step).toStrictEqual({ kind: 'progress', cursor: null, done: true });
    expect(await readNoticeSummaries()).toEqual([
      ['match_result', userIdOf(1), matchIdOf(1), entryIdOf(11), SLOT.key],
      ['match_result', userIdOf(2), matchIdOf(1), entryIdOf(12), SLOT.key],
      ['match_preview', userIdOf(1), matchIdOf(4), entryIdOf(41), SLOT.key],
      ['match_preview', userIdOf(3), matchIdOf(4), entryIdOf(42), SLOT.key],
    ]);
  });

  test('不戦勝のマッチの予告は作らず、結果は作る', async () => {
    await insertMatches([
      qualifier(1, [BYE_OWNER], {
        startedAt: STARTS_AT,
        decidedAt: STARTS_AT,
        decision: 'bye',
      }),
      qualifier(2, [BYE_OWNER], {
        ...NEXT_DAY_COLUMNS,
        decidedAt: NEXT_DAY_WINDOW.startsAt,
        decision: 'bye',
      }),
      qualifier(3, [BYE_OWNER], NEXT_DAY_COLUMNS),
    ]);

    await collector.step(await storedSlot(), NOW);

    expect(await readNoticeSummaries()).toEqual([
      [
        'match_result',
        userIdOf(BYE_OWNER),
        matchIdOf(1),
        entryIdOf(11),
        SLOT.key,
      ],
    ]);
  });

  test('当日の未確定の予選・翌日の開始済みの予選・トーナメントのマッチからは通知を作らない', async () => {
    await insertMatches([
      qualifier(1, [1, 2], { startedAt: STARTS_AT }),
      qualifier(2, [1, 3], {
        ...NEXT_DAY_COLUMNS,
        startedAt: NEXT_DAY_WINDOW.startsAt,
      }),
      qualifier(3, [1, 2], { ...DECIDED, kind: 'week', round: 1 }),
      qualifier(4, [1, 3], { ...NEXT_DAY_COLUMNS, kind: 'year', round: 1 }),
    ]);

    const step = await collector.step(await storedSlot(), NOW);

    expect(step).toStrictEqual({ kind: 'progress', cursor: null, done: true });
    expect(await readNoticeRows()).toEqual([]);
  });

  test('再実行しても通知は増えない', async () => {
    await insertMatches([
      qualifier(1, [1, 2], DECIDED),
      qualifier(4, [1, 3], NEXT_DAY_COLUMNS),
    ]);
    const slot = await storedSlot();
    await collector.step(slot, NOW);
    const recorded = await readNoticeRows();

    const step = await collector.step(slot, new Date(NOW.getTime() + 60_000));

    expect(step).toStrictEqual({ kind: 'progress', cursor: null, done: true });
    expect(await readNoticeRows()).toEqual(recorded);
  });

  test('マッチの照会に処理の時点の時刻を渡し、当日と翌日の予選だけを読む', async () => {
    const directory = new D1MatchDirectory(db);
    const listForDate = vi.spyOn(directory, 'listForDate');
    matchDirectory = directory;
    collector = createCollector();

    await collector.step(await storedSlot(), NOW);

    expect(listForDate.mock.calls.map(([input]) => input)).toEqual(
      expect.arrayContaining([
        { date: MATCH_DAY, kinds: ['qualifier'], now: NOW },
        { date: NEXT_DAY, kinds: ['qualifier'], now: NOW },
      ]),
    );
    expect(listForDate).toHaveBeenCalledTimes(2);
  });

  test('夜の枠でない枠は収集せずに例外を投げる', async () => {
    const slot = await slots.ensure(morningSlot(MATCH_DAY), T0);

    await expect(collector.step(slot, NOW)).rejects.toThrow(RangeError);
  });
});
