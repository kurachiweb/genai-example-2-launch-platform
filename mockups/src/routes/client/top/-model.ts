import type { SearchSchemaInput } from '@tanstack/react-router';

import { CURRENT_USER, PRODUCTS } from '#/lib/mock-data';
import type { Product, User } from '#/lib/mock-data';
import type { SponsorAd } from '#/components/client/sponsor-ads';

export const OPTIONS = {
  auth: ['guest', 'user'],
  phase: ['live', 'result'],
  qualifiers: ['7', '1', '0'],
  bye: ['off', 'on'],
  early: ['off', 'on'],
  week: ['none', 'final', 'sf', 'qf', 'r1'],
  year: ['none', 'final', 'sf', 'qf', 'r1'],
  votes: ['410-100', '0-30', '30-30', '0-0'],
  legend: ['4', '1', '0'],
  gold: ['7', '1', '0'],
  silver: ['9', '1', '0'],
} as const;

export type TopSearch = {
  [K in keyof typeof OPTIONS]: (typeof OPTIONS)[K][number];
};

export const DEFAULT_SEARCH: TopSearch = {
  auth: 'guest',
  phase: 'live',
  qualifiers: '7',
  bye: 'off',
  early: 'off',
  week: 'none',
  year: 'final',
  votes: '410-100',
  legend: '4',
  gold: '7',
  silver: '9',
};

export const OPTION_LABELS: {
  [K in keyof typeof OPTIONS]: {
    title: string;
    values: Record<(typeof OPTIONS)[K][number], string>;
  };
} = {
  auth: {
    title: 'ログイン状態',
    values: { guest: '未ログイン', user: 'ログイン済' },
  },
  phase: {
    title: 'マッチ開催状況',
    values: { live: '開催中', result: '勝敗結果表示(23時過ぎ)' },
  },
  qualifiers: {
    title: '予選マッチ数',
    values: { '7': '7つ', '1': '1つ', '0': '1つも無い' },
  },
  bye: { title: '不戦勝プロダクト', values: { off: '無し', on: 'あり' } },
  early: {
    title: '早期勝敗決定プロダクト',
    values: { off: '無し', on: 'あり' },
  },
  week: {
    title: 'Product of the Weekトーナメント',
    values: {
      none: '開催無し',
      final: '決勝',
      sf: '準決勝',
      qf: '準々決勝',
      r1: '1回戦',
    },
  },
  year: {
    title: 'Product of the Yearトーナメント',
    values: {
      none: '開催無し',
      final: '決勝',
      sf: '準決勝',
      qf: '準々決勝',
      r1: '1回戦',
    },
  },
  votes: {
    title: '開催中各マッチのUpvote数',
    values: {
      '410-100': '左410・右100',
      '0-30': '左0・右30',
      '30-30': '両方30(接戦)',
      '0-0': '両方0',
    },
  },
  legend: {
    title: 'スポンサー広告(Legend)',
    values: { '4': '4件', '1': '1件', '0': '無し' },
  },
  gold: {
    title: 'スポンサー広告(Gold)',
    values: { '7': '7件', '1': '1件', '0': '無し' },
  },
  silver: {
    title: 'スポンサー広告(Silver)',
    values: { '9': '9件', '1': '1件', '0': '無し' },
  },
};

export function validateSearch(
  raw: Partial<TopSearch> & SearchSchemaInput,
): TopSearch {
  const result = { ...DEFAULT_SEARCH };
  for (const key of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) {
    const value = String((raw as Record<string, unknown>)[key] ?? '');
    const allowed = OPTIONS[key] as readonly string[];
    if (allowed.includes(value)) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

export type Round = 'r1' | 'qf' | 'sf' | 'final';
export type MatchKind = 'qualifier' | 'week' | 'year';

export type Match = {
  id: string;
  kind: MatchKind;
  left: Product;
  right: Product;
  leftVotes: number;
  rightVotes: number;
  isOwn: boolean;
  upvoted: 'left' | 'right' | null;
};

// absent: 対戦相手が元々いない不戦勝(FR-TOURW-017等)
// early: 対戦相手の退会・停止・非公開化でマッチが早期終了した不戦勝(FR-GAME-013・FR-TOURW-014・FR-TOURY-014)
export type ByeEntry = {
  id: string;
  kind: MatchKind;
  product: Product;
} & ({ reason: 'absent' } | { reason: 'early'; votes: number });

export const ROUND_LABEL: Record<Round, string> = {
  r1: '1回戦',
  qf: '準々決勝',
  sf: '準決勝',
  final: '決勝',
};

const ROUND_MATCHES: Record<Round, number> = { r1: 5, qf: 4, sf: 2, final: 1 };
const ROUND_DAYS_TO_FINAL: Record<Round, number> = {
  r1: 3,
  qf: 2,
  sf: 1,
  final: 0,
};

const KICKOFF_HOUR_UTC = 8;
// nextKickoff()の何秒前にフルタイムを迎えるか
export const MATCH_END = 20 * 60;

// モックのため、常に現在時刻を基準とした次の8時(UTC)を指す
export function nextKickoff(now: Date = new Date()): Date {
  const kickoff = new Date(now);
  kickoff.setUTCHours(KICKOFF_HOUR_UTC, 0, 0, 0);
  if (kickoff.getTime() <= now.getTime()) {
    kickoff.setUTCDate(kickoff.getUTCDate() + 1);
  }
  return kickoff;
}

export function matchEnd(now: Date = new Date()): Date {
  return new Date(nextKickoff(now).getTime() - MATCH_END * 1000);
}

export function finalDate(round: Round): Date {
  const date = new Date('2026-09-18T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + ROUND_DAYS_TO_FINAL[round]);
  return date;
}

export function parseVotes(votes: TopSearch['votes']): [number, number] {
  const [left, right] = votes.split('-').map(Number);
  return [left, right];
}

// 同カテゴリ優先のペアリング(FR-GAME-001)を模し、余りはカテゴリ横断でペアにする(FR-GAME-002)
function pairProducts(offset: number, count: number): [Product, Product][] {
  const pool = Array.from(
    { length: count * 2 + 6 },
    (_, i) => PRODUCTS[(offset + i) % PRODUCTS.length],
  );
  const used = new Set<string>();
  const pairs: [Product, Product][] = [];
  for (const left of pool) {
    if (pairs.length >= count || used.has(left.id)) continue;
    const right =
      pool.find(
        (p) =>
          !used.has(p.id) && p.id !== left.id && p.category === left.category,
      ) ?? pool.find((p) => !used.has(p.id) && p.id !== left.id);
    if (!right) break;
    used.add(left.id);
    used.add(right.id);
    pairs.push([left, right]);
  }
  return pairs;
}

function buildMatch(
  kind: MatchKind,
  index: number,
  pair: [Product, Product],
  votes: [number, number],
  extras: Partial<Match> = {},
): Match {
  const [left, right] = pair;
  return {
    id: `${kind}-${index + 1}`,
    kind,
    left,
    right,
    leftVotes: votes[0],
    rightVotes: votes[1],
    isOwn: false,
    upvoted: null,
    ...extras,
  };
}

function absentBye(kind: MatchKind, product: Product): ByeEntry {
  return { id: `${kind}-bye`, kind, product, reason: 'absent' };
}

// 早期終了したマッチは開催中マッチと並べず、勝者を不戦勝一覧へ移す
function splitEarlyDecided(
  matches: Match[],
  earlyIndex: number | null,
): { matches: Match[]; byes: ByeEntry[] } {
  if (earlyIndex === null || earlyIndex >= matches.length) {
    return { matches, byes: [] };
  }
  const early = matches[earlyIndex];
  return {
    matches: matches.filter((match) => match !== early),
    byes: [
      {
        id: early.id,
        kind: early.kind,
        product: early.left,
        reason: 'early',
        votes: early.leftVotes,
      },
    ],
  };
}

type Bracket = { round: Round; matches: Match[]; byes: ByeEntry[] };

export type TopModel = {
  user: User | null;
  isLive: boolean;
  votes: [number, number];
  qualifiers: Match[];
  qualifierByes: ByeEntry[];
  week: Bracket | null;
  year: Bracket | null;
  ads: { legend: SponsorAd[]; gold: SponsorAd[]; silver: SponsorAd[] };
};

export function buildModel(search: TopSearch): TopModel {
  const user = search.auth === 'user' ? CURRENT_USER : null;
  const votes = parseVotes(search.votes);
  const qualifierCount = Number(search.qualifiers);

  const allQualifiers = pairProducts(0, qualifierCount).map((pair, i) =>
    buildMatch('qualifier', i, pair, votes, {
      isOwn: user != null && i === 1,
      upvoted: user != null && i === 2 ? 'left' : null,
    }),
  );
  const qualifierSplit = splitEarlyDecided(
    allQualifiers,
    search.early === 'on' ? (qualifierCount === 1 ? 0 : 4) : null,
  );
  const qualifierByes = [
    ...(search.bye === 'on' ? [absentBye('qualifier', PRODUCTS[14])] : []),
    ...qualifierSplit.byes,
  ];

  const tournament = (
    kind: 'week' | 'year',
    round: Round | 'none',
    offset: number,
  ): Bracket | null => {
    if (round === 'none') return null;
    const count = ROUND_MATCHES[round];
    const allMatches = Array.from({ length: count }, (_, i) =>
      buildMatch(kind, i, sequentialPair(offset, i), votes),
    );
    const split = splitEarlyDecided(
      allMatches,
      search.early === 'on' && count >= 4 ? 1 : null,
    );
    const byes = [
      ...(search.bye === 'on' && count >= 4
        ? [absentBye(kind, PRODUCTS[(offset + 11) % PRODUCTS.length])]
        : []),
      ...split.byes,
    ];
    return { round, matches: split.matches, byes };
  };

  const week = tournament('week', search.week, 15);
  const year = tournament('year', search.year, 27);

  const ads = {
    legend: adsOf('legend', Number(search.legend), 30),
    gold: adsOf('gold', Number(search.gold), 20),
    silver: adsOf('silver', Number(search.silver), 5),
  };

  return {
    user,
    isLive: search.phase === 'live',
    votes,
    qualifiers: qualifierSplit.matches,
    qualifierByes,
    week,
    year,
    ads,
  };
}

function adsOf(
  tier: SponsorAd['tier'],
  count: number,
  offset: number,
): SponsorAd[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${tier}-${i + 1}`,
    tier,
    product: PRODUCTS[(offset + i * 3) % PRODUCTS.length],
  }));
}

export function matchWinner(match: Match): 'left' | 'right' | 'none' {
  if (match.leftVotes === 0 && match.rightVotes === 0) return 'none';
  if (match.leftVotes === match.rightVotes) return 'left';
  return match.leftVotes > match.rightVotes ? 'left' : 'right';
}

// トーナメントはローンチ日順の隣接ペアのため、カテゴリを考慮せず順に組む
function sequentialPair(offset: number, index: number): [Product, Product] {
  return [
    PRODUCTS[(offset + index * 2) % PRODUCTS.length],
    PRODUCTS[(offset + index * 2 + 1) % PRODUCTS.length],
  ];
}
