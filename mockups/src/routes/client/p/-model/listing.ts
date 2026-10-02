import { CURRENT_USER, PRODUCTS, USERS } from '#/lib/mock-data';
import type { Product, User } from '#/lib/mock-data';

import {
  SERVICE_START,
  YESTERDAY,
  addDays,
  daysBetween,
  weekLabelOf,
} from './calendar';
import { categoryOfProduct, findCategory } from './categories';
import type { Category } from './categories';
import type { DirectoryState } from './options';
import { PAGE_SIZE, effectiveSort, hasConditions } from './query';
import type { DateRange, DirectoryQuery, SortKey } from './query';
import { containsTerms } from './text';

// win: 通常の勝利 / bye: 対戦相手が元々いない不戦勝(FR-GAME-003・FR-GAME-014) / early: 早期勝敗決定による不戦勝(FR-GAME-013)
export type BaseWin = {
  date: string;
  result: 'win' | 'bye' | 'early';
  ownVotes: number | null;
};

export type Award = { kind: 'week' | 'year'; label: string };

export type DirectoryEntry = {
  id: string;
  product: Product;
  category: Category;
  maker: User;
  isOwn: boolean;
  awards: Award[];
  commentCount: number;
  win: BaseWin;
};

export type Listing =
  | {
      kind: 'results';
      total: number;
      page: number;
      pageCount: number;
      first: number;
      last: number;
      entries: DirectoryEntry[];
    }
  | { kind: 'empty'; reason: 'filtered' | 'none' }
  | { kind: 'out-of-range'; total: number; page: number; pageCount: number };

const TOTALS: Record<DirectoryState['count'], number> = {
  many: 1234,
  few: 3,
  zero: 0,
};

// 名称50文字・タグライン100文字ちょうど(またはそれに近い長さ)の仮テキスト
const LONG_NAMES = [
  'Supercalifragilisticexpialidocious Analytics Suite',
  'Pneumonoultramicroscopicsilicovolcanoconiosis Lab!',
  'Hippopotomonstrosesquippedaliophobia Therapy Coach',
];
const LONG_TAGLINES = [
  'Internationalization-ready observability for teams shipping hyperpersonalized onboarding experiences',
  'Counterrevolutionary spreadsheet automation for accountants who never asked to become programmers :)',
  'Electroencephalographically-informed focus timers that adapt to your circadian rhythm and calendars',
];

// 一覧内の位置(1ページ20件中の何番目か)ごとに、確認したいケースを割り当てる
const BYE_SLOTS = [1, 12];
const EARLY_SLOTS = [2, 17];
const OWN_SLOTS = [1, 9];
const EMOJI_MAKER_SLOTS: Record<number, string> = {
  5: 'kitsune_makes',
  11: 'family_devs',
};
const LONG_MAKER_HANDLES = ['jaw', 'hubert'];
const EMOJI_PRODUCT_POSITIONS: Record<string, number> = {
  'liftoff-changelog': 1,
  'pair-prompt': 6,
  'omakase-planner': 13,
};

type HistoryWin = {
  date: string;
  seed: number;
  // このローンチでProduct of the Weekを受賞した
  week?: boolean;
  // 「基準勝利マッチのUpvote数」の代表値(1,234対1,198など)を当てる
  canonical?: boolean;
};

// 複数回の予選勝利の履歴(新しい順)。再ローンチ規則(FR-RELCH-004)と受賞の時期に矛盾しない日付にしている
type History = { wins: HistoryWin[]; year?: string };

const HISTORIES: Partial<Record<number, History>> = {
  0: {
    wins: [
      { date: '2026-09-21', seed: 3, canonical: true },
      { date: '2026-06-15', seed: 11 },
      { date: '2025-11-03', seed: 19, week: true },
    ],
    year: '2026年',
  },
  4: {
    wins: [
      { date: '2026-09-08', seed: 5, week: true },
      { date: '2025-09-08', seed: 13, week: true },
      { date: '2025-02-10', seed: 23, week: true },
    ],
  },
  7: {
    wins: [
      { date: '2026-09-16', seed: 7 },
      { date: '2026-07-20', seed: 17 },
      { date: '2026-03-02', seed: 29, week: true },
    ],
  },
  10: {
    wins: [
      { date: '2026-09-18', seed: 2 },
      { date: '2026-04-14', seed: 31 },
      { date: '2025-12-01', seed: 37 },
    ],
  },
  16: {
    wins: [
      { date: '2026-09-14', seed: 9 },
      { date: '2026-06-29', seed: 41 },
      { date: '2025-10-13', seed: 43, week: true },
      { date: '2025-04-07', seed: 47, week: true },
    ],
  },
};

const CANONICAL_SCORES: Record<DirectoryState['votes'], [number, number]> = {
  high: [1234, 1198],
  low: [3, 1],
};
const SCORE_FLOORS: Record<DirectoryState['votes'], number> = {
  high: 80,
  low: 1,
};
const EARLY_VOTES: Record<DirectoryState['votes'], number> = {
  high: 845,
  low: 2,
};

function hash(value: number): number {
  let x = (value + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

// rankはUpvote数順に並べる場合の全体順位。指定時は順位が下がるほど少なくなる
function scoreOf(
  mode: DirectoryState['votes'],
  seed: number,
  options: { canonical?: boolean; rank?: number; total?: number } = {},
): [number, number] {
  const [top] = CANONICAL_SCORES[mode];
  if (options.canonical) return CANONICAL_SCORES[mode];
  const own =
    options.rank !== undefined && options.total
      ? Math.max(
          1,
          Math.round(top - (options.rank * (top - 1)) / options.total),
        )
      : SCORE_FLOORS[mode] + (hash(seed) % (top - SCORE_FLOORS[mode] + 1));
  const margin = 1 + (hash(seed + 101) % Math.max(1, Math.floor(own * 0.3)));
  return [own, Math.max(0, own - margin)];
}

function basePool(): Product[] {
  const emoji = PRODUCTS.filter(
    (product) => product.handle in EMOJI_PRODUCT_POSITIONS,
  );
  const rest = PRODUCTS.filter(
    (product) => !(product.handle in EMOJI_PRODUCT_POSITIONS),
  );
  return emoji.reduce((pool, product) => {
    const position = EMOJI_PRODUCT_POSITIONS[product.handle];
    return [...pool.slice(0, position), product, ...pool.slice(position)];
  }, rest);
}

// 名称一致・タグライン一致の仮データを関連度順の先頭に置き、残りは説明文で一致した想定で続ける
function productPool(q: string | undefined): {
  pool: Product[];
  matched: Set<string>;
} {
  const base = basePool();
  if (!q) return { pool: base, matched: new Set() };
  const byName = base.filter((product) => containsTerms(product.name, q));
  const byTagline = base.filter(
    (product) => !byName.includes(product) && containsTerms(product.tagline, q),
  );
  const matched = [...byName, ...byTagline];
  const rest = base.filter((product) => !matched.includes(product));
  return {
    pool: [...matched, ...rest],
    matched: new Set(matched.map((product) => product.id)),
  };
}

// 仮データの日付を置く範囲。掲載される最新のローンチ日は昨日
function windowOf(range: DateRange): { from: string; to: string } {
  const from =
    range.from && range.from > SERVICE_START ? range.from : SERVICE_START;
  const to = range.to && range.to < YESTERDAY ? range.to : YESTERDAY;
  if (from <= to) return { from, to };
  return range.to && range.to < SERVICE_START
    ? { from: range.to, to: range.to }
    : { from, to: from };
}

function dateFor(
  index: number,
  total: number,
  window: { from: string; to: string },
  sort: SortKey,
): string {
  const span = daysBetween(window.from, window.to) + 1;
  const step = Math.floor((index * span) / total);
  if (sort === 'newest') return addDays(window.to, -step);
  if (sort === 'oldest') return addDays(window.from, step);
  return addDays(window.from, hash(index + 7) % span);
}

function inRange(date: string, range: DateRange): boolean {
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}

function makerOf(slot: number, index: number, state: DirectoryState): User {
  const emojiHandle = EMOJI_MAKER_SLOTS[slot] as string | undefined;
  if (emojiHandle) {
    return USERS.find((user) => user.handle === emojiHandle) ?? USERS[1];
  }
  if (state.text === 'long' && slot % 3 === 0) {
    const handle = LONG_MAKER_HANDLES[(slot / 3) % LONG_MAKER_HANDLES.length];
    return USERS.find((user) => user.handle === handle) ?? USERS[1];
  }
  // 閲覧者本人(CURRENT_USER)以外から選ぶ
  return USERS[1 + (hash(index + 5) % (USERS.length - 1))];
}

function awardsOf(history: History | undefined): Award[] {
  if (!history) return [];
  const weeks = history.wins
    .filter((win) => win.week)
    .map((win): Award => ({ kind: 'week', label: weekLabelOf(win.date) }));
  const year: Award[] = history.year
    ? [{ kind: 'year', label: history.year }]
    : [];
  return [...year, ...weeks];
}

function sortEntries(
  entries: { entry: DirectoryEntry; order: number }[],
  sort: SortKey,
): DirectoryEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const byOrder = a.order - b.order;
    switch (sort) {
      case 'newest':
        return b.entry.win.date.localeCompare(a.entry.win.date) || byOrder;
      case 'oldest':
        return a.entry.win.date.localeCompare(b.entry.win.date) || byOrder;
      case 'upvotes':
        return (
          (b.entry.win.ownVotes ?? 0) - (a.entry.win.ownVotes ?? 0) || byOrder
        );
      case 'relevance':
        return byOrder;
    }
  });
  return sorted.map(({ entry }) => entry);
}

type BuildContext = {
  state: DirectoryState;
  query: DirectoryQuery;
  master: Category[];
  total: number;
  sort: SortKey;
  window: { from: string; to: string };
  matched: Set<string>;
};

function buildEntry(
  context: BuildContext,
  product: Product,
  index: number,
  history: { record: History; win: HistoryWin } | null,
): DirectoryEntry {
  const { state, query, master, total, sort, window } = context;
  const slot = index % PAGE_SIZE;
  const isOwn = state.auth === 'owner' && OWN_SLOTS.includes(slot);
  // 検索に一致したプロダクトと絵文字で始まるプロダクトは、強調表示と頭文字の確認のため名称を置き換えない
  const long =
    state.text === 'long' &&
    slot % 3 !== 2 &&
    !context.matched.has(product.id) &&
    !(product.handle in EMOJI_PRODUCT_POSITIONS);
  const shown: Product = long
    ? {
        ...product,
        name: LONG_NAMES[slot % LONG_NAMES.length],
        tagline: LONG_TAGLINES[slot % LONG_TAGLINES.length],
      }
    : product;
  const category =
    findCategory(master, query.category) ??
    categoryOfProduct(master, product.category);

  const win = ((): BaseWin => {
    if (history) {
      const [own] = scoreOf(state.votes, history.win.seed, {
        canonical: history.win.canonical,
      });
      return {
        date: history.win.date,
        result: 'win',
        ownVotes: own,
      };
    }
    const date = dateFor(index, total, window, sort);
    if (state.bye === 'on' && BYE_SLOTS.includes(slot)) {
      return {
        date,
        result: 'bye',
        ownVotes: null,
      };
    }
    if (state.early === 'on' && EARLY_SLOTS.includes(slot)) {
      return {
        date,
        result: 'early',
        ownVotes: EARLY_VOTES[state.votes],
      };
    }
    const [own] = scoreOf(state.votes, index * 7 + 1, {
      canonical: index === 0,
      rank: sort === 'upvotes' ? index : undefined,
      total,
    });
    return {
      date,
      result: 'win',
      ownVotes: own,
    };
  })();

  return {
    id: `entry-${index}-${product.id}`,
    product: shown,
    category,
    maker: isOwn ? CURRENT_USER : makerOf(slot, index, state),
    isOwn,
    awards: state.awards === 'some' ? awardsOf(history?.record) : [],
    commentCount: slot === 5 ? 0 : slot === 0 ? 128 : hash(index * 3) % 60,
    win,
  };
}

export function buildListing(
  state: DirectoryState,
  query: DirectoryQuery,
  master: Category[],
): Listing {
  const total = TOTALS[state.count];
  if (total === 0) {
    return {
      kind: 'empty',
      reason: hasConditions(query) ? 'filtered' : 'none',
    };
  }
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const page = query.page ?? 1;
  if (page > pageCount) return { kind: 'out-of-range', total, page, pageCount };

  const range: DateRange = { from: query.from, to: query.to };
  const sort = effectiveSort(query);
  const { pool, matched } = productPool(query.q);
  const context: BuildContext = {
    state,
    query,
    master,
    total,
    sort,
    window: windowOf(range),
    matched,
  };
  const first = (page - 1) * PAGE_SIZE;
  const size = Math.min(PAGE_SIZE, total - first);
  let spare = first + size;

  const entries = Array.from({ length: size }, (_, offset) => {
    const index = first + offset;
    const product = pool[index % pool.length];
    // 複数回勝利した履歴の再現は1ページ目のみ。基準勝利は期間内の最新、期間の指定が無ければ直近の勝利
    const record =
      page === 1 && state.wins === 'multi' ? HISTORIES[offset] : undefined;
    if (!record) {
      return {
        entry: buildEntry(context, product, index, null),
        order: offset,
      };
    }
    const position = record.wins.findIndex((win) => inRange(win.date, range));
    if (position === -1) {
      // 期間内に勝利が無いプロダクトは一覧に出ないため、別のプロダクトで埋める
      const substitute = pool[spare++ % pool.length];
      return {
        entry: buildEntry(context, substitute, index, null),
        order: offset,
      };
    }
    return {
      entry: buildEntry(context, product, index, {
        record,
        win: record.wins[position],
      }),
      order: offset,
    };
  });

  return {
    kind: 'results',
    total,
    page,
    pageCount,
    first: first + 1,
    last: first + size,
    entries: sortEntries(entries, sort),
  };
}
