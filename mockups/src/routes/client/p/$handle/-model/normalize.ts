import {
  createStateNormalizer,
  describeStateChanges,
} from '#/lib/state-normalizer';
import type { Normalized, StateConstraint } from '#/lib/state-normalizer';

import { OPTIONS, OPTION_LABELS } from './options';
import type { OptionKey, ProductSearch } from './options';
import { isStructureValid } from './plan';

const CONSTRAINTS: StateConstraint<OptionKey, ProductSearch>[] = [
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

const normalizer = createStateNormalizer<OptionKey, ProductSearch>({
  options: OPTIONS,
  constraints: CONSTRAINTS,
  searchKeys: [
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
  ],
  weights: {
    auth: 8,
    visibility: 6,
    history: 4,
    progress: 4,
    awards: 3,
    rating: 2,
    comments: 2,
  },
  // 閲覧不可(404)へ自動で切り替えると他の表示を確認できなくなるため、その選択肢は選ばれにくくする
  penalties: { visibility: { unavailable: 6 } },
});

export function normalize(
  search: ProductSearch,
  fixedKey?: OptionKey,
): Normalized<OptionKey, ProductSearch> {
  return normalizer.normalize(search, fixedKey);
}

export function describeChanges(
  next: ProductSearch,
  changed: OptionKey[],
  trigger: OptionKey,
): string {
  return describeStateChanges(OPTION_LABELS, next, changed, trigger);
}
