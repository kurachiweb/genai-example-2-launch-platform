import { describe, expect, test } from 'bun:test';

import { buildBracketRoundsView } from './bracket-view-builder.ts';
import {
  date,
  decided,
  EMPTY_SLOT,
  FIRST_ROUND_DATE,
  matchIdOf,
  N13_FIRST_ROUND,
  noonOf,
  pendingSlot,
  productOf,
  type RecordFixture,
  recordOf,
  seedSlot,
  viewsOf,
} from './testing/bracket-view-fixtures.ts';

const ROUND2_DATE = date('2027-03-10');

describe('buildBracketRoundsView', () => {
  describe('1回戦だけ予定済みの参加13のブラケット', () => {
    const record = recordOf({
      participantCount: 13,
      matches: N13_FIRST_ROUND,
    });
    const matchViews = viewsOf(record, (match) =>
      match.position === 2
        ? [{ upvoteCount: 3, hidden: true }, { upvoteCount: 8 }]
        : [
            { upvoteCount: match.position },
            { upvoteCount: match.position * 2 },
          ],
    );
    const view = buildBracketRoundsView({
      record,
      matchViews,
      now: noonOf(FIRST_ROUND_DATE),
    });

    test('参加数・シード数と、ラウンドの番号・名前・実施日を返す', () => {
      expect({
        participantCount: view.participantCount,
        seedCount: view.seedCount,
        championNo: view.championNo,
        rounds: view.rounds.map(({ round, name, date: on }) => ({
          round,
          name,
          date: on,
        })),
      }).toEqual({
        participantCount: 13,
        seedCount: 3,
        championNo: null,
        rounds: [
          { round: 1, name: '1回戦', date: date('2027-03-09') },
          { round: 2, name: '準々決勝', date: date('2027-03-10') },
          { round: 3, name: '準決勝', date: date('2027-03-11') },
          { round: 4, name: '決勝', date: date('2027-03-12') },
        ],
      });
    });

    test('予定済みの位置は、マッチと側の抽選番号の順のプロダクト・Upvote数・結果を返し、表示できないプロダクトはnullにする', () => {
      const [first] = view.rounds;

      expect(
        first?.nodes.map(({ position, slots }) => ({ position, slots })),
      ).toEqual(
        N13_FIRST_ROUND.map(({ position, participantNos: [a, b = 0] }) => ({
          position,
          slots: [
            {
              participantNo: a,
              seed: null,
              feedLabel: null,
              product: position === 2 ? null : productOf(a),
              upvoteCount: position === 2 ? 3 : position,
              result: null,
            },
            {
              participantNo: b,
              seed: null,
              feedLabel: null,
              product: productOf(b),
              upvoteCount: position === 2 ? 8 : position * 2,
              result: null,
            },
          ],
        })),
      );
      expect(first?.nodes.map(({ match }) => match)).toEqual(
        N13_FIRST_ROUND.map(
          ({ position }) => matchViews.get(matchIdOf(1, position)) ?? null,
        ),
      );
    });

    test('準々決勝以降の未来の枠は「シード<n>」と「<ラウンド名>第<位置>試合の勝者」になる', () => {
      expect(
        view.rounds.slice(1).map(({ nodes }) =>
          nodes.map(({ position, match, slots }) => ({
            position,
            match,
            slots,
          })),
        ),
      ).toEqual([
        [
          {
            position: 1,
            match: null,
            slots: [seedSlot(1), pendingSlot('1回戦第5試合の勝者')],
          },
          {
            position: 2,
            match: null,
            slots: [
              pendingSlot('1回戦第1試合の勝者'),
              pendingSlot('1回戦第2試合の勝者'),
            ],
          },
          {
            position: 3,
            match: null,
            slots: [seedSlot(2), pendingSlot('1回戦第4試合の勝者')],
          },
          {
            position: 4,
            match: null,
            slots: [seedSlot(3), pendingSlot('1回戦第3試合の勝者')],
          },
        ],
        [
          {
            position: 1,
            match: null,
            slots: [
              pendingSlot('準々決勝第1試合の勝者'),
              pendingSlot('準々決勝第2試合の勝者'),
            ],
          },
          {
            position: 2,
            match: null,
            slots: [
              pendingSlot('準々決勝第3試合の勝者'),
              pendingSlot('準々決勝第4試合の勝者'),
            ],
          },
        ],
        [
          {
            position: 1,
            match: null,
            slots: [
              pendingSlot('準決勝第1試合の勝者'),
              pendingSlot('準決勝第2試合の勝者'),
            ],
          },
        ],
      ]);
    });

    test('同じ入力なら同じ値を返し、`kind`が`year`の記録でも同じ形を返す', () => {
      const again = buildBracketRoundsView({
        record,
        matchViews,
        now: noonOf(FIRST_ROUND_DATE),
      });
      const year = buildBracketRoundsView({
        record: { ...record, kind: 'year' },
        matchViews,
        now: noonOf(FIRST_ROUND_DATE),
      });

      expect(again).toEqual(view);
      expect(year).toEqual(view);
    });
  });

  test('確定した勝者は未来の枠に抽選番号を出し、両側が空と確定した位置を含めない', () => {
    const record = recordOf({
      participantCount: 13,
      matches: decided(
        N13_FIRST_ROUND,
        new Map([
          [1, null],
          [2, null],
          [3, 8],
        ]),
      ),
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: viewsOf(record, () => [
        { upvoteCount: 0 },
        { upvoteCount: 0 },
      ]),
      now: noonOf(FIRST_ROUND_DATE),
    });

    expect(
      view.rounds.slice(1).map(({ round, nodes }) => ({
        round,
        nodes: nodes.map(({ position, slots }) => ({ position, slots })),
      })),
    ).toEqual([
      {
        round: 2,
        nodes: [
          {
            position: 1,
            slots: [seedSlot(1), pendingSlot('1回戦第5試合の勝者')],
          },
          {
            position: 3,
            slots: [seedSlot(2), pendingSlot('1回戦第4試合の勝者')],
          },
          {
            position: 4,
            slots: [
              seedSlot(3),
              {
                ...EMPTY_SLOT,
                participantNo: 8,
                feedLabel: '1回戦第3試合の勝者',
              },
            ],
          },
        ],
      },
      {
        round: 3,
        nodes: [
          {
            position: 1,
            slots: [pendingSlot('準々決勝第1試合の勝者'), EMPTY_SLOT],
          },
          {
            position: 2,
            slots: [
              pendingSlot('準々決勝第3試合の勝者'),
              pendingSlot('準々決勝第4試合の勝者'),
            ],
          },
        ],
      },
      {
        round: 4,
        nodes: [
          {
            position: 1,
            slots: [
              pendingSlot('準決勝第1試合の勝者'),
              pendingSlot('準決勝第2試合の勝者'),
            ],
          },
        ],
      },
    ]);
  });

  test('予定を作ったラウンドに無い位置は両側が空と確定した位置として含めない', () => {
    const record = recordOf({
      participantCount: 13,
      matches: [
        ...decided(
          N13_FIRST_ROUND,
          new Map([
            [1, null],
            [2, null],
            [3, 8],
            [4, 10],
            [5, 13],
          ]),
        ),
        {
          round: 2,
          position: 1,
          participantNos: [1, 13],
          matchDate: ROUND2_DATE,
        },
        {
          round: 2,
          position: 3,
          participantNos: [2, 10],
          matchDate: ROUND2_DATE,
        },
        {
          round: 2,
          position: 4,
          participantNos: [3, 8],
          matchDate: ROUND2_DATE,
        },
      ],
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: viewsOf(record, (match) =>
        match.participantNos.map(() => ({ upvoteCount: 1 })),
      ),
      now: noonOf(ROUND2_DATE),
    });

    expect(
      view.rounds.map(({ round, date: on, nodes }) => ({
        round,
        date: on,
        positions: nodes.map(({ position }) => position),
      })),
    ).toEqual([
      { round: 1, date: FIRST_ROUND_DATE, positions: [1, 2, 3, 4, 5] },
      { round: 2, date: ROUND2_DATE, positions: [1, 3, 4] },
      { round: 3, date: date('2027-03-11'), positions: [1, 2] },
      { round: 4, date: date('2027-03-12'), positions: [1] },
    ]);
    expect(view.rounds[1]?.nodes[0]?.slots).toEqual([
      {
        participantNo: 1,
        seed: 1,
        feedLabel: null,
        product: productOf(1),
        upvoteCount: 1,
        result: null,
      },
      {
        participantNo: 13,
        seed: null,
        feedLabel: null,
        product: productOf(13),
        upvoteCount: 1,
        result: null,
      },
    ]);
    expect(view.rounds[2]?.nodes[0]?.slots).toEqual([
      pendingSlot('準々決勝第1試合の勝者'),
      EMPTY_SLOT,
    ]);
  });

  test('不戦勝のマッチは空の側を空の枠にする', () => {
    const record = recordOf({
      participantCount: 13,
      matches: [
        ...decided(
          N13_FIRST_ROUND,
          new Map([
            [1, null],
            [2, null],
            [3, 8],
            [4, null],
            [5, 13],
          ]),
        ),
        {
          round: 2,
          position: 1,
          participantNos: [1, 13],
          matchDate: ROUND2_DATE,
        },
        {
          round: 2,
          position: 3,
          participantNos: [2],
          matchDate: ROUND2_DATE,
          status: 'decided',
          winnerNo: 2,
        },
        {
          round: 2,
          position: 4,
          participantNos: [3, 8],
          matchDate: ROUND2_DATE,
        },
      ],
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: viewsOf(record, (match) =>
        match.participantNos.length === 1
          ? [{ upvoteCount: 0, result: 'bye' }]
          : [{ upvoteCount: 1 }, { upvoteCount: 2 }],
      ),
      now: noonOf(ROUND2_DATE),
    });

    expect(
      view.rounds[1]?.nodes.find(({ position }) => position === 3)?.slots,
    ).toEqual([
      {
        participantNo: 2,
        seed: 2,
        feedLabel: null,
        product: productOf(2),
        upvoteCount: 0,
        result: 'bye',
      },
      EMPTY_SLOT,
    ]);
  });

  test('予定の作成の途中のラウンドは、まだ記録の無い位置を未来の枠として残し、マッチの無い位置の枠に参加者の番号で選んだ表記を付ける', () => {
    const record = recordOf({
      participantCount: 13,
      matches: [
        ...decided(
          N13_FIRST_ROUND,
          new Map([
            [1, 4],
            [2, 6],
            [3, 8],
            [4, 10],
            [5, 12],
          ]),
        ),
        {
          round: 2,
          position: 1,
          participantNos: [1, 12],
          matchDate: ROUND2_DATE,
          status: 'planned',
        },
        {
          round: 2,
          position: 2,
          participantNos: [6],
          matchDate: ROUND2_DATE,
          status: 'planned',
        },
      ],
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: viewsOf(record, (match) =>
        match.status === 'planned'
          ? undefined
          : [{ upvoteCount: 1 }, { upvoteCount: 2 }],
      ),
      now: noonOf(FIRST_ROUND_DATE),
    });

    expect(
      view.rounds[1]?.nodes.map(({ position, match, slots }) => ({
        position,
        match,
        slots,
      })),
    ).toEqual([
      {
        position: 1,
        match: null,
        slots: [
          seedSlot(1),
          { ...EMPTY_SLOT, participantNo: 12, feedLabel: '1回戦第5試合の勝者' },
        ],
      },
      {
        position: 2,
        match: null,
        slots: [
          { ...EMPTY_SLOT, participantNo: 6, feedLabel: '1回戦第2試合の勝者' },
          EMPTY_SLOT,
        ],
      },
      {
        position: 3,
        match: null,
        slots: [
          seedSlot(2),
          {
            ...EMPTY_SLOT,
            participantNo: 10,
            feedLabel: '1回戦第4試合の勝者',
          },
        ],
      },
      {
        position: 4,
        match: null,
        slots: [
          seedSlot(3),
          { ...EMPTY_SLOT, participantNo: 8, feedLabel: '1回戦第3試合の勝者' },
        ],
      },
    ]);
  });

  test('記録の無いラウンドの実施日は、遅れの後は現在の業務日付の翌日以降になる', () => {
    const record = recordOf({
      participantCount: 13,
      matches: decided(
        N13_FIRST_ROUND,
        new Map([
          [1, 4],
          [2, 6],
          [3, 8],
          [4, 10],
          [5, 12],
        ]),
      ),
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: new Map(),
      now: noonOf(date('2027-03-11')),
    });

    expect(
      view.rounds.map(({ round, date: on }) => ({ round, date: on })),
    ).toEqual([
      { round: 1, date: FIRST_ROUND_DATE },
      { round: 2, date: date('2027-03-12') },
      { round: 3, date: date('2027-03-13') },
      { round: 4, date: date('2027-03-14') },
    ]);
    expect(view.rounds[0]?.nodes.map(({ match }) => match)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('優勝で終了したブラケットは優勝の抽選番号を返す', () => {
    const record = recordOf({
      participantCount: 2,
      status: 'finished',
      outcome: 'champion',
      championNo: 2,
      matches: [
        {
          round: 1,
          position: 1,
          participantNos: [1, 2],
          status: 'decided',
          winnerNo: 2,
        },
      ],
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: viewsOf(record, () => [
        { upvoteCount: 4, result: 'lost' },
        { upvoteCount: 9, result: 'won' },
      ]),
      now: noonOf(ROUND2_DATE),
    });

    expect({
      participantCount: view.participantCount,
      seedCount: view.seedCount,
      championNo: view.championNo,
      rounds: view.rounds.map(({ round, name, nodes }) => ({
        round,
        name,
        results: nodes.flatMap(({ slots }) =>
          slots.map(({ participantNo, upvoteCount, result }) => ({
            participantNo,
            upvoteCount,
            result,
          })),
        ),
      })),
    }).toEqual({
      participantCount: 2,
      seedCount: 0,
      championNo: 2,
      rounds: [
        {
          round: 1,
          name: '決勝',
          results: [
            { participantNo: 1, upvoteCount: 4, result: 'lost' },
            { participantNo: 2, upvoteCount: 9, result: 'won' },
          ],
        },
      ],
    });
  });

  test('受賞なしで終了したブラケットは優勝の番号を返さず、終了の後のラウンドを含めない', () => {
    const record = recordOf({
      participantCount: 4,
      status: 'finished',
      outcome: 'no_award',
      matches: [
        {
          round: 1,
          position: 1,
          participantNos: [1, 2],
          status: 'decided',
          winnerNo: null,
        },
        {
          round: 1,
          position: 2,
          participantNos: [3, 4],
          status: 'decided',
          winnerNo: null,
        },
      ],
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: viewsOf(record, () => [
        { upvoteCount: 0, result: 'lost' },
        { upvoteCount: 0, result: 'lost' },
      ]),
      now: noonOf(ROUND2_DATE),
    });

    expect({
      championNo: view.championNo,
      rounds: view.rounds.map(({ round, name, nodes }) => ({
        round,
        name,
        positions: nodes.map(({ position }) => position),
      })),
    }).toEqual({
      championNo: null,
      rounds: [{ round: 1, name: '準決勝', positions: [1, 2] }],
    });
  });

  test.each([
    {
      name: '参加0',
      fixture: { participantCount: 0, status: 'finished', outcome: 'no_award' },
      championNo: null,
    },
    {
      name: '参加1',
      fixture: {
        participantCount: 1,
        status: 'finished',
        outcome: 'champion',
        championNo: 1,
      },
      championNo: 1,
    },
  ] satisfies readonly {
    readonly name: string;
    readonly fixture: RecordFixture;
    readonly championNo: number | null;
  }[])('$nameのブラケットはラウンドを空で返す', ({ fixture, championNo }) => {
    const view = buildBracketRoundsView({
      record: recordOf({ ...fixture, firstRoundDate: null }),
      matchViews: new Map(),
      now: noonOf(FIRST_ROUND_DATE),
    });

    expect(view).toEqual({
      participantCount: fixture.participantCount,
      seedCount: 0,
      rounds: [],
      championNo,
    });
  });

  test('1回戦の予定の前は、非シードの枠を表記もプロダクトも無い抽選番号だけの枠にする', () => {
    const view = buildBracketRoundsView({
      record: recordOf({ participantCount: 13 }),
      matchViews: new Map(),
      now: noonOf(date('2027-03-08')),
    });

    expect(
      view.rounds.slice(0, 2).map(({ round, date: on, nodes }) => ({
        round,
        date: on,
        first: nodes[0],
      })),
    ).toEqual([
      {
        round: 1,
        date: FIRST_ROUND_DATE,
        first: {
          position: 1,
          match: null,
          slots: [
            { ...EMPTY_SLOT, participantNo: 4 },
            { ...EMPTY_SLOT, participantNo: 5 },
          ],
        },
      },
      {
        round: 2,
        date: ROUND2_DATE,
        first: {
          position: 1,
          match: null,
          slots: [seedSlot(1), pendingSlot('1回戦第5試合の勝者')],
        },
      },
    ]);
  });

  test('位置が1つも残らず飛ばしたラウンドは含めない', () => {
    const record = recordOf({
      participantCount: 13,
      matches: [1, 3, 4].map((position, index) => ({
        round: 2,
        position,
        participantNos: [index + 1] as const,
      })),
    });

    const view = buildBracketRoundsView({
      record,
      matchViews: new Map(),
      now: noonOf(FIRST_ROUND_DATE),
    });

    expect(
      view.rounds.map(({ round, date: on, nodes }) => ({
        round,
        date: on,
        positions: nodes.map(({ position }) => position),
      })),
    ).toEqual([
      { round: 2, date: FIRST_ROUND_DATE, positions: [1, 3, 4] },
      { round: 3, date: ROUND2_DATE, positions: [1, 2] },
      { round: 4, date: date('2027-03-11'), positions: [1] },
    ]);
  });

  test('1回戦の日が無い参加2以上の記録は実施日を求められずRangeErrorを投げる', () => {
    expect(() =>
      buildBracketRoundsView({
        record: recordOf({ participantCount: 13, firstRoundDate: null }),
        matchViews: new Map(),
        now: noonOf(FIRST_ROUND_DATE),
      }),
    ).toThrow(RangeError);
  });
});
