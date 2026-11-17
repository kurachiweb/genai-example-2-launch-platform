import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { matchWindow } from '../../lib/core/match/match-model.ts';
import {
  addBusinessDays,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import { D1MatchDirectory } from '../../lib/workers/match/d1-match-directory.ts';
import {
  type EntryFixture,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import { D1ProductDirectory } from '../../lib/workers/product/d1-product-directory.ts';
import {
  db,
  insertProducts,
  insertUser,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { D1BracketStore } from '../../lib/workers/tournament/d1-bracket-store.ts';
import {
  type BracketMatchFixture,
  bracketIdOf,
  insertBracketMatches,
  insertBrackets,
  insertParticipants,
} from '../../lib/workers/tournament/testing/bracket-fixtures.ts';
import { D1YearTournamentStore } from '../../lib/workers/year-tournament/d1-year-tournament-store.ts';
import {
  clearYearTournamentTables,
  insertYearTournaments,
  YEAR,
  YEAR_SCHEDULE,
  yearEntryIdOf,
  yearTournamentIdOf,
} from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import { DirectoryMatchViewReader } from '../application/match/match-view-reader.ts';
import { DirectoryYearBracketReader } from '../application/year-tournament/year-bracket-reader.ts';
import { D1MatchBoardStore } from '../infrastructure/match/d1-match-board-store.ts';

const OWNER = 1;

const SUSPENDED_OWNER = 2;

const YEAR_KEY = String(YEAR);

// 2027年の既定の決勝日は5/30。参加6は1回戦が5/28、準決勝が5/29、決勝が5/30
const FINAL_DATE = YEAR_SCHEDULE.finalDate;

const FIRST_ROUND_DATE = addBusinessDays(FINAL_DATE, -2);

const SEMIFINAL_DATE = addBusinessDays(FINAL_DATE, -1);

const AFTER_FIRST_ROUND = fromBusinessDateTime(FIRST_ROUND_DATE, {
  hour: 23,
  minute: 50,
});

const AFTER_FINAL = fromBusinessDateTime(FINAL_DATE, {
  hour: 23,
  minute: 50,
});

const HIDDEN_LOSER = 6;

function createReader(): DirectoryYearBracketReader {
  const products = new D1ProductDirectory(db);
  return new DirectoryYearBracketReader(
    new D1YearTournamentStore(db),
    new D1BracketStore(db),
    new DirectoryMatchViewReader(
      new D1MatchDirectory(db),
      products,
      new D1MatchBoardStore(db),
    ),
    products,
  );
}

function side(
  index: number,
  product: number,
  owner: number,
  columns: EntryFixture['columns'],
): EntryFixture {
  return { index, launch: null, product, owner, columns };
}

function decidedMatch(
  index: number,
  round: number,
  date: string,
  entries: readonly EntryFixture[],
  decision: 'votes' | 'both_forfeited' = 'votes',
): MatchFixture {
  const window = matchWindow(parseBusinessDate(date));
  return {
    index,
    columns: {
      kind: 'year',
      round,
      matchDate: date,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      startedAt: window.startsAt,
      decidedAt: window.endsAt,
      decision,
    },
    entries,
  };
}

function decidedNode(
  index: number,
  round: number,
  position: number,
  participantNos: readonly [number, number],
  winner: number | null,
  date: string,
): BracketMatchFixture {
  return {
    index,
    bracket: 1,
    round,
    position,
    participantNos,
    columns: {
      matchId: matchIdOf(index),
      matchDate: date,
      status: 'decided',
      winnerParticipantNo: winner,
    },
  };
}

async function insertYearParticipants(
  participantNos: readonly number[],
  ownerOf: (participantNo: number) => number = () => OWNER,
): Promise<void> {
  await insertParticipants(
    participantNos.map((no) => ({
      index: no,
      bracket: 1,
      participantNo: no,
      entry: no,
      launch: null,
      product: no,
      owner: ownerOf(no),
      columns: { entryRef: yearEntryIdOf(no) },
    })),
  );
}

const WON = { result: 'won', upvoteCount: 7 } as const;

const LOST = { result: 'lost', upvoteCount: 2 } as const;

// 参加6(シード2)の1回戦を終えた2027年。1回戦は3対4(3の勝利)・5対6(5の勝利、6は非公開化中)で、準決勝の予定はまだ無い
async function seedFirstRoundDecided(): Promise<void> {
  await insertUser(OWNER);
  await insertProducts([1, 2, 3, 4, 5], OWNER);
  await insertProducts([HIDDEN_LOSER], OWNER, { hiddenAt: T0 });
  await insertMatches([
    decidedMatch(1, 1, FIRST_ROUND_DATE, [
      side(11, 3, OWNER, WON),
      side(12, 4, OWNER, LOST),
    ]),
    decidedMatch(2, 1, FIRST_ROUND_DATE, [
      side(21, 5, OWNER, WON),
      side(22, HIDDEN_LOSER, OWNER, LOST),
    ]),
  ]);
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 6,
      columns: {
        tournamentId: yearTournamentIdOf(1),
        firstRoundDate: FIRST_ROUND_DATE,
      },
    },
  ]);
  await insertYearParticipants([1, 2, 3, 4, 5, 6]);
  await insertBracketMatches([
    decidedNode(1, 1, 1, [3, 4], 3, FIRST_ROUND_DATE),
    decidedNode(2, 1, 2, [5, 6], 5, FIRST_ROUND_DATE),
  ]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        status: 'in_progress',
        drawStartedAt: YEAR_SCHEDULE.drawAt,
        drawnAt: YEAR_SCHEDULE.drawAt,
        bracketId: bracketIdOf(1),
        firstRoundDate: FIRST_ROUND_DATE,
        participantCount: 6,
      },
    },
  ]);
}

type ChampionVisibility = 'visible' | 'hidden' | 'deleted' | 'suspended';

// 参加2の決勝を終えた2027年。1が優勝し、年の行に受賞を記録した
async function seedAwardedYear(visibility: ChampionVisibility): Promise<void> {
  await insertUser(OWNER);
  await insertUser(SUSPENDED_OWNER, { status: 'suspended', suspendedAt: T0 });
  const championOwner = visibility === 'suspended' ? SUSPENDED_OWNER : OWNER;
  await insertProducts([1], championOwner, {
    hiddenAt: visibility === 'hidden' ? T0 : null,
    deletedAt: visibility === 'deleted' ? T0 : null,
  });
  await insertProducts([2], OWNER);
  await insertMatches([
    decidedMatch(1, 1, FINAL_DATE, [
      side(11, 1, championOwner, WON),
      side(12, 2, OWNER, LOST),
    ]),
  ]);
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 2,
      columns: {
        tournamentId: yearTournamentIdOf(1),
        firstRoundDate: FINAL_DATE,
        status: 'finished',
        outcome: 'champion',
        championParticipantNo: 1,
      },
    },
  ]);
  await insertYearParticipants([1, 2], (no) =>
    no === 1 ? championOwner : OWNER,
  );
  await insertBracketMatches([decidedNode(1, 1, 1, [1, 2], 1, FINAL_DATE)]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        status: 'finished',
        drawStartedAt: YEAR_SCHEDULE.drawAt,
        drawnAt: YEAR_SCHEDULE.drawAt,
        bracketId: bracketIdOf(1),
        firstRoundDate: FINAL_DATE,
        participantCount: 2,
        outcome: 'awarded',
        championEntryId: yearEntryIdOf(1),
        awardedAt: AFTER_FINAL,
      },
    },
  ]);
}

// 参加2の決勝が両者の失格で終わり、受賞なしで終了した2027年
async function seedNoAwardYear(): Promise<void> {
  await insertUser(OWNER);
  await insertProducts([1, 2], OWNER);
  const forfeited = { result: 'lost', upvoteCount: 0 } as const;
  await insertMatches([
    decidedMatch(
      1,
      1,
      FINAL_DATE,
      [side(11, 1, OWNER, forfeited), side(12, 2, OWNER, forfeited)],
      'both_forfeited',
    ),
  ]);
  await insertBrackets([
    {
      index: 1,
      kind: 'year',
      participantCount: 2,
      columns: {
        tournamentId: yearTournamentIdOf(1),
        firstRoundDate: FINAL_DATE,
        status: 'finished',
        outcome: 'no_award',
      },
    },
  ]);
  await insertYearParticipants([1, 2]);
  await insertBracketMatches([decidedNode(1, 1, 1, [1, 2], null, FINAL_DATE)]);
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        status: 'finished',
        drawStartedAt: YEAR_SCHEDULE.drawAt,
        drawnAt: YEAR_SCHEDULE.drawAt,
        bracketId: bracketIdOf(1),
        firstRoundDate: FINAL_DATE,
        participantCount: 2,
        outcome: 'no_award',
        awardedAt: AFTER_FINAL,
      },
    },
  ]);
}

const productOf = (index: number) =>
  expect.objectContaining({
    handle: `product${String(index)}`,
    name: `プロダクト${String(index)}`,
  }) as never;

const NO_RESULT = { product: null, upvoteCount: null, result: null };

beforeEach(async () => {
  await clearYearTournamentTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DirectoryYearBracketReader', () => {
  test('記録済みのマッチと未来の枠をラウンドごとに並べ、予定が作られる前のシードは「シード<n>」としてプロダクトを出さない', async () => {
    await seedFirstRoundDecided();

    const view = await createReader().read({
      year: YEAR_KEY,
      viewer: undefined,
      now: AFTER_FIRST_ROUND,
    });

    expect(view?.tournament).toMatchObject({
      yearTournamentId: yearTournamentIdOf(1),
      year: YEAR,
      status: 'in_progress',
      outcome: null,
    });
    expect(view?.rounds.participantCount).toBe(6);
    expect(view?.rounds.seedCount).toBe(2);
    expect(view?.rounds.championNo).toBeNull();
    expect(view?.champion).toBeNull();
    expect(
      view?.rounds.rounds.map(({ round, name, date }) => ({
        round,
        name,
        date,
      })),
    ).toEqual([
      { round: 1, name: '1回戦', date: FIRST_ROUND_DATE },
      { round: 2, name: '準決勝', date: SEMIFINAL_DATE },
      { round: 3, name: '決勝', date: FINAL_DATE },
    ]);
    const [firstRound, semifinal, final] = view?.rounds.rounds ?? [];
    expect(
      firstRound?.nodes.map(({ position, match, slots }) => ({
        position,
        matchId: match?.record.matchId,
        slots,
      })),
    ).toEqual([
      {
        position: 1,
        matchId: matchIdOf(1),
        slots: [
          {
            participantNo: 3,
            seed: null,
            feedLabel: null,
            product: productOf(3),
            upvoteCount: 7,
            result: 'won',
          },
          {
            participantNo: 4,
            seed: null,
            feedLabel: null,
            product: productOf(4),
            upvoteCount: 2,
            result: 'lost',
          },
        ],
      },
      {
        position: 2,
        matchId: matchIdOf(2),
        slots: [
          {
            participantNo: 5,
            seed: null,
            feedLabel: null,
            product: productOf(5),
            upvoteCount: 7,
            result: 'won',
          },
          {
            participantNo: HIDDEN_LOSER,
            seed: null,
            feedLabel: null,
            product: null,
            upvoteCount: 2,
            result: 'lost',
          },
        ],
      },
    ]);
    expect(semifinal?.nodes).toEqual([
      {
        position: 1,
        match: null,
        slots: [
          { participantNo: 1, seed: 1, feedLabel: 'シード1', ...NO_RESULT },
          {
            participantNo: 5,
            seed: null,
            feedLabel: '1回戦第2試合の勝者',
            ...NO_RESULT,
          },
        ],
      },
      {
        position: 2,
        match: null,
        slots: [
          { participantNo: 2, seed: 2, feedLabel: 'シード2', ...NO_RESULT },
          {
            participantNo: 3,
            seed: null,
            feedLabel: '1回戦第1試合の勝者',
            ...NO_RESULT,
          },
        ],
      },
    ]);
    expect(final?.nodes).toEqual([
      {
        position: 1,
        match: null,
        slots: [
          {
            participantNo: null,
            seed: null,
            feedLabel: '準決勝第1試合の勝者',
            ...NO_RESULT,
          },
          {
            participantNo: null,
            seed: null,
            feedLabel: '準決勝第2試合の勝者',
            ...NO_RESULT,
          },
        ],
      },
    ]);
  });

  test('受賞した年は、優勝の参加者のプロダクトを優勝のプロダクトとして返す', async () => {
    await seedAwardedYear('visible');

    const view = await createReader().read({
      year: YEAR_KEY,
      viewer: undefined,
      now: AFTER_FINAL,
    });

    expect(view?.tournament).toMatchObject({
      status: 'finished',
      outcome: 'awarded',
      championEntryId: yearEntryIdOf(1),
    });
    expect(view?.rounds.championNo).toBe(1);
    expect(view?.champion).toEqual(productOf(1));
    expect(view?.rounds.rounds.map(({ name }) => name)).toEqual(['決勝']);
  });

  test.each(['hidden', 'deleted', 'suspended'] as const)(
    '受賞した年で優勝のプロダクトが表示できない(%s)ときは、優勝のプロダクトを無しにして受賞の結果を残す',
    async (visibility) => {
      await seedAwardedYear(visibility);

      const view = await createReader().read({
        year: YEAR_KEY,
        viewer: undefined,
        now: AFTER_FINAL,
      });

      expect(view?.tournament).toMatchObject({
        status: 'finished',
        outcome: 'awarded',
      });
      expect(view?.rounds.championNo).toBe(1);
      expect(view?.champion).toBeNull();
      expect(view?.rounds.rounds[0]?.nodes[0]?.slots[0]).toMatchObject({
        participantNo: 1,
        product: null,
        result: 'won',
      });
    },
  );

  test('終了した年で優勝の番号が無いときは、優勝のプロダクトを無しにし、年の状態を終了・受賞なしで返す', async () => {
    await seedNoAwardYear();

    const view = await createReader().read({
      year: YEAR_KEY,
      viewer: undefined,
      now: AFTER_FINAL,
    });

    expect(view?.tournament).toMatchObject({
      status: 'finished',
      outcome: 'no_award',
      championEntryId: null,
    });
    expect(view?.rounds.championNo).toBeNull();
    expect(view?.champion).toBeNull();
  });

  test.each([
    '2028',
    '2029',
    '2030',
    '27',
    '02027',
    '2027a',
    ' 2027',
    'abcd',
    '',
  ])(
    '4桁の年でない・行の無い年・組み合わせを決定していない年(%j)はundefinedを返す',
    async (year) => {
      await seedFirstRoundDecided();
      await insertYearTournaments([
        { index: 2, year: 2028 },
        {
          index: 3,
          year: 2029,
          columns: { status: 'drawing', drawStartedAt: T0 },
        },
      ]);

      const view = await createReader().read({
        year,
        viewer: undefined,
        now: AFTER_FIRST_ROUND,
      });

      expect(view).toBeUndefined();
    },
  );

  test('記録済みのマッチの表示を、ローカルD1から90件ずつまとめて読む', async () => {
    const count = 91;
    await insertBrackets([
      {
        index: 1,
        kind: 'year',
        participantCount: 256,
        columns: {
          tournamentId: yearTournamentIdOf(1),
          firstRoundDate: FIRST_ROUND_DATE,
        },
      },
    ]);
    await insertBracketMatches(
      Array.from({ length: count }, (_, offset) => ({
        index: offset + 1,
        bracket: 1,
        round: 1,
        position: offset + 1,
        participantNos: [offset * 2 + 1, offset * 2 + 2] as const,
        columns: {
          matchId: matchIdOf(offset + 1),
          matchDate: FIRST_ROUND_DATE,
        },
      })),
    );
    await insertYearTournaments([
      {
        index: 1,
        columns: {
          status: 'in_progress',
          drawStartedAt: YEAR_SCHEDULE.drawAt,
          bracketId: bracketIdOf(1),
          firstRoundDate: FIRST_ROUND_DATE,
          participantCount: 256,
        },
      },
    ]);
    const findViews = vi.spyOn(DirectoryMatchViewReader.prototype, 'findViews');

    const view = await createReader().read({
      year: YEAR_KEY,
      viewer: undefined,
      now: AFTER_FIRST_ROUND,
    });

    expect(
      findViews.mock.calls.map(([input]) => input.matchIds.length),
    ).toEqual([90, 1]);
    expect(view?.rounds.rounds[0]?.nodes).toHaveLength(count);
  });
});
