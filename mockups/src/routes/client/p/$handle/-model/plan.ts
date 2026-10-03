import type { MatchKind, Round } from '#/components/client/match/model';

import type { ProductSearch } from './options';

export type Outcome = 'win' | 'loss';
export type Requirement = Outcome | 'any';

export type PlannedMatch = {
  kind: MatchKind;
  round: Round | null;
  // latest: 最新マッチ。結果は「最新マッチのUpvote数」の選択値から決まる
  result: Outcome | 'latest';
  special: 'bye' | 'early' | null;
};

// ended: 結果確定済み / active: 参加受付中・トーナメント参加中 / scheduled: キックオフ前 / live: 予選マッチ中
export type LaunchState = 'ended' | 'active' | 'scheduled' | 'live';

export type PlannedLaunch = {
  matches: PlannedMatch[];
  state: LaunchState;
};

export type Plan = {
  // 古い順
  launches: PlannedLaunch[];
  // 最新マッチが勝利・敗北のどちらであるべきか。最新マッチが無い、または不戦勝ならnull
  latestRequirement: Requirement | null;
  live: { kind: MatchKind; round: Round | null } | null;
};

const ROUNDS: Round[] = ['r1', 'qf', 'sf', 'final'];

function qualifier(result: PlannedMatch['result']): PlannedMatch {
  return { kind: 'qualifier', round: null, result, special: null };
}

function tournament(
  kind: 'week' | 'year',
  roundsWon: number,
  last: PlannedMatch['result'] | null,
): PlannedMatch[] {
  const won = ROUNDS.slice(0, roundsWon).map((round): PlannedMatch => ({
    kind,
    round,
    result: 'win',
    special: null,
  }));
  if (last === null) return won;
  return [
    ...won,
    { kind, round: ROUNDS[roundsWon], result: last, special: null },
  ];
}

function intersect(a: Requirement, b: Requirement): Requirement | null {
  if (a === 'any') return b;
  if (b === 'any' || a === b) return a;
  return null;
}

type Shape = {
  launches: PlannedLaunch[];
  requirement: Requirement | null;
  live: Plan['live'];
};

// 再ローンチを重ねていない、または予選前・予選中の新しいローンチを足す前のローンチ構成
function shapeOf(search: ProductSearch): Shape | null {
  const { history, progress, awards } = search;
  const nextLaunch = (base: PlannedLaunch[]): PlannedLaunch[] =>
    progress === 'scheduled'
      ? [...base, { matches: [], state: 'scheduled' }]
      : [...base, { matches: [], state: 'live' }];
  const isNextLaunch =
    progress === 'scheduled' || progress === 'qualifier-live';
  const qualifierLive = isNextLaunch && progress === 'qualifier-live';
  const liveQualifier: Plan['live'] = qualifierLive
    ? { kind: 'qualifier', round: null }
    : null;

  if (history === 'none') {
    if (!isNextLaunch || awards !== 'none') return null;
    return { launches: nextLaunch([]), requirement: null, live: liveQualifier };
  }

  if (history === 'qualifier') {
    if (awards !== 'none') return null;
    const ended = (state: LaunchState): PlannedLaunch[] => [
      { matches: [qualifier('latest')], state },
    ];
    switch (progress) {
      case 'cooldown':
        return { launches: ended('ended'), requirement: 'loss', live: null };
      case 'week-pending':
      case 'week-urgent':
        return { launches: ended('active'), requirement: 'win', live: null };
      case 'week-playing':
        return {
          launches: ended('active'),
          requirement: 'win',
          live: { kind: 'week', round: 'r1' },
        };
      case 'relaunchable':
        return { launches: ended('ended'), requirement: 'any', live: null };
      case 'scheduled':
      case 'qualifier-live':
        return {
          launches: nextLaunch(ended('ended')),
          requirement: 'any',
          live: liveQualifier,
        };
      default:
        return null;
    }
  }

  if (history === 'week') {
    const finalRequirement: Requirement | null =
      awards === 'none' ? 'loss' : awards === 'week1' ? 'win' : null;
    if (!finalRequirement) return null;
    const run = (state: LaunchState): PlannedLaunch[] => [
      {
        matches: [qualifier('win'), ...tournament('week', 3, 'latest')],
        state,
      },
    ];
    const withRequirement = (
      requirement: Requirement,
      launches: PlannedLaunch[],
      live: Plan['live'],
    ): Shape | null => {
      const merged = intersect(finalRequirement, requirement);
      return merged ? { launches, requirement: merged, live } : null;
    };
    switch (progress) {
      case 'year-pending':
        return withRequirement('win', run('active'), null);
      case 'year-playing':
        return withRequirement('win', run('active'), {
          kind: 'year',
          round: 'r1',
        });
      case 'relaunchable':
        return withRequirement('any', run('ended'), null);
      case 'scheduled':
      case 'qualifier-live':
        return withRequirement('any', nextLaunch(run('ended')), liveQualifier);
      default:
        return null;
    }
  }

  // all: 予選敗北のみのローンチ(複数回受賞ならWeek優勝)→ Week優勝からYear決勝まで進んだローンチ → 進行状況に応じた最新ローンチ
  if (awards === 'none') return null;
  const first: PlannedLaunch = {
    matches:
      awards === 'weekN'
        ? [qualifier('win'), ...tournament('week', 3, 'win')]
        : [qualifier('loss')],
    state: 'ended',
  };
  const yearFinalResult: Outcome = awards === 'year' ? 'win' : 'loss';
  const second = (yearFinal: PlannedMatch['result']): PlannedLaunch => ({
    matches: [
      qualifier('win'),
      ...tournament('week', 3, 'win'),
      ...tournament('year', 3, yearFinal),
    ],
    state: 'ended',
  });
  const latest = (
    matches: PlannedMatch[],
    state: LaunchState,
    requirement: Requirement,
    live: Plan['live'] = null,
  ): Shape => ({
    launches: [first, second(yearFinalResult), { matches, state }],
    requirement,
    live,
  });
  // 最新ローンチでもWeek優勝すると受賞が2回以上になるため、受賞1回とは両立しない
  const weekWinAllowed = awards !== 'week1';
  switch (progress) {
    case 'cooldown':
      return latest([qualifier('latest')], 'ended', 'loss');
    case 'week-pending':
    case 'week-urgent':
      return latest([qualifier('latest')], 'active', 'win');
    case 'week-playing':
      return latest(
        [qualifier('win'), ...tournament('week', 0, 'latest')],
        'active',
        'win',
        { kind: 'week', round: 'qf' },
      );
    case 'year-pending':
      if (!weekWinAllowed) return null;
      return latest(
        [qualifier('win'), ...tournament('week', 3, 'latest')],
        'active',
        'win',
      );
    case 'year-playing':
      if (!weekWinAllowed) return null;
      return latest(
        [
          qualifier('win'),
          ...tournament('week', 4, null),
          ...tournament('year', 0, 'latest'),
        ],
        'active',
        'win',
        { kind: 'year', round: 'qf' },
      );
    case 'relaunchable':
      return latest([qualifier('latest')], 'ended', 'any');
    case 'scheduled':
    case 'qualifier-live':
      return {
        launches: nextLaunch([first, second('latest')]),
        requirement: yearFinalResult,
        live: liveQualifier,
      };
    default:
      return null;
  }
}

// 不戦勝・早期勝敗決定を置くマッチ。最新マッチ以外に置ける場合はそちらを優先する
function specialTarget(
  launches: PlannedLaunch[],
  history: ProductSearch['history'],
  special: 'bye' | 'early',
): PlannedMatch | null {
  if (history === 'qualifier') return launches[0].matches[0];
  const launch = history === 'all' ? launches[1] : launches[0];
  const kind = history === 'all' && special === 'early' ? 'year' : 'week';
  const round: Round = special === 'bye' ? 'qf' : 'sf';
  return (
    launch.matches.find((m) => m.kind === kind && m.round === round) ?? null
  );
}

export function planHistory(search: ProductSearch): Plan | null {
  const shape = shapeOf(search);
  if (!shape) return null;
  const launches = shape.launches.map((launch) => ({
    ...launch,
    matches: launch.matches.map((match) => ({ ...match })),
  }));
  let requirement = shape.requirement;

  const specials = (['bye', 'early'] as const).filter(
    (s) => search[s] === 'on',
  );
  if (specials.length > 0 && search.history === 'none') return null;
  if (specials.length > 1 && search.history === 'qualifier') return null;
  for (const special of specials) {
    const target = specialTarget(launches, search.history, special);
    if (!target) return null;
    if (target.result === 'latest') {
      // 不戦勝は勝利扱いのため、敗北であるべき最新マッチには置けない
      if (requirement === 'loss') return null;
      target.result = 'win';
      requirement = null;
    }
    target.special = special;
  }

  return { launches, latestRequirement: requirement, live: shape.live };
}

export function latestOutcome(
  votes: ProductSearch['votes'],
  requirement: Requirement,
): Outcome {
  if (votes === '130-100') return 'win';
  if (votes === '30-30') return requirement === 'loss' ? 'loss' : 'win';
  return 'loss';
}

export function hasQualifierWin(plan: Plan, votes: ProductSearch['votes']) {
  return plan.launches.some((launch) =>
    launch.matches.some((match) => {
      if (match.kind !== 'qualifier') return false;
      if (match.result === 'latest') {
        return latestOutcome(votes, plan.latestRequirement ?? 'any') === 'win';
      }
      return match.result === 'win';
    }),
  );
}

export function hasTournamentMatch(plan: Plan): boolean {
  return plan.launches.some((launch) =>
    launch.matches.some((match) => match.kind !== 'qualifier'),
  );
}

// マッチ履歴・進行状況・受賞・公開状態などの組み合わせが実際に起こりうるか
export function isStructureValid(search: ProductSearch): boolean {
  const plan = planHistory(search);
  if (!plan) return false;
  if (
    plan.latestRequirement &&
    plan.latestRequirement !== 'any' &&
    latestOutcome(search.votes, plan.latestRequirement) !==
      plan.latestRequirement
  ) {
    return false;
  }
  const listed = hasQualifierWin(plan, search.votes);
  if (search.visibility === 'listed' && !listed) return false;
  if (search.visibility === 'unlisted' && listed) return false;
  // トーナメントの対戦相手は予選勝利済みのため未掲載にはならない
  if (search.opponents === 'unlisted' && hasTournamentMatch(plan)) return false;
  return true;
}
