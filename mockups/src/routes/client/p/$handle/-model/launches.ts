import { ROUND_LABEL } from '#/components/client/match/model';
import type { MatchKind, Round } from '#/components/client/match/model';
import { PRODUCTS } from '#/lib/mock-data';
import type { Product } from '#/lib/mock-data';

import {
  addDays,
  addMinutes,
  at,
  atTime,
  matchEndOf,
  startOfDay,
  weekPaymentDeadline,
  weekRoundDate,
  yearFinalAfter,
  yearPaymentDeadlineOf,
  yearRoundDate,
} from './clock';
import type { ProductSearch } from './options';
import { latestOutcome } from './plan';
import type { LaunchState, Plan, PlannedMatch } from './plan';

export type OpponentView =
  { status: 'public' | 'unlisted'; product: Product } | { status: 'private' };

export type MatchResult = 'win' | 'loss' | 'both-lose' | 'bye' | 'early';

export type HistoryMatch = {
  id: string;
  kind: MatchKind;
  round: Round | null;
  date: Date;
  result: MatchResult;
  ownVotes: number | null;
  opponentVotes: number | null;
  // 同数で勝敗を最終Upvote時間で決めた場合の結果
  tieBreak: 'won' | 'lost' | null;
  opponent: OpponentView | null;
  // 退会・停止したユーザーを除いたサポーター数(FR-DIR-011)
  supporterCount: number;
};

export type LaunchHighlight = {
  label: string;
  tone: 'gold' | 'primary' | 'muted' | 'live';
};

export type LaunchView = {
  id: string;
  number: number;
  date: Date;
  state: LaunchState;
  // 新しい順
  matches: HistoryMatch[];
  highlights: LaunchHighlight[];
};

export type Timeline = {
  // 新しい順
  launches: LaunchView[];
  // モックの現在時刻(基準時刻の日付・曜日が状態と矛盾しないよう状態ごとに固定する)
  now: Date;
  // 進行状況が指すローンチ(予選前・予選中なら次のローンチ)の日付
  currentLaunchDate: Date | null;
  weekDeadline: Date | null;
  yearDeadline: Date | null;
  live: { kind: MatchKind; round: Round | null; date: Date } | null;
};

const WIN_SCORES: [number, number][] = [
  [42, 17],
  [88, 61],
  [23, 9],
  [57, 44],
  [31, 12],
  [76, 70],
  [19, 6],
  [64, 38],
  [27, 25],
  [103, 87],
];
const LOSS_SCORES: [number, number][] = [
  [12, 31],
  [45, 52],
  [8, 22],
];
const LATEST_SCORES: Record<ProductSearch['votes'], [number, number]> = {
  '130-100': [130, 100],
  '4-30': [4, 30],
  '30-30': [30, 30],
  '0-0': [0, 0],
};
// 退会・停止によりサポーター一覧から除かれる人数の仮値
const EXCLUDED_SUPPORTERS = 2;
const EXCLUSION_THRESHOLD = 20;

const CURRENT_LAUNCH_DATE: Record<ProductSearch['progress'], Date> = {
  relaunchable: at(2026, 9, 8),
  scheduled: at(2026, 9, 8),
  'qualifier-live': at(2026, 9, 8),
  cooldown: at(2026, 9, 22),
  'week-pending': at(2026, 9, 7),
  'week-urgent': at(2026, 9, 13),
  'week-playing': at(2026, 9, 10),
  'year-pending': at(2026, 9, 7),
  'year-playing': at(2026, 9, 7),
};
const FIRST_LAUNCH_LOSS = at(2026, 3, 10);
const FIRST_LAUNCH_WEEK_WIN = at(2025, 3, 11);
const SECOND_LAUNCH = at(2026, 4, 14);
const NO_HISTORY_NOW = at(2026, 9, 30, 10);
const DAYS_UNTIL_NEXT_LAUNCH = 3;
// 日曜日ローンチの決済期限(月曜日23:00)の13時間48分前を「迫っている」状態の現在時刻とする
const URGENT_MINUTES_LEFT = 13 * 60 + 48;
const RELAUNCH_INTERVAL_DAYS = 7;
const MORNING_HOUR = 10;
const LIVE_HOUR = 14;
const LIVE_MINUTE = 20;

function matchDate(launchDate: Date, match: PlannedMatch): Date {
  const roundIndex = match.round ? ROUND_ORDER.indexOf(match.round) : 0;
  if (match.kind === 'qualifier') return launchDate;
  if (match.kind === 'week') return weekRoundDate(launchDate, roundIndex);
  const final = yearFinalAfter(weekRoundDate(launchDate, 3));
  return yearRoundDate(final, roundIndex);
}

const ROUND_ORDER: Round[] = ['r1', 'qf', 'sf', 'final'];

// 結果が確定して次回ローンチの予約が解禁された時点(再ローンチ規則)
function settledAt(launchDate: Date, last: HistoryMatch): Date {
  const won = last.result !== 'loss' && last.result !== 'both-lose';
  if (last.kind === 'qualifier') {
    return won
      ? weekPaymentDeadline(launchDate)
      : addDays(launchDate, RELAUNCH_INTERVAL_DAYS);
  }
  if (last.kind === 'week' && last.round === 'final' && won) {
    return yearPaymentDeadlineOf(yearFinalAfter(last.date));
  }
  return matchEndOf(last.date);
}

function opponentPool(product: Product): Product[] {
  return PRODUCTS.filter((candidate) => candidate.id !== product.id);
}

function opponentStatus(
  setting: ProductSearch['opponents'],
  kind: MatchKind,
  index: number,
): 'public' | 'unlisted' | 'private' {
  if (setting !== 'mixed') return setting;
  const cycle =
    kind === 'qualifier'
      ? (['public', 'unlisted', 'private'] as const)
      : (['public', 'private'] as const);
  return cycle[index % cycle.length];
}

type Resolved = {
  result: MatchResult;
  ownVotes: number | null;
  opponentVotes: number | null;
  tieBreak: HistoryMatch['tieBreak'];
};

function resolveMatch(
  planned: PlannedMatch,
  search: ProductSearch,
  plan: Plan,
  counters: { win: number; loss: number },
): Resolved {
  if (planned.special === 'bye') {
    return {
      result: 'bye',
      ownVotes: null,
      opponentVotes: null,
      tieBreak: null,
    };
  }
  if (planned.result === 'latest') {
    const [own, opponent] = LATEST_SCORES[search.votes];
    const outcome = latestOutcome(
      search.votes,
      plan.latestRequirement ?? 'any',
    );
    if (own === 0 && opponent === 0) {
      return {
        result: 'both-lose',
        ownVotes: 0,
        opponentVotes: 0,
        tieBreak: null,
      };
    }
    return {
      result: outcome,
      ownVotes: own,
      opponentVotes: opponent,
      tieBreak: own === opponent ? (outcome === 'win' ? 'won' : 'lost') : null,
    };
  }
  if (planned.special === 'early') {
    const [own] = WIN_SCORES[counters.win++ % WIN_SCORES.length];
    return {
      result: 'early',
      ownVotes: own,
      opponentVotes: null,
      tieBreak: null,
    };
  }
  if (planned.result === 'win') {
    const [own, opponent] = WIN_SCORES[counters.win++ % WIN_SCORES.length];
    return {
      result: 'win',
      ownVotes: own,
      opponentVotes: opponent,
      tieBreak: null,
    };
  }
  const [own, opponent] = LOSS_SCORES[counters.loss++ % LOSS_SCORES.length];
  return {
    result: 'loss',
    ownVotes: own,
    opponentVotes: opponent,
    tieBreak: null,
  };
}

// 最新マッチが早期勝敗決定の場合は、確定時点の自分のUpvote数に選択値を使う
function applyLatestEarly(
  resolved: Resolved,
  planned: PlannedMatch,
  search: ProductSearch,
  isLatest: boolean,
): Resolved {
  if (planned.special !== 'early' || !isLatest) return resolved;
  return { ...resolved, ownVotes: LATEST_SCORES[search.votes][0] };
}

function isWon(result: MatchResult): boolean {
  return result === 'win' || result === 'bye' || result === 'early';
}

function highlightsOf(
  matches: HistoryMatch[],
  state: LaunchState,
  progress: ProductSearch['progress'],
): LaunchHighlight[] {
  if (state === 'scheduled')
    return [{ label: 'キックオフ予定', tone: 'primary' }];
  if (state === 'live' && matches.length === 0) {
    return [{ label: '予選マッチ中', tone: 'live' }];
  }
  const chronological = [...matches].reverse();
  const awards = chronological
    .filter((m) => m.round === 'final' && isWon(m.result))
    .map((m): LaunchHighlight => ({
      label: m.kind === 'week' ? 'Product of the Week' : 'Product of the Year',
      tone: 'gold',
    }));
  if (state === 'active') {
    const label = {
      'week-pending': 'Weekトーナメント参加受付中',
      'week-urgent': 'Weekトーナメント参加受付中',
      'week-playing': 'Weekトーナメント参加中',
      'year-pending': 'Yearトーナメント参加受付中',
      'year-playing': 'Yearトーナメント参加中',
    }[progress as string];
    return label ? [...awards, { label, tone: 'live' }] : awards;
  }
  const last = chronological[chronological.length - 1];
  if (last.kind === 'qualifier') {
    if (last.result === 'both-lose') {
      return [{ label: '両者敗北(0対0)', tone: 'muted' }];
    }
    return isWon(last.result)
      ? [{ label: 'ディレクトリ掲載', tone: 'primary' }]
      : [{ label: '予選敗北', tone: 'muted' }];
  }
  if (isWon(last.result)) return awards;
  const prefix = last.kind === 'week' ? 'Week' : 'Year';
  const label =
    last.result === 'both-lose'
      ? `${prefix}${ROUND_LABEL[last.round ?? 'final']}で両者敗北`
      : `${prefix}${ROUND_LABEL[last.round ?? 'final']}敗退`;
  return [...awards, { label, tone: 'muted' }];
}

export function buildTimeline(
  search: ProductSearch,
  plan: Plan,
  product: Product,
): Timeline {
  const { history, progress, awards } = search;
  const fixedDates: Date[] =
    history === 'all'
      ? [
          awards === 'weekN' ? FIRST_LAUNCH_WEEK_WIN : FIRST_LAUNCH_LOSS,
          SECOND_LAUNCH,
        ]
      : [];
  const pool = opponentPool(product);
  const counters = { win: 0, loss: 0 };
  let opponentIndex = 0;

  const startedLaunches = plan.launches.filter((l) => l.matches.length > 0);
  const latestPlanned = startedLaunches.at(-1)?.matches.at(-1);

  const built = startedLaunches.map((planned, launchIndex) => {
    const date = fixedDates[launchIndex] ?? CURRENT_LAUNCH_DATE[progress];
    const matches = planned.matches.map((match, matchIndex): HistoryMatch => {
      const isLatest = match === latestPlanned;
      const resolved = applyLatestEarly(
        resolveMatch(match, search, plan, counters),
        match,
        search,
        isLatest,
      );
      const index = opponentIndex++;
      const opponentProduct = pool[(index * 5 + 3) % pool.length];
      const status =
        match.special === 'early'
          ? 'private'
          : opponentStatus(search.opponents, match.kind, index);
      const opponent: OpponentView | null =
        resolved.result === 'bye'
          ? null
          : status === 'private'
            ? { status }
            : { status, product: opponentProduct };
      const own = resolved.ownVotes ?? 0;
      return {
        id: `match-${launchIndex + 1}-${matchIndex + 1}`,
        kind: match.kind,
        round: match.round,
        date: matchDate(date, match),
        ...resolved,
        opponent,
        supporterCount:
          own >= EXCLUSION_THRESHOLD ? own - EXCLUDED_SUPPORTERS : own,
      };
    });
    return { planned, date, matches };
  });

  const lastBuilt = built.at(-1);
  const lastMatch = lastBuilt?.matches.at(-1);
  const base =
    lastBuilt && lastMatch
      ? atTime(addDays(settledAt(lastBuilt.date, lastMatch), 1), MORNING_HOUR)
      : NO_HISTORY_NOW;
  const nextLaunchDate = addDays(startOfDay(base), DAYS_UNTIL_NEXT_LAUNCH);
  const currentDate = lastBuilt?.date ?? null;

  const liveDate = (() => {
    if (!plan.live) return null;
    if (plan.live.kind === 'qualifier') return nextLaunchDate;
    if (!currentDate) return null;
    return matchDate(currentDate, {
      kind: plan.live.kind,
      round: plan.live.round,
      result: 'win',
      special: null,
    });
  })();

  const now = (() => {
    if (liveDate) return atTime(liveDate, LIVE_HOUR, LIVE_MINUTE);
    if (progress === 'scheduled') return base;
    if (progress === 'relaunchable' || !currentDate) return base;
    if (progress === 'week-urgent') {
      return addMinutes(weekPaymentDeadline(currentDate), -URGENT_MINUTES_LEFT);
    }
    if (progress === 'year-pending') {
      return atTime(addDays(weekRoundDate(currentDate, 3), 1), MORNING_HOUR);
    }
    return atTime(addDays(currentDate, 1), MORNING_HOUR);
  })();

  const launches: LaunchView[] = plan.launches.map((planned, index) => {
    const builtLaunch = built.find((b) => b.planned === planned);
    const date = builtLaunch?.date ?? nextLaunchDate;
    const matches = [...(builtLaunch?.matches ?? [])].reverse();
    return {
      id: `launch-${index + 1}`,
      number: index + 1,
      date,
      state: planned.state,
      matches,
      highlights: highlightsOf(matches, planned.state, progress),
    };
  });

  const isNext = progress === 'scheduled' || progress === 'qualifier-live';
  const pending = (kind: 'week' | 'year') =>
    progress === `${kind}-pending` ||
    (kind === 'week' && progress === 'week-urgent');

  return {
    launches: launches.reverse(),
    now,
    currentLaunchDate: isNext ? nextLaunchDate : currentDate,
    weekDeadline:
      pending('week') && currentDate ? weekPaymentDeadline(currentDate) : null,
    yearDeadline:
      pending('year') && currentDate
        ? yearPaymentDeadlineOf(yearFinalAfter(weekRoundDate(currentDate, 3)))
        : null,
    live:
      plan.live && liveDate
        ? { kind: plan.live.kind, round: plan.live.round, date: liveDate }
        : null,
  };
}
