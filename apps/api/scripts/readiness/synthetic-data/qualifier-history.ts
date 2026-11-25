import { matchWindow } from '../../../lib/core/match/match-model.ts';
import {
  addBusinessDays,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  baseInstantOf,
  LARGEST_CREATOR_INDEX,
  launchOf,
  productAt,
  QUALIFIER_PARTNER_INDEX,
  userAt,
  type EntityContext,
} from './entities.ts';
import { deterministicUlid } from './random.ts';

export interface QualifierPlan {
  readonly entities: EntityContext;
  readonly products: number;
  readonly wins: number;
  readonly days: number;
  readonly stride: number;
  readonly loserShift: number;
  readonly maxMatchesPerDay: number;
}

export interface PlannedSide {
  readonly productIndex: number;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly launchId: string;
  readonly launchCreatedAt: Date;
  readonly launchOutcome: 'won' | 'lost';
  readonly entryId: string;
  readonly slot: 1 | 2;
  readonly result: 'won' | 'lost' | 'bye';
  readonly upvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  readonly lastUpvoteSeq: number | null;
}

export interface PlannedUpvote {
  readonly id: string;
  readonly userIndex: number;
  readonly userId: string;
  readonly entryId: string;
  readonly seq: number;
  readonly upvotedAt: Date;
}

export interface PlannedMatch {
  readonly index: number;
  readonly dayOffset: number;
  readonly matchDate: string;
  readonly matchId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdAt: Date;
  readonly startedAt: Date;
  readonly decidedAt: Date;
  readonly decision: 'votes' | 'bye';
  readonly bye: boolean;
  readonly hasEvents: boolean;
  readonly winner: PlannedSide;
  readonly loser: PlannedSide | undefined;
  readonly upvotes: readonly PlannedUpvote[];
}

export interface PairingDay {
  readonly dayOffset: number;
  readonly matchDate: string;
  readonly matchCount: number;
  readonly launchCount: number;
  readonly createdAt: Date;
  readonly completedAt: Date;
}

export interface TomorrowSide {
  readonly productIndex: number;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly launchId: string;
  readonly entryId: string;
  readonly slot: 1 | 2;
}

export interface TomorrowMatch {
  readonly matchId: string;
  readonly matchDate: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly createdAt: Date;
  readonly sides: readonly [TomorrowSide, TomorrowSide];
}

const DAY_MS = 86_400_000;

const MINUTE_MS = 60_000;

const SECOND_MS = 1_000;

const HOUR_MS = 3_600_000;

// ローンチの登録は、予選を組む前日の23:45より前に済んでいる
const LAUNCH_LEAD_MS = DAY_MS;

// 予選は前日の23:45に組む(match-engineのPAIRING_TIME)
const PAIRING_LEAD_MS = 15 * MINUTE_MS;

const PAIRING_DURATION_MS = 30 * SECOND_MS;

// 0:00と23:40のジョブが実行の時刻で書く確定・開始の日時の遅れ
const KICKOFF_DELAY_MS = 3 * SECOND_MS;

const SETTLEMENT_DELAY_MS = 5 * SECOND_MS;

const FIRST_UPVOTE_AFTER_START_MS = 2 * HOUR_MS;

const UPVOTE_INTERVAL_MS = 17 * MINUTE_MS;

const BYE_PERIOD = 10;

const BYE_REMAINDER = 9;

const CLOSE_MATCH_PERIOD = 5;

const CLOSE_MATCH_REMAINDER = 4;

// match-engineのマッチイベントの保持期間(30日)より短い範囲のマッチにだけ、完了済みのイベントを持たせる
export const EVENT_HISTORY_DAYS = 29;

const MIN_PRODUCTS = 6;

const MAX_UPVOTES_PER_MATCH = 3;

// プロダクトの数と互いに素な値。連続する番号を離れたプロダクトに散らす
const STRIDE_CANDIDATES = Object.freeze([
  97, 89, 83, 79, 73, 71, 67, 61, 59, 53, 47, 43, 41, 37, 31, 29, 23, 19, 17,
  13, 11, 7, 5, 3,
]);

const greatestCommonDivisor = (a: number, b: number): number =>
  b === 0 ? a : greatestCommonDivisor(b, a % b);

function strideFor(products: number): number {
  const stride = STRIDE_CANDIDATES.find(
    (candidate) => greatestCommonDivisor(candidate, products) === 1,
  );
  if (stride === undefined) {
    throw new RangeError(
      `プロダクトの数(${String(products)})と互いに素な刻みを選べません`,
    );
  }
  return stride;
}

// 最後に作ったプロダクトの作成の日より後のローンチの登録の日までを、勝利を置く日の範囲にする
function availableDays(entities: EntityContext): number {
  const lastCreatedAt = productAt(
    entities,
    entities.profile.products - 1,
  ).createdAt;
  const ageDays = Math.floor(
    (baseInstantOf(entities.baseDate).getTime() - lastCreatedAt.getTime()) /
      DAY_MS,
  );
  return Math.max(0, ageDays - 1);
}

// 同じ日の勝者の列と敗者の列が、互いと自身の列の中で重ならないよう、プロダクトの数に下限を課す
export function qualifierPlanOf(entities: EntityContext): QualifierPlan {
  const { products, qualifierWins: wins } = entities.profile;
  if (products < MIN_PRODUCTS) {
    throw new RangeError(
      `プロダクトの数は${String(MIN_PRODUCTS)}以上にしてください: ${String(products)}`,
    );
  }
  const days = Math.min(availableDays(entities), wins);
  if (days < 1) {
    throw new RangeError('予選の勝利を置ける日がありません');
  }
  const maxMatchesPerDay = Math.ceil(wins / days);
  if (products < 2 * maxMatchesPerDay + 1) {
    throw new RangeError(
      `プロダクトの数(${String(products)})が、1日の予選の勝利(${String(maxMatchesPerDay)}件)の両側を重ならずに置くには足りません`,
    );
  }
  return {
    entities,
    products,
    wins,
    days,
    stride: strideFor(products),
    loserShift: maxMatchesPerDay + 1,
    maxMatchesPerDay,
  };
}

function assertWinIndex(plan: QualifierPlan, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= plan.wins) {
    throw new RangeError(
      `勝利の番号は0以上${String(plan.wins)}未満の整数で指定してください: ${String(index)}`,
    );
  }
}

// 勝利の番号が小さいほど古い。昨日を1とし、古い日ほど大きい
export const dayOffsetOf = (plan: QualifierPlan, index: number): number =>
  plan.days - Math.floor((index * plan.days) / plan.wins);

export const isByeAt = (_plan: QualifierPlan, index: number): boolean =>
  index % BYE_PERIOD === BYE_REMAINDER;

export const winnerIndexOf = (plan: QualifierPlan, index: number): number =>
  (index * plan.stride) % plan.products;

export const loserIndexOf = (
  plan: QualifierPlan,
  index: number,
): number | undefined =>
  isByeAt(plan, index)
    ? undefined
    : ((index + plan.loserShift) * plan.stride) % plan.products;

const matchDateOf = (plan: QualifierPlan, dayOffset: number): string =>
  addBusinessDays(parseBusinessDate(plan.entities.baseDate), -dayOffset);

// 勝つ側が2票、負ける側が1票の接戦を5件に1件だけ作り、他は勝つ側の1票だけにして行の数を抑える
function upvoteSidesOf(index: number): readonly ('winner' | 'loser')[] {
  return index % CLOSE_MATCH_PERIOD === CLOSE_MATCH_REMAINDER
    ? ['winner', 'loser', 'winner']
    : ['winner'];
}

function upvoterIndexes(
  plan: QualifierPlan,
  index: number,
  count: number,
  excluded: readonly (number | undefined)[],
): number[] {
  const chosen: number[] = [];
  for (let step = 0; chosen.length < count; step += 1) {
    const candidate =
      ((index * MAX_UPVOTES_PER_MATCH + 1 + step) * plan.stride) %
      plan.products;
    if (!excluded.includes(candidate)) {
      chosen.push(candidate);
    }
  }
  return chosen;
}

interface SideInput {
  readonly key: string;
  readonly role: 'winner' | 'loser';
  readonly productIndex: number;
  readonly slot: 1 | 2;
  readonly launchCreatedAt: Date;
  readonly createdAt: Date;
  readonly result: PlannedSide['result'];
  readonly upvotes: readonly PlannedUpvote[];
}

function sideOf(
  entities: EntityContext,
  input: SideInput,
  entryIdOf: (role: string) => string,
): PlannedSide {
  const { seed } = entities;
  const product = productAt(entities, input.productIndex);
  const own = input.upvotes.filter(
    (upvote) => upvote.entryId === entryIdOf(input.role),
  );
  const last = own.at(-1);
  return {
    productIndex: input.productIndex,
    productId: product.id,
    ownerUserId: product.ownerId,
    launchId: deterministicUlid(
      input.launchCreatedAt,
      `${String(seed)}:${input.key}:launch:${input.role}`,
    ),
    launchCreatedAt: input.launchCreatedAt,
    launchOutcome: input.role === 'winner' ? 'won' : 'lost',
    entryId: entryIdOf(input.role),
    slot: input.slot,
    result: input.result,
    upvoteCount: own.length,
    lastUpvotedAt: last?.upvotedAt ?? null,
    lastUpvoteSeq: last?.seq ?? null,
  };
}

export function matchAt(plan: QualifierPlan, index: number): PlannedMatch {
  assertWinIndex(plan, index);
  const { entities } = plan;
  const { seed } = entities;
  const key = `qm:${String(index)}`;
  const dayOffset = dayOffsetOf(plan, index);
  const matchDate = matchDateOf(plan, dayOffset);
  const { startsAt, endsAt } = matchWindow(parseBusinessDate(matchDate));
  const createdAt = new Date(startsAt.getTime() - PAIRING_LEAD_MS);
  const launchCreatedAt = new Date(startsAt.getTime() - LAUNCH_LEAD_MS);
  const bye = isByeAt(plan, index);
  const startedAt = new Date(startsAt.getTime() + KICKOFF_DELAY_MS);
  const winnerIndex = winnerIndexOf(plan, index);
  const loserIndex = loserIndexOf(plan, index);
  const entryIdOf = (role: string): string =>
    deterministicUlid(createdAt, `${String(seed)}:${key}:entry:${role}`);

  const voterIndexes = upvoterIndexes(
    plan,
    index,
    bye ? 0 : upvoteSidesOf(index).length,
    [winnerIndex, loserIndex],
  );
  const upvotes = voterIndexes.map((userIndex, position): PlannedUpvote => {
    const seq = position + 1;
    const upvotedAt = new Date(
      startsAt.getTime() +
        FIRST_UPVOTE_AFTER_START_MS +
        seq * UPVOTE_INTERVAL_MS,
    );
    return {
      id: deterministicUlid(
        upvotedAt,
        `${String(seed)}:${key}:upvote:${String(seq)}`,
      ),
      userIndex,
      userId: userAt(entities, userIndex).id,
      entryId: entryIdOf(upvoteSidesOf(index)[position] ?? 'winner'),
      seq,
      upvotedAt,
    };
  });

  const winnerSlot = index % 2 === 0 ? 1 : 2;
  const common = { key, launchCreatedAt, createdAt, upvotes } as const;
  const winner = sideOf(
    entities,
    {
      ...common,
      role: 'winner',
      productIndex: winnerIndex,
      slot: bye ? 1 : winnerSlot,
      result: bye ? 'bye' : 'won',
    },
    entryIdOf,
  );
  const loser =
    loserIndex === undefined
      ? undefined
      : sideOf(
          entities,
          {
            ...common,
            role: 'loser',
            productIndex: loserIndex,
            slot: winnerSlot === 1 ? 2 : 1,
            result: 'lost',
          },
          entryIdOf,
        );

  return {
    index,
    dayOffset,
    matchDate,
    matchId: deterministicUlid(createdAt, `${String(seed)}:${key}`),
    startsAt,
    endsAt,
    createdAt,
    startedAt,
    decidedAt: bye
      ? startedAt
      : new Date(endsAt.getTime() + SETTLEMENT_DELAY_MS),
    decision: bye ? 'bye' : 'votes',
    bye,
    hasEvents: dayOffset <= EVENT_HISTORY_DAYS,
    winner,
    loser,
    upvotes,
  };
}

export function pairingDaysOf(plan: QualifierPlan): readonly PairingDay[] {
  const counts = new Map<number, { matches: number; launches: number }>();
  for (let index = 0; index < plan.wins; index += 1) {
    const offset = dayOffsetOf(plan, index);
    const current = counts.get(offset) ?? { matches: 0, launches: 0 };
    counts.set(offset, {
      matches: current.matches + 1,
      launches: current.launches + (isByeAt(plan, index) ? 1 : 2),
    });
  }
  return [...counts]
    .toSorted(([left], [right]) => right - left)
    .map(([dayOffset, { matches, launches }]) => {
      const matchDate = matchDateOf(plan, dayOffset);
      const { startsAt } = matchWindow(parseBusinessDate(matchDate));
      const createdAt = new Date(startsAt.getTime() - PAIRING_LEAD_MS);
      return {
        dayOffset,
        matchDate,
        matchCount: matches,
        launchCount: launches,
        createdAt,
        completedAt: new Date(createdAt.getTime() + PAIRING_DURATION_MS),
      };
    });
}

// 作り手とその対戦相手の、2.1が作った翌業務日の未確定のローンチを組んだ、0:00の開始を待つ未開始のマッチ
export function tomorrowMatchOf(entities: EntityContext): TomorrowMatch {
  const matchDate = addBusinessDays(parseBusinessDate(entities.baseDate), 1);
  const { startsAt, endsAt } = matchWindow(matchDate);
  const createdAt = baseInstantOf(entities.baseDate);
  const seed = String(entities.seed);
  const sideAt = (productIndex: number, slot: 1 | 2): TomorrowSide => {
    const product = productAt(entities, productIndex);
    return {
      productIndex,
      productId: product.id,
      ownerUserId: product.ownerId,
      launchId: launchOf(entities, productIndex).id,
      entryId: deterministicUlid(
        createdAt,
        `${seed}:qm:tomorrow:entry:${String(slot)}`,
      ),
      slot,
    };
  };
  return {
    matchId: deterministicUlid(createdAt, `${seed}:qm:tomorrow`),
    matchDate,
    startsAt,
    endsAt,
    createdAt,
    sides: [
      sideAt(LARGEST_CREATOR_INDEX, 1),
      sideAt(QUALIFIER_PARTNER_INDEX, 2),
    ],
  };
}
