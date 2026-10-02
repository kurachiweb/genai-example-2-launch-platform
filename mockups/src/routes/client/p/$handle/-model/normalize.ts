import { OPTIONS, OPTION_LABELS } from './options';
import type { OptionKey, ProductSearch } from './options';
import { isStructureValid } from './plan';

type Constraint = {
  keys: OptionKey[];
  test: (search: ProductSearch) => boolean;
};

const CONSTRAINTS: Constraint[] = [
  {
    keys: [
      'visibility',
      'history',
      'progress',
      'awards',
      'votes',
      'bye',
      'early',
      'opponents',
    ],
    test: isStructureValid,
  },
  // 未掲載のプロダクトは投稿者本人しか閲覧できず、本人は自身を評価できないため評価・コメントは付かない
  {
    keys: ['visibility', 'rating'],
    test: (s) => s.visibility !== 'unlisted' || s.rating === 'zero',
  },
  {
    keys: ['visibility', 'comments'],
    test: (s) => s.visibility !== 'unlisted' || s.comments === 'none',
  },
  // 自分の評価があるのは評価できるログインユーザー(本人以外・メールアドレス確認済み)のみ
  {
    keys: ['auth', 'rating'],
    test: (s) => s.rating !== 'mine' || s.auth === 'user',
  },
  {
    keys: ['partial', 'comments'],
    test: (s) => s.partial !== 'comments' || s.comments === 'many',
  },
  {
    keys: ['partial', 'history'],
    test: (s) => s.partial !== 'supporters' || s.history !== 'none',
  },
];

// 探索順。依存の少ない項目を先に決め、制約の検査をできるだけ早く行う
const SEARCH_KEYS: OptionKey[] = [
  'auth',
  'visibility',
  'rating',
  'comments',
  'partial',
  'history',
  'progress',
  'awards',
  'votes',
  'bye',
  'early',
  'opponents',
];

// 自動で切り替える際の変更コスト。表示全体への影響が大きい項目ほど変えにくくする
const KEY_WEIGHTS: Record<OptionKey, number> = {
  auth: 8,
  visibility: 6,
  history: 4,
  progress: 4,
  awards: 3,
  rating: 2,
  comments: 2,
  votes: 1,
  bye: 1,
  early: 1,
  opponents: 1,
  partial: 1,
  shots: 1,
  images: 1,
  text: 1,
  ultras: 1,
  flag: 1,
  replies: 1,
  page: 1,
};

// 閲覧不可(404)へ自動で切り替えると他の表示を確認できなくなるため、その選択肢は選ばれにくくする
const VALUE_PENALTIES: Partial<Record<OptionKey, Record<string, number>>> = {
  visibility: { unavailable: 6 },
};

function costOf(key: OptionKey, value: string): number {
  return KEY_WEIGHTS[key] + (VALUE_PENALTIES[key]?.[value] ?? 0);
}

// 各探索段階で全項目が確定する制約
const CHECKS_AT: Constraint[][] = SEARCH_KEYS.map((key, index) =>
  CONSTRAINTS.filter(
    (constraint) =>
      constraint.keys.includes(key) &&
      constraint.keys.every((k) => SEARCH_KEYS.indexOf(k) <= index),
  ),
);

export function isConsistent(search: ProductSearch): boolean {
  return CONSTRAINTS.every((constraint) => constraint.test(search));
}

export type Normalized = {
  search: ProductSearch;
  changed: OptionKey[];
};

// 矛盾する組み合わせを、fixedKey(最後に操作した項目)を保ったまま変更コストが最小の整合する組み合わせへ直す
export function normalize(
  search: ProductSearch,
  fixedKey?: OptionKey,
): Normalized {
  if (isConsistent(search)) return { search, changed: [] };

  const current = { ...search } as Record<OptionKey, string>;
  // visit内で更新するため、クロージャ越しでも型の絞り込みが外れないよう入れ物に持つ
  const best: { search: Record<OptionKey, string> | null; cost: number } = {
    search: null,
    cost: Number.POSITIVE_INFINITY,
  };

  const visit = (index: number, cost: number) => {
    if (cost >= best.cost) return;
    if (index === SEARCH_KEYS.length) {
      best.search = { ...current };
      best.cost = cost;
      return;
    }
    const key = SEARCH_KEYS[index];
    const original = search[key];
    const domain =
      key === fixedKey
        ? [original]
        : [original, ...OPTIONS[key].filter((value) => value !== original)];
    for (const value of domain) {
      current[key] = value;
      const ok = CHECKS_AT[index].every((constraint) =>
        constraint.test(current as ProductSearch),
      );
      if (ok) {
        visit(index + 1, cost + (value === original ? 0 : costOf(key, value)));
      }
    }
    current[key] = original;
  };
  visit(0, 0);

  if (!best.search) return { search, changed: [] };
  const resolved = best.search as ProductSearch;
  const changed = SEARCH_KEYS.filter((key) => resolved[key] !== search[key]);
  return { search: resolved, changed };
}

export function describeChanges(
  next: ProductSearch,
  changed: OptionKey[],
  trigger: OptionKey,
): string {
  const titleOf = (key: OptionKey) =>
    OPTION_LABELS[key].title.replace(/\(.*\)$/, '');
  const labelOf = (key: OptionKey) =>
    (OPTION_LABELS[key].values as Record<string, string>)[next[key]];
  const items = changed
    .map((key) => `${titleOf(key)}を「${labelOf(key)}」`)
    .join('、');
  return `「${titleOf(trigger)}: ${labelOf(trigger)}」と両立させるため、${items}に自動で変更しました。`;
}
