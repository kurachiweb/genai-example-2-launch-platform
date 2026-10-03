import type { MatchKind, Round } from '#/components/client/match/model';
import { addDays, at, isoDate } from '#/lib/clock';
import { PRODUCTS, USERS } from '#/lib/mock-data';
import type { Product, User } from '#/lib/mock-data';

import { LONG_NICKNAME, LONG_PRODUCT_TEXTS } from './content';
import type { ProfileState } from './options';

export type UpvoteEntry = {
  id: string;
  // マッチ日(基準時刻の0:00)。Upvoteした時刻は生活時間帯を推測させないため扱わない
  date: Date;
  kind: MatchKind;
  round: Round | null;
  product: Product;
  maker: User;
  // 予選で敗北した、または初めての予選マッチ中のプロダクトは未掲載のためリンクしない
  listed: boolean;
  live: boolean;
};

// 他のユーザーが投稿し、予選で敗北した未掲載のプロダクト(ディレクトリの仮データには含めない)
const UNLISTED_PRODUCTS: Product[] = [
  [
    'Snoozeless',
    'Alarm clock that only stops after a mental math problem',
    'ヘルスケア',
  ],
  ['Gradebook Garden', 'Visual progress reports for parents', '教育'],
  [
    'Metronomicon',
    'A metronome with swing, polyrhythms and a sense of humor',
    'その他',
  ],
  ['🌱 Sprout Budget', 'Budgeting for your very first job', 'その他'],
  ['Parcel Pigeon', 'Package tracking across 400 carriers', '生産性'],
  [
    'Antidisestablishmentarianism Linter',
    'Flags needlessly long words in your UI copy',
    '開発ツール',
  ],
].map(([name, tagline, category], index) => ({
  id: `prd-${201 + index}`,
  name,
  tagline,
  category,
  handle: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  siteUrl: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example`,
  art: { palette: (index * 5 + 4) % 12, variant: 'blob' as const },
}));

// モックの現在時刻と同じ日(2026年10月2日(金))。この日のマッチは開催中
const TODAY = at(2026, 10, 2);
const MANY_COUNT = 200;
const FEW_COUNT = 3;
// 1日あたりのUpvote数の並び。0の日も挟み、200件で2026年のYearトーナメント(5月21〜24日)まで遡る
const DAILY_COUNTS = [2, 0, 1, 3, 0, 1, 2, 1, 0, 4];
const PRODUCT_STRIDE = 7;
const UNLISTED_EVERY = 6;
// Yearトーナメントの日程(決勝日は管理者が設定する日曜日、参加数9〜16で1回戦は3日前)
const YEAR_ROUNDS: Partial<Record<string, Round>> = {
  '2026-05-21': 'r1',
  '2026-05-22': 'qf',
  '2026-05-23': 'sf',
  '2026-05-24': 'final',
};
// Weekトーナメントは組み合わせ決定翌日の火曜日から1日1ラウンド。参加数9〜16の4ラウンドを想定する
const WEEK_ROUNDS: Partial<Record<number, Round>> = {
  2: 'r1',
  3: 'qf',
  4: 'sf',
  5: 'final',
};

function hash(text: string): number {
  let value = 0;
  for (const char of text) {
    value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return value;
}

// 同じプロダクトの投稿者は常に同じユーザーにする。閲覧中のユーザー自身のプロダクトにはUpvoteできない(FR-VOTE-003)ため除く
function makerOf(product: Product, profileUser: User, long: boolean): User {
  const pool = USERS.filter((user) => user.id !== profileUser.id);
  const maker = pool[hash(product.id) % pool.length];
  if (!long || hash(product.id) % 3 !== 0) return maker;
  return { ...maker, nickname: LONG_NICKNAME };
}

function weekdayOf(date: Date): number {
  return new Date(`${isoDate(date)}T00:00:00Z`).getUTCDay();
}

type Draft = Omit<UpvoteEntry, 'id' | 'maker'>;

function withLongName(product: Product, index: number): Product {
  const text = LONG_PRODUCT_TEXTS[index % LONG_PRODUCT_TEXTS.length];
  return { ...product, ...text };
}

// 新しい順に1件ずつ、日ごとの件数・曜日・Yearトーナメントの日程から種別を決める
function pastDrafts(count: number, mixed: boolean): Draft[] {
  const drafts: Draft[] = [];
  let day = addDays(TODAY, -1);
  let dayIndex = 0;
  while (drafts.length < count) {
    const perDay = DAILY_COUNTS[dayIndex % DAILY_COUNTS.length];
    const yearRound = YEAR_ROUNDS[isoDate(day)];
    const weekRound = WEEK_ROUNDS[weekdayOf(day)];
    for (let j = 0; j < perDay && drafts.length < count; j++) {
      const n = drafts.length;
      const tournament =
        j === 0 && yearRound
          ? { kind: 'year' as const, round: yearRound }
          : j === 1 && weekRound
            ? { kind: 'week' as const, round: weekRound }
            : null;
      const unlisted = mixed && !tournament && n % UNLISTED_EVERY === 2;
      drafts.push({
        date: day,
        kind: tournament?.kind ?? 'qualifier',
        round: tournament?.round ?? null,
        product: unlisted
          ? UNLISTED_PRODUCTS[n % UNLISTED_PRODUCTS.length]
          : PRODUCTS[(n * PRODUCT_STRIDE + 3) % PRODUCTS.length],
        listed: !unlisted,
        live: false,
      });
    }
    day = addDays(day, -1);
    dayIndex += 1;
  }
  return drafts;
}

// 開催中のマッチ。初めての予選マッチ中のプロダクトは未掲載、Weekトーナメントの決勝は掲載済み
function liveDrafts(): Draft[] {
  return [
    {
      date: TODAY,
      kind: 'qualifier',
      round: null,
      product: UNLISTED_PRODUCTS[3],
      listed: false,
      live: true,
    },
    {
      date: TODAY,
      kind: 'week',
      round: WEEK_ROUNDS[weekdayOf(TODAY)] ?? 'final',
      product: PRODUCTS[12],
      listed: true,
      live: true,
    },
  ];
}

function draftsOf(state: ProfileState): Draft[] {
  const mixed = state.targets === 'mixed';
  if (state.upvotes === 'few') {
    if (!mixed) return pastDrafts(FEW_COUNT, false);
    const lost = pastDrafts(UNLISTED_EVERY, true).find((d) => !d.listed);
    return [...liveDrafts(), ...(lost ? [lost] : [])];
  }
  const live = mixed ? liveDrafts() : [];
  return [...live, ...pastDrafts(MANY_COUNT - live.length, mixed)];
}

// 新しい順。FR-VOTE-011により非公開・削除されたプロダクトや退会・停止したユーザーのプロダクトは含めない
export function buildUpvotes(
  state: ProfileState,
  profileUser: User,
): UpvoteEntry[] {
  if (state.upvotes === 'zero') return [];
  const long = state.text === 'long';
  return draftsOf(state).map((draft, index) => {
    const product =
      long && index % 4 === 1
        ? withLongName(draft.product, index)
        : draft.product;
    return {
      ...draft,
      id: `upvote-${index + 1}`,
      product,
      maker: makerOf(draft.product, profileUser, long),
    };
  });
}

export type UpvoteDay = { date: Date; entries: UpvoteEntry[] };

// マッチ日ごとの小見出しでまとめる
export function groupByDay(entries: UpvoteEntry[]): UpvoteDay[] {
  return entries.reduce<UpvoteDay[]>((days, entry) => {
    const last = days.at(-1);
    if (last && isoDate(last.date) === isoDate(entry.date)) {
      return [
        ...days.slice(0, -1),
        { ...last, entries: [...last.entries, entry] },
      ];
    }
    return [...days, { date: entry.date, entries: [entry] }];
  }, []);
}
