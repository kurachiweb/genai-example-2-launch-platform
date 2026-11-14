import { describe, expect, test } from 'bun:test';

import {
  GOAL_STAND_DOTS,
  MAX_CROWD_DOTS,
  SIDE_STAND_DOTS,
  crowdCells,
  crowdCountOf,
  crowdRowsOf,
  dotDelay,
  isCrowdStill,
  pointsOf,
  secondsOf,
  sideStandCells,
} from './pitch-model.ts';

describe('観客の上限', () => {
  test('ゴール裏は6列で割り切れる数にし、溢れた分を2つのサイドスタンドで分け合う', () => {
    expect(MAX_CROWD_DOTS).toBe(400);
    expect(GOAL_STAND_DOTS % 6).toBe(0);
    expect(GOAL_STAND_DOTS + SIDE_STAND_DOTS * 2).toBe(MAX_CROWD_DOTS);
  });
});

describe('crowdCountOf', () => {
  test('Upvote数に応援の1人を加えた数を観客にする', () => {
    expect(crowdCountOf(0, false)).toBe(1);
    expect(crowdCountOf(12, false)).toBe(13);
  });

  test('無人のピッチは観客を置かない', () => {
    expect(crowdCountOf(12, true)).toBe(0);
  });
});

describe('crowdRowsOf', () => {
  test.each([
    [1, 3],
    [20, 3],
    [21, 4],
    [60, 4],
    [61, 6],
  ])('観客が%i人ならゴール裏を%i列にする', (count, rows) => {
    expect(crowdRowsOf(count)).toBe(rows);
  });
});

describe('crowdCells', () => {
  test('列を先に埋め、行の数で次の席の列へ進む', () => {
    const { cells, cols } = crowdCells(7, 3);

    expect(cols).toBe(3);
    expect(cells).toHaveLength(7);
    expect(cells[0]).toStrictEqual({ row: 0, col: 0, index: 0 });
    expect(cells[4]).toStrictEqual({ row: 1, col: 1, index: 4 });
    expect(cells[6]).toStrictEqual({ row: 0, col: 2, index: 6 });
  });

  test('ゴール裏の上限を超える観客はゴール裏に置かない', () => {
    const { cells, cols } = crowdCells(1000, 6);

    expect(cells).toHaveLength(GOAL_STAND_DOTS);
    expect(cols).toBe(GOAL_STAND_DOTS / 6);
  });

  test.each([0, -3])('観客が%i人なら席を置かず、列は1つとして扱う', (count) => {
    expect(crowdCells(count, 3)).toStrictEqual({ cells: [], cols: 1 });
  });
});

describe('sideStandCells', () => {
  test('ゴール裏に収まる観客はサイドスタンドに置かない', () => {
    expect(sideStandCells(GOAL_STAND_DOTS, 4)).toStrictEqual([[], []]);
  });

  test('ゴール裏から溢れた観客を2つのサイドスタンドへ交互に振り分ける', () => {
    const [near, far] = sideStandCells(GOAL_STAND_DOTS + 5, 4);

    expect(near.map(({ index }) => index)).toStrictEqual([
      GOAL_STAND_DOTS,
      GOAL_STAND_DOTS + 2,
      GOAL_STAND_DOTS + 4,
    ]);
    expect(far.map(({ index }) => index)).toStrictEqual([
      GOAL_STAND_DOTS + 1,
      GOAL_STAND_DOTS + 3,
    ]);
    expect(near[2]).toStrictEqual({
      row: 2,
      col: 0,
      index: GOAL_STAND_DOTS + 4,
    });
  });

  test('サイドスタンドの席は行を埋めてからゴール裏から離れた列へ進む', () => {
    const [near] = sideStandCells(GOAL_STAND_DOTS + 10, 4);

    expect(near[4]).toStrictEqual({
      row: 0,
      col: 1,
      index: GOAL_STAND_DOTS + 8,
    });
  });

  test('観客の上限を超える分はどのスタンドにも置かない', () => {
    const [near, far] = sideStandCells(10_000, 4);

    expect(near).toHaveLength(SIDE_STAND_DOTS);
    expect(far).toHaveLength(SIDE_STAND_DOTS);
  });
});

describe('dotDelay', () => {
  test('同じ観客には常に同じ0秒以上1秒以下の遅延を返す', () => {
    for (let index = 0; index < 50; index += 1) {
      const delay = dotDelay(index);
      const seconds = Number.parseFloat(delay);

      expect(delay).toMatch(/^\d\.\d{2}s$/u);
      expect(seconds).toBeGreaterThanOrEqual(0);
      expect(seconds).toBeLessThanOrEqual(1);
      expect(dotDelay(index)).toBe(delay);
    }
  });

  test('隣り合う観客の遅延を散らす', () => {
    const delays = new Set(Array.from({ length: 20 }, (_, i) => dotDelay(i)));

    expect(delays.size).toBeGreaterThan(10);
  });
});

describe('isCrowdStill', () => {
  test('結果が出ていなければどちらの観客も動ける', () => {
    expect(isCrowdStill('left', null)).toBe(false);
    expect(isCrowdStill('right', undefined)).toBe(false);
  });

  test('勝者の側だけが動け、敗者の側は静まる', () => {
    expect(isCrowdStill('left', 'left')).toBe(false);
    expect(isCrowdStill('right', 'left')).toBe(true);
  });

  test('両者敗北ではどちらの観客も静まる', () => {
    expect(isCrowdStill('left', 'none')).toBe(true);
    expect(isCrowdStill('right', 'none')).toBe(true);
  });
});

describe('SVGの属性の文字列', () => {
  test('座標の並びを「x,y x,y」の形にする', () => {
    expect(
      pointsOf([
        [1, 2],
        [3.5, -4],
      ]),
    ).toBe('1,2 3.5,-4');
  });

  test('秒数をCSSの時間の形にする', () => {
    expect(secondsOf(0.35)).toBe('0.35s');
    expect(secondsOf(0)).toBe('0s');
  });
});
