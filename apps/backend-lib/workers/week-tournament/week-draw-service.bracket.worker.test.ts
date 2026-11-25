import type { Event } from '@sentry/cloudflare';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { bracketParticipants } from '../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../db/schema/tournament/tournament-brackets.ts';
import { isoWeekKey } from '../../../common-lib/tournament/week-period.ts';
import { TOURNAMENT_WEEK_ENTRY_REFUND_KIND } from '../../core/email/kinds/tournament-week.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import { emailOf } from '../identity/testing/identity-store-fixtures.ts';
import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import { purchaseIdOf } from '../payments/testing/payment-store-fixtures.ts';
import {
  db,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  FIRST_ROUND_DATE,
  readEntriesOf,
  readMatchesOfRound,
  windowOf,
} from '../tournament/testing/progression-fixtures.ts';
import {
  createDrawService,
  DRAW_AT,
  DRAW_CATEGORY,
  DRAW_MATCH_IDS,
  ENTITLED_BY_PAYMENT,
  entryOf,
  PLAIN_OWNER,
  readDrawnTournament,
  readEntry,
  RecordingNotificationEvents,
  seedProducts,
  TOURNAMENT_ID,
} from './testing/draw-service-fixtures.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_START,
  weekEntryIdOf,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

const LATER = new Date(DRAW_AT.getTime() + 600_000);

const FIRST_MATCH_ID = sequentialIdOf(DRAW_MATCH_IDS);

const SECOND_TOURNAMENT_ID = weekTournamentIdOf(2);

let logs: LogObject[] = [];
let events: Event[] = [];

function paidEntryOf(
  index: number,
  upvoteCount: number,
  launchDate = '2026-11-20',
) {
  return entryOf(index, PLAIN_OWNER, {
    ...ENTITLED_BY_PAYMENT,
    purchaseId: purchaseIdOf(index),
    qualifierUpvoteCount: upvoteCount,
    launchDate,
  });
}

// 1〜5: 可視の決済の資格(N = 5でシード3つ、1回戦は非シードの2つ)、6: 非公開化の決済の資格、7: 特典の無い受付中
async function seedFiveParticipants(): Promise<void> {
  await seedProducts(PLAIN_OWNER, [1, 2, 3, 4, 5, 7]);
  await seedProducts(PLAIN_OWNER, [6], { hiddenAt: T0 });
  await insertWeekEntries([
    paidEntryOf(1, 10, '2026-11-18'),
    paidEntryOf(2, 50),
    paidEntryOf(3, 30),
    paidEntryOf(4, 20),
    paidEntryOf(5, 5, '2026-11-17'),
    paidEntryOf(6, 40),
    entryOf(7, PLAIN_OWNER),
  ]);
}

async function readBracketRows() {
  return db
    .select({
      id: tournamentBrackets.id,
      tournamentId: tournamentBrackets.tournamentId,
      status: tournamentBrackets.status,
      outcome: tournamentBrackets.outcome,
    })
    .from(tournamentBrackets)
    .orderBy(asc(tournamentBrackets.tournamentId));
}

async function readParticipantRows(bracketId: string) {
  return db
    .select({
      participantNo: bracketParticipants.participantNo,
      entryRef: bracketParticipants.entryRef,
      launchId: bracketParticipants.launchId,
    })
    .from(bracketParticipants)
    .where(eq(bracketParticipants.bracketId, bracketId))
    .orderBy(asc(bracketParticipants.participantNo));
}

async function bracketIdOfTournament(tournamentId: string): Promise<string> {
  const bracket = (await readBracketRows()).find(
    (row) => row.tournamentId === tournamentId,
  );
  if (bracket === undefined) {
    throw new Error('ブラケットがありません');
  }
  return bracket.id;
}

beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearWeekTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertWeekTournaments([{ index: 1 }]);
});

afterEach(resetObservability);

describe('WeekTournamentDrawService.drawDue(組み合わせ・記録・後処理)', () => {
  test('23:45に参加資格の枠で組み合わせ、翌日の1回戦の予定をマッチのテーブルに作り、週を進行中にして予告を発行する', async () => {
    await seedFiveParticipants();
    const { service, notifications } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    const bracketId = await bracketIdOfTournament(TOURNAMENT_ID);
    await expect(readParticipantRows(bracketId)).resolves.toEqual(
      [2, 3, 4, 5, 1].map((entry, offset) => ({
        participantNo: offset + 1,
        entryRef: weekEntryIdOf(entry),
        launchId: launchIdOf(entry),
      })),
    );
    const window = windowOf(FIRST_ROUND_DATE);
    await expect(readMatchesOfRound(1)).resolves.toEqual([
      {
        id: FIRST_MATCH_ID,
        kind: 'week',
        round: 1,
        stage: null,
        matchDate: FIRST_ROUND_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
    ]);
    await expect(readEntriesOf(FIRST_MATCH_ID)).resolves.toEqual(
      [5, 1].map((index, offset) => ({
        slot: offset + 1,
        launchId: launchIdOf(index),
        productId: productIdOf(index),
        ownerUserId: userIdOf(PLAIN_OWNER),
      })),
    );
    await expect(readDrawnTournament()).resolves.toEqual({
      status: 'in_progress',
      bracketId,
      drawnAt: DRAW_AT,
      outcome: null,
      championEntryId: null,
      awardedAt: null,
    });
    expect(notifications.events()).toEqual([
      { type: 'match_preview', matchId: FIRST_MATCH_ID },
    ]);
  });

  test('除外した決済の枠の返金を依頼して知らせを送り、期限切れの枠には依頼しない', async () => {
    await seedFiveParticipants();
    const { service, refundRequests, sent } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(refundRequests).toEqual([
      expect.objectContaining({ purchaseId: purchaseIdOf(6), amount: null }),
    ]);
    expect(sent).toEqual([
      expect.objectContaining({
        kind: TOURNAMENT_WEEK_ENTRY_REFUND_KIND,
        to: emailOf(PLAIN_OWNER),
      }),
    ]);
    await expect(readEntry(6)).resolves.toMatchObject({
      status: 'excluded',
      refundStatus: 'requested',
    });
    await expect(readEntry(7)).resolves.toMatchObject({
      status: 'expired',
      refundStatus: 'none',
    });
  });

  test('参加1ならマッチを作らずに週を受賞で終え、受賞を発行する', async () => {
    await seedProducts(PLAIN_OWNER, [1, 2]);
    await insertWeekEntries([paidEntryOf(1, 10), entryOf(2, PLAIN_OWNER)]);
    const { service, notifications } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    const bracketId = await bracketIdOfTournament(TOURNAMENT_ID);
    await expect(readDrawnTournament()).resolves.toEqual({
      status: 'finished',
      bracketId,
      drawnAt: DRAW_AT,
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(1),
      awardedAt: DRAW_AT,
    });
    await expect(readBracketRows()).resolves.toEqual([
      expect.objectContaining({ status: 'finished', outcome: 'champion' }),
    ]);
    await expect(readMatchesOfRound(1)).resolves.toEqual([]);
    expect(notifications.events()).toEqual([
      {
        type: 'award',
        award: 'product_of_the_week',
        period: isoWeekKey(WEEK_START),
        productId: productIdOf(1),
      },
    ]);
  });

  test('参加0ならマッチを作らずに週を受賞なしで終え、何も発行しない', async () => {
    await seedProducts(PLAIN_OWNER, [1]);
    await insertWeekEntries([entryOf(1, PLAIN_OWNER)]);
    const { service, notifications } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    const bracketId = await bracketIdOfTournament(TOURNAMENT_ID);
    await expect(readDrawnTournament()).resolves.toEqual({
      status: 'finished',
      bracketId,
      drawnAt: DRAW_AT,
      outcome: 'no_award',
      championEntryId: null,
      awardedAt: null,
    });
    await expect(readMatchesOfRound(1)).resolves.toEqual([]);
    expect(notifications.events()).toEqual([]);
  });

  test('組み合わせの後に週への記録が中断しても、再実行が同じブラケットとマッチで続きを行い、予告を重複させない', async () => {
    await seedFiveParticipants();
    const notifications = new RecordingNotificationEvents();
    const interrupted = createDrawService({
      notifications,
      failMarkDrawnOf: TOURNAMENT_ID,
    });

    await expect(interrupted.service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [],
      failed: [TOURNAMENT_ID],
    });
    await expect(readDrawnTournament()).resolves.toMatchObject({
      status: 'drawing',
      bracketId: null,
    });

    const resumed = createDrawService({ notifications });
    await expect(resumed.service.drawDue(LATER)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    const bracketId = await bracketIdOfTournament(TOURNAMENT_ID);
    await expect(readBracketRows()).resolves.toHaveLength(1);
    await expect(readParticipantRows(bracketId)).resolves.toHaveLength(5);
    await expect(readMatchesOfRound(1)).resolves.toEqual([
      expect.objectContaining({ id: FIRST_MATCH_ID }),
    ]);
    expect(resumed.scheduler.sizes).toEqual([]);
    await expect(readDrawnTournament()).resolves.toMatchObject({
      status: 'in_progress',
      bracketId,
      drawnAt: LATER,
    });
    expect(notifications.events()).toEqual([
      { type: 'match_preview', matchId: FIRST_MATCH_ID },
    ]);
    expect(
      [...interrupted.refundRequests, ...resumed.refundRequests].map(
        ({ purchaseId }) => purchaseId,
      ),
    ).toEqual([purchaseIdOf(6)]);
  });

  test('組み合わせに失敗した週は組み合わせ決定中のまま失敗として返し、他の週の組み合わせを止めない', async () => {
    await insertWeekTournaments([{ index: 2, weekStart: '2026-11-09' }]);
    await seedProducts(PLAIN_OWNER, [1, 2]);
    await insertWeekEntries([paidEntryOf(1, 10), paidEntryOf(2, 20)]);
    const { service } = createDrawService({
      failDrawOf: SECOND_TOURNAMENT_ID,
    });

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [SECOND_TOURNAMENT_ID],
    });

    await expect(readDrawnTournament(2)).resolves.toMatchObject({
      status: 'drawing',
      bracketId: null,
    });
    await expect(readDrawnTournament()).resolves.toMatchObject({
      status: 'in_progress',
    });
    await expect(readMatchesOfRound(1)).resolves.toHaveLength(1);
    expect(events.map(({ tags }) => tags)).toEqual([
      expect.objectContaining({
        tournament_incident: 'draw-failed',
        tournament_id: SECOND_TOURNAMENT_ID,
      }),
    ]);
  });
});

describe('WeekTournamentDrawService.drawDue(ログとエラートラッキング)', () => {
  test('組み合わせの記録は週・ブラケットの識別と参加数だけをログに残す', async () => {
    await seedFiveParticipants();
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    const bracketId = await bracketIdOfTournament(TOURNAMENT_ID);
    expect(logs.filter(({ category }) => category === DRAW_CATEGORY)).toEqual([
      {
        time: expect.any(String) as unknown,
        category: DRAW_CATEGORY,
        message: expect.any(String) as unknown,
        level: 'info',
        tournamentId: TOURNAMENT_ID,
        bracketId,
        participantCount: 5,
      },
    ]);
  });

  test('後処理の失敗のログとエラートラッキングに、プロダクトの名称・メールアドレス・ハンドルを含めない', async () => {
    await seedFiveParticipants();
    const { service } = createDrawService({
      emailFailure: new Error('メールの送信の一時的な失敗'),
    });

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [],
      failed: [TOURNAMENT_ID],
    });

    expect(
      logs.filter(
        ({ category, level }) =>
          category === DRAW_CATEGORY && level === 'error',
      ),
    ).toEqual([expect.objectContaining({ tournamentId: TOURNAMENT_ID })]);
    expect(events).toHaveLength(1);
    const output = JSON.stringify([logs, events]);
    for (const index of [1, 2, 3, 4, 5, 6, 7]) {
      expect(output).not.toContain(`プロダクト${String(index)}`);
      expect(output).not.toContain(`product${String(index)}`);
    }
    expect(output).not.toContain(emailOf(PLAIN_OWNER));
    expect(output).not.toContain(`user${String(PLAIN_OWNER)}`);
  });
});
