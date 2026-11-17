import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  addBusinessDays,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import { sequentialIdOf } from '../match/testing/event-fixtures.ts';
import { insertUser } from '../product/testing/product-fixtures.ts';
import { bracketIdOf } from '../tournament/testing/bracket-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  at,
  readBracketMatches,
  readMatchesOfRound,
  readScheduledEventMatchIds,
  settle,
} from '../tournament/testing/progression-fixtures.ts';
import {
  advanceAndApply,
  createService,
  firstRoundDateOf,
  SERVICE_IDS,
  seedYear,
  YEAR_TOURNAMENT_ID,
  yearOf,
} from './testing/year-progression-fixtures.ts';
import {
  clearYearTournamentTables,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearTournamentIdOf,
} from './testing/year-tournament-fixtures.ts';

// 参加8の2027年は、1回戦(準々決勝)が決勝日の2日前、準決勝が前日、決勝が決勝日
const FINAL_DATE = YEAR_SCHEDULE.finalDate;

const SEMIFINAL_DATE = addBusinessDays(FINAL_DATE, -1);

const QUARTERFINAL_DATE = addBusinessDays(FINAL_DATE, -2);

const QUARTERFINAL_ADVANCE_AT = at(QUARTERFINAL_DATE, 23, 45);

const SEMIFINAL_ADVANCE_AT = at(SEMIFINAL_DATE, 23, 45);

const AFTER_MIDNIGHT = at(SEMIFINAL_DATE, 0, 10);

const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];

async function seedQuarterfinals(): Promise<string[]> {
  const quarterfinals = await seedYear({
    index: 1,
    entries: EIGHT,
    firstMatchIds: 1,
  });
  if (quarterfinals.length !== 4) {
    throw new Error('準々決勝の予定がありません');
  }
  return quarterfinals;
}

async function settleAll(
  matchIds: readonly string[],
  results: readonly ('won' | 'lost')[] = ['won', 'lost'],
): Promise<void> {
  for (const matchId of matchIds) {
    await settle(matchId, results);
  }
}

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  recordLogs();
});

afterEach(() => {
  resetObservability();
});

describe('YearTournamentProgressionService.advance・applyResult(進行)', () => {
  test('1回戦は決勝日から逆算した日に予定され、全マッチの確定で翌日に準決勝を予定し、結果と予告を発行する', async () => {
    const quarterfinals = await seedQuarterfinals();
    await settleAll(quarterfinals);
    const harness = createService();

    const result = await advanceAndApply(harness, QUARTERFINAL_ADVANCE_AT);

    const semifinals = [
      sequentialIdOf(SERVICE_IDS),
      sequentialIdOf(SERVICE_IDS + 1),
    ];
    expect(firstRoundDateOf(YEAR, EIGHT.length)).toBe(QUARTERFINAL_DATE);
    expect(result).toEqual({
      kind: 'scheduled',
      bracketId: bracketIdOf(1),
      round: 2,
      late: false,
      decidedMatchIds: quarterfinals,
      previewMatchIds: semifinals,
    });
    expect(harness.notifications.rounds).toEqual([
      {
        decidedMatchIds: quarterfinals,
        previewMatchIds: semifinals,
        at: QUARTERFINAL_ADVANCE_AT,
      },
    ]);
    expect(harness.notifications.recordedAwards()).toEqual([]);
    expect(
      (await readMatchesOfRound(1)).map(({ id, kind, stage, matchDate }) => ({
        id,
        kind,
        stage,
        matchDate,
      })),
    ).toEqual(
      quarterfinals.map((id) => ({
        id,
        kind: 'year',
        stage: 'quarterfinal',
        matchDate: QUARTERFINAL_DATE,
      })),
    );
    expect(
      (await readMatchesOfRound(2)).map(({ id, kind, stage, matchDate }) => ({
        id,
        kind,
        stage,
        matchDate,
      })),
    ).toEqual(
      semifinals.map((id) => ({
        id,
        kind: 'year',
        stage: 'semifinal',
        matchDate: SEMIFINAL_DATE,
      })),
    );
    expect(await yearOf(harness.store)).toMatchObject({
      status: 'in_progress',
      outcome: null,
      championEntryId: null,
    });
  });

  test('準決勝の確定で決勝日に決勝を予定し、決勝の段階を記録する', async () => {
    const quarterfinals = await seedQuarterfinals();
    await settleAll(quarterfinals);
    const harness = createService();
    await advanceAndApply(harness, QUARTERFINAL_ADVANCE_AT);
    await settleAll([
      sequentialIdOf(SERVICE_IDS),
      sequentialIdOf(SERVICE_IDS + 1),
    ]);

    const result = await advanceAndApply(harness, SEMIFINAL_ADVANCE_AT);

    const final = sequentialIdOf(SERVICE_IDS + 2);
    expect(result).toMatchObject({
      kind: 'scheduled',
      round: 3,
      late: false,
      previewMatchIds: [final],
    });
    expect(await readMatchesOfRound(3)).toEqual([
      expect.objectContaining({
        id: final,
        stage: 'final',
        matchDate: FINAL_DATE,
      }),
    ]);
    expect(harness.notifications.rounds.at(-1)).toEqual({
      decidedMatchIds: [
        sequentialIdOf(SERVICE_IDS),
        sequentialIdOf(SERVICE_IDS + 1),
      ],
      previewMatchIds: [final],
      at: SEMIFINAL_ADVANCE_AT,
    });
  });

  test('一部のマッチだけが確定していれば、確定したマッチの結果だけを発行する', async () => {
    const [first] = await seedQuarterfinals();
    if (first === undefined) {
      throw new Error('準々決勝の予定がありません');
    }
    await settle(first, ['won', 'lost']);
    const harness = createService();

    const result = await advanceAndApply(harness, QUARTERFINAL_ADVANCE_AT);

    expect(result).toMatchObject({ kind: 'waiting', decidedMatchIds: [first] });
    expect(harness.notifications.rounds).toEqual([
      {
        decidedMatchIds: [first],
        previewMatchIds: [],
        at: QUARTERFINAL_ADVANCE_AT,
      },
    ]);
    expect(await readMatchesOfRound(2)).toEqual([]);
  });

  test('隣のマッチが両者敗北なら他方だけのマッチを作って予告から除き、不戦勝の後に翌日の決勝で対戦相手が決まる', async () => {
    const [first, second, third, fourth] = await seedQuarterfinals();
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error('準々決勝の予定がありません');
    }
    await settle(first, ['lost', 'lost'], 'no_votes');
    await settleAll([second, third, fourth]);
    const harness = createService();

    const semifinalResult = await advanceAndApply(
      harness,
      QUARTERFINAL_ADVANCE_AT,
    );

    const bye = sequentialIdOf(SERVICE_IDS);
    const semifinal = sequentialIdOf(SERVICE_IDS + 1);
    expect(semifinalResult).toMatchObject({
      kind: 'scheduled',
      round: 2,
      previewMatchIds: [semifinal],
    });
    expect(await readBracketMatches(2)).toEqual([
      expect.objectContaining({
        matchId: bye,
        position: 1,
        participant2No: null,
        matchDate: SEMIFINAL_DATE,
      }),
      expect.objectContaining({ matchId: semifinal, position: 2 }),
    ]);
    expect(await readMatchesOfRound(2)).toEqual([
      expect.objectContaining({ id: bye, stage: 'semifinal' }),
      expect.objectContaining({ id: semifinal, stage: 'semifinal' }),
    ]);

    await settle(bye, ['bye'], 'bye');
    await settle(semifinal, ['lost', 'won']);
    const finalResult = await advanceAndApply(harness, SEMIFINAL_ADVANCE_AT);

    const final = sequentialIdOf(SERVICE_IDS + 2);
    expect(finalResult).toMatchObject({
      kind: 'scheduled',
      round: 3,
      decidedMatchIds: [bye, semifinal],
      previewMatchIds: [final],
    });
    const [finalNode, ...otherFinals] = await readBracketMatches(3);
    expect(otherFinals).toEqual([]);
    expect(finalNode).toMatchObject({ matchId: final, matchDate: FINAL_DATE });
    expect(finalNode?.participant1No).not.toBeNull();
    expect(finalNode?.participant2No).not.toBeNull();
    expect(await readMatchesOfRound(3)).toEqual([
      expect.objectContaining({ id: final, stage: 'final' }),
    ]);
    expect(
      harness.notifications.rounds.map(
        ({ previewMatchIds }) => previewMatchIds,
      ),
    ).toEqual([[semifinal], [final]]);
  });

  // 参加8の準決勝の位置1は、準々決勝の位置1と位置4の勝者が対戦する
  test('準決勝の位置に送る準々決勝の2つが両者敗北なら、その位置のマッチを作らない', async () => {
    const [first, second, third, fourth] = await seedQuarterfinals();
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      throw new Error('準々決勝の予定がありません');
    }
    await settle(first, ['lost', 'lost'], 'no_votes');
    await settle(fourth, ['lost', 'lost'], 'no_votes');
    await settleAll([second, third]);
    const harness = createService();

    const result = await advanceAndApply(harness, QUARTERFINAL_ADVANCE_AT);

    expect(result).toMatchObject({
      kind: 'scheduled',
      round: 2,
      previewMatchIds: [sequentialIdOf(SERVICE_IDS)],
    });
    expect(await readBracketMatches(2)).toEqual([
      expect.objectContaining({
        matchId: sequentialIdOf(SERVICE_IDS),
        position: 2,
      }),
    ]);
  });

  test('進行中でない年と無い年は進めずにundefinedを返す', async () => {
    await insertYearTournaments([
      {
        index: 1,
        columns: { status: 'drawing', drawStartedAt: YEAR_SCHEDULE.drawAt },
      },
    ]);
    const { service, notifications } = createService();

    expect(
      await service.advance(YEAR_TOURNAMENT_ID, QUARTERFINAL_ADVANCE_AT),
    ).toBeUndefined();
    expect(
      await service.advance(yearTournamentIdOf(9), QUARTERFINAL_ADVANCE_AT),
    ).toBeUndefined();
    expect(notifications.rounds).toEqual([]);
  });
});

describe('YearTournamentProgressionService.advance(冪等性と遅れ)', () => {
  let events: Event[];

  beforeEach(() => {
    events = installRecordingSentry();
  });

  test('同じ年を2回続けて進めても準決勝のマッチは1組で、2回目は同じ結果を返す', async () => {
    const quarterfinals = await seedQuarterfinals();
    await settleAll(quarterfinals);

    const first = await createService({ idStart: 101 }).service.advance(
      YEAR_TOURNAMENT_ID,
      QUARTERFINAL_ADVANCE_AT,
    );
    const second = await createService({ idStart: 201 }).service.advance(
      YEAR_TOURNAMENT_ID,
      QUARTERFINAL_ADVANCE_AT,
    );

    const semifinals = [sequentialIdOf(101), sequentialIdOf(102)];
    expect(second).toEqual(first);
    expect((await readMatchesOfRound(2)).map(({ id }) => id)).toEqual(
      semifinals,
    );
    expect(await readScheduledEventMatchIds()).toEqual([
      ...quarterfinals,
      ...semifinals,
    ]);
  });

  test('同じ年を同時に進めても準決勝のマッチは1組で、先に挿入した側のマッチIDにそろう', async () => {
    const quarterfinals = await seedQuarterfinals();
    await settleAll(quarterfinals);

    const [first, second] = await Promise.all([
      createService({ idStart: 101 }).service.advance(
        YEAR_TOURNAMENT_ID,
        QUARTERFINAL_ADVANCE_AT,
      ),
      createService({ idStart: 201 }).service.advance(
        YEAR_TOURNAMENT_ID,
        QUARTERFINAL_ADVANCE_AT,
      ),
    ]);

    const recorded = (await readMatchesOfRound(2)).map(({ id }) => id);
    expect([
      [sequentialIdOf(101), sequentialIdOf(102)],
      [sequentialIdOf(201), sequentialIdOf(202)],
    ]).toContainEqual(recorded);
    expect(await readScheduledEventMatchIds()).toEqual([
      ...quarterfinals,
      ...recorded,
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ previewMatchIds: recorded });
  });

  test('0:00を過ぎてから進めると準決勝を1日遅らせて予定し、遅れをエラートラッキングへ1件知らせる', async () => {
    const quarterfinals = await seedQuarterfinals();
    await settleAll(quarterfinals);
    const harness = createService();

    const result = await advanceAndApply(harness, AFTER_MIDNIGHT);

    const semifinals = [
      sequentialIdOf(SERVICE_IDS),
      sequentialIdOf(SERVICE_IDS + 1),
    ];
    expect(result).toMatchObject({ kind: 'scheduled', round: 2, late: true });
    expect(
      (await readMatchesOfRound(2)).map(({ id, matchDate }) => ({
        id,
        matchDate,
      })),
    ).toEqual(semifinals.map((id) => ({ id, matchDate: FINAL_DATE })));
    expect(harness.notifications.rounds).toEqual([
      {
        decidedMatchIds: quarterfinals,
        previewMatchIds: semifinals,
        at: AFTER_MIDNIGHT,
      },
    ]);
    const late = events.filter(
      (event) => event.tags?.tournament_incident === 'round-late',
    );
    expect(late).toHaveLength(1);
    expect(late[0]?.tags).toMatchObject({ bracket_id: bracketIdOf(1) });
  });

  test('遅れた後のラウンドも前ラウンドの翌日に続けて予定する', async () => {
    const quarterfinals = await seedQuarterfinals();
    await settleAll(quarterfinals);
    const harness = createService();
    await advanceAndApply(harness, AFTER_MIDNIGHT);
    await settleAll([
      sequentialIdOf(SERVICE_IDS),
      sequentialIdOf(SERVICE_IDS + 1),
    ]);

    const result = await advanceAndApply(harness, at(FINAL_DATE, 23, 45));

    expect(result).toMatchObject({ kind: 'scheduled', round: 3, late: false });
    expect(await readMatchesOfRound(3)).toEqual([
      expect.objectContaining({
        stage: 'final',
        matchDate: parseBusinessDate('2027-05-31'),
      }),
    ]);
  });
});
