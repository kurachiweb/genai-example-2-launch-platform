import { describe, expect, test } from 'bun:test';

import { decideAtFullTime } from '../../../lib/core/match/match-decision.ts';
import { matchWindow } from '../../../lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  baseInstantOf,
  launchOf,
  productAt,
  QUALIFIER_PARTNER_INDEX,
  type EntityContext,
} from './entities.ts';
import {
  dayOffsetOf,
  isByeAt,
  loserIndexOf,
  matchAt,
  pairingDaysOf,
  qualifierPlanOf,
  tomorrowMatchOf,
  winnerIndexOf,
} from './qualifier-history.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from './scale-profile.ts';

const BASE_DATE = '2026-11-24';

const entities = (
  profile: EntityContext['profile'] = SMOKE_PROFILE,
): EntityContext => ({ seed: 1, baseDate: BASE_DATE, profile });

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const DAY_MS = 86_400_000;

describe('qualifierPlanOf', () => {
  test('想定規模では、全てのプロダクトの作成の後の約218日に10万件の勝利を1日約459件で置く', () => {
    const plan = qualifierPlanOf(entities(YEAR_ONE_PROFILE));

    expect(plan.wins).toBe(100_000);
    expect(plan.days).toBe(218);
    expect(plan.maxMatchesPerDay).toBe(459);
  });

  test('検証用の規模では、勝利の件数と同じ日数に1日1件ずつ置く', () => {
    const plan = qualifierPlanOf(entities());

    expect(plan.wins).toBe(100);
    expect(plan.days).toBe(100);
    expect(plan.maxMatchesPerDay).toBe(1);
  });

  test('プロダクトが少なすぎて同じ日の側が重なる規模は例外にする', () => {
    expect(() =>
      qualifierPlanOf(entities({ ...SMOKE_PROFILE, users: 50, products: 5 })),
    ).toThrow(/プロダクトの数/u);
    expect(() =>
      qualifierPlanOf(
        entities({
          ...YEAR_ONE_PROFILE,
          users: 50_000,
          products: 500,
          qualifierWins: 100_000,
        }),
      ),
    ).toThrow(/プロダクトの数/u);
  });
});

describe('勝利の分布(想定規模)', () => {
  const plan = qualifierPlanOf(entities(YEAR_ONE_PROFILE));

  test('全てのプロダクトが予選に1回以上勝ち、勝利の数の差は1以内である', () => {
    const wins = new Map<number, number>();
    for (let index = 0; index < plan.wins; index += 1) {
      const winner = winnerIndexOf(plan, index);
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }

    expect(wins.size).toBe(YEAR_ONE_PROFILE.products);
    expect(
      Math.max(...wins.values()) - Math.min(...wins.values()),
    ).toBeLessThanOrEqual(1);
  });

  test('勝利は全ての日に1日440〜460件ずつあり、昨日から218日前まで古い順に並ぶ', () => {
    const perDay = new Map<number, number>();
    let previous = Number.POSITIVE_INFINITY;
    for (let index = 0; index < plan.wins; index += 1) {
      const offset = dayOffsetOf(plan, index);
      expect(offset).toBeLessThanOrEqual(previous);
      previous = offset;
      perDay.set(offset, (perDay.get(offset) ?? 0) + 1);
    }

    expect([...perDay.keys()].toSorted((a, b) => a - b)).toEqual(
      Array.from({ length: 218 }, (_, index) => index + 1),
    );
    expect(Math.min(...perDay.values())).toBeGreaterThanOrEqual(440);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(460);
  });

  test('同じ日に同じプロダクトが2つの側に現れず、勝者と敗者も別のプロダクトである', () => {
    const used = new Map<number, Set<number>>();
    for (let index = 0; index < plan.wins; index += 1) {
      const offset = dayOffsetOf(plan, index);
      const set = used.get(offset) ?? new Set<number>();
      used.set(offset, set);
      const sides = [
        winnerIndexOf(plan, index),
        loserIndexOf(plan, index),
      ].filter((side) => side !== undefined);
      for (const side of sides) {
        expect(set.has(side)).toBe(false);
        set.add(side);
      }
    }
  });

  test('10件に1件は対戦相手の居ない不戦勝になる', () => {
    const byes = Array.from({ length: plan.wins }, (_, index) =>
      isByeAt(plan, index),
    ).filter(Boolean).length;

    expect(byes).toBe(10_000);
    expect(loserIndexOf(plan, 9)).toBeUndefined();
    expect(loserIndexOf(plan, 8)).toBeDefined();
  });
});

describe('matchAt', () => {
  const plan = qualifierPlanOf(entities());
  const context = entities();

  test('同じ種と基準日なら同じマッチを返し、IDはULIDの形式で全て異なる', () => {
    const first = matchAt(plan, 3);

    expect(matchAt(plan, 3)).toEqual(first);
    const ids = [
      first.matchId,
      first.winner.entryId,
      first.winner.launchId,
      first.loser?.entryId,
      first.loser?.launchId,
      ...first.upvotes.map((upvote) => upvote.id),
    ].filter((id) => id !== undefined);
    expect(ids.every((id) => ULID.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('マッチの時間帯は業務日付の0:00〜23:40で、確定は終了より後、作成は開始の前にある', () => {
    const match = matchAt(plan, 50);
    const window = matchWindow(parseBusinessDate(match.matchDate));

    expect(match.startsAt).toEqual(window.startsAt);
    expect(match.endsAt).toEqual(window.endsAt);
    expect(match.decidedAt.getTime()).toBeGreaterThan(match.endsAt.getTime());
    expect(match.createdAt.getTime()).toBeLessThan(match.startsAt.getTime());
    expect(match.startsAt.getTime()).toBeLessThan(
      baseInstantOf(BASE_DATE).getTime(),
    );
  });

  test('ローンチの作成はどのプロダクトの作成より後で、勝つ側のローンチは勝ち・負ける側は負けで確定する', () => {
    const lastProduct = productAt(context, SMOKE_PROFILE.products - 1);
    const oldest = matchAt(plan, 0);

    expect(oldest.winner.launchCreatedAt.getTime()).toBeGreaterThan(
      lastProduct.createdAt.getTime(),
    );
    expect(oldest.winner.launchOutcome).toBe('won');
    expect(matchAt(plan, 1).loser?.launchOutcome).toBe('lost');
  });

  test('不戦勝は側が1つで、開始と同時に確定し、Upvoteを持たない', () => {
    const match = matchAt(plan, 9);

    expect(match.bye).toBe(true);
    expect(match.loser).toBeUndefined();
    expect(match.decision).toBe('bye');
    expect(match.winner.result).toBe('bye');
    expect(match.winner.slot).toBe(1);
    expect(match.upvotes).toEqual([]);
    expect(match.decidedAt).toEqual(match.startedAt);
  });

  test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 14, 24, 99])(
    '勝敗はUpvoteの集計値と記録から、上流の確定の規則(decideAtFullTime)で同じ結果になる(%i)',
    (index) => {
      const match = matchAt(plan, index);
      const { winner, loser } = match;
      if (loser === undefined) {
        expect(match.upvotes).toHaveLength(0);
        return;
      }
      const tally = (side: typeof winner) => {
        const own = match.upvotes.filter(
          (upvote) => upvote.entryId === side.entryId,
        );
        const last = own.at(-1);
        expect(own).toHaveLength(side.upvoteCount);
        expect(side.lastUpvotedAt).toEqual(last?.upvotedAt ?? null);
        expect(side.lastUpvoteSeq).toBe(last?.seq ?? null);
        return {
          entryId: side.entryId,
          upvoteCount: side.upvoteCount,
          lastUpvotedAt: side.lastUpvotedAt,
          lastUpvoteSeq: side.lastUpvoteSeq,
        };
      };
      const sides = [winner, loser].toSorted((a, b) => a.slot - b.slot);
      const outcome = decideAtFullTime([
        tally(sides[0] as typeof winner),
        tally(sides[1] as typeof winner),
      ]);

      expect(outcome.decision).toBe(match.decision);
      expect(outcome.results.get(winner.entryId)).toBe('won');
      expect(outcome.results.get(loser.entryId)).toBe('lost');
      expect(match.upvotes.map((upvote) => upvote.seq)).toEqual(
        match.upvotes.map((_, position) => position + 1),
      );
    },
  );

  test('Upvoteした利用者は互いに異なり、対戦する2つのプロダクトの投稿者ではない', () => {
    for (let index = 0; index < plan.wins; index += 1) {
      const match = matchAt(plan, index);
      const owners = new Set([
        match.winner.productIndex,
        match.loser?.productIndex,
      ]);
      const voters = match.upvotes.map((upvote) => upvote.userIndex);

      expect(new Set(voters).size).toBe(voters.length);
      expect(voters.some((voter) => owners.has(voter))).toBe(false);
      expect(voters.every((voter) => voter < SMOKE_PROFILE.products)).toBe(
        true,
      );
    }
  });

  test('確定から29日以内のマッチだけがマッチイベントを持つ', () => {
    const year = qualifierPlanOf(entities(YEAR_ONE_PROFILE));
    const recent = matchAt(year, year.wins - 1);
    const old = matchAt(year, 0);

    expect(recent.hasEvents).toBe(true);
    expect(old.hasEvents).toBe(false);
    expect(
      (baseInstantOf(BASE_DATE).getTime() - recent.decidedAt.getTime()) /
        DAY_MS,
    ).toBeLessThan(29);
  });

  test('範囲外の勝利の番号は例外にする', () => {
    expect(() => matchAt(plan, -1)).toThrow(RangeError);
    expect(() => matchAt(plan, plan.wins)).toThrow(RangeError);
  });
});

describe('pairingDaysOf', () => {
  test('日ごとのマッチの数と側の数が、各日の勝利から数えた値と一致する', () => {
    const plan = qualifierPlanOf(entities());
    const days = pairingDaysOf(plan);

    expect(days).toHaveLength(100);
    expect(days.reduce((total, day) => total + day.matchCount, 0)).toBe(100);
    const sides = Array.from({ length: plan.wins }, (_, index) =>
      isByeAt(plan, index) ? 1 : 2,
    ).reduce((total, count) => total + count, 0);
    expect(days.reduce((total, day) => total + day.launchCount, 0)).toBe(sides);
    expect(new Set(days.map((day) => day.matchDate)).size).toBe(100);
  });
});

describe('tomorrowMatchOf', () => {
  const tomorrow = tomorrowMatchOf(entities());

  test('基準日の翌業務日の0:00に開始する予定の、2つの側の未開始のマッチにする', () => {
    expect(tomorrow.matchDate).toBe('2026-11-25');
    expect(tomorrow.startsAt.toISOString()).toBe('2026-11-25T08:00:00.000Z');
    expect(tomorrow.endsAt.toISOString()).toBe('2026-11-26T07:40:00.000Z');
    expect(tomorrow.sides.map((side) => side.productIndex)).toEqual([
      0,
      QUALIFIER_PARTNER_INDEX,
    ]);
    expect(tomorrow.sides.map((side) => side.slot)).toEqual([1, 2]);
    expect(tomorrow.createdAt.getTime()).toBeLessThanOrEqual(
      baseInstantOf(BASE_DATE).getTime(),
    );
  });

  test('側のローンチは2.1が作った翌業務日の未確定のローンチと同じIDである', () => {
    const [creator, partner] = tomorrow.sides;

    expect(creator.launchId).toBe(launchOf(entities(), 0).id);
    expect(partner.launchId).toBe(launchOf(entities(), 1).id);
    expect(creator.productId).toBe(productAt(entities(), 0).id);
    expect(partner.productId).toBe(productAt(entities(), 1).id);
  });
});
