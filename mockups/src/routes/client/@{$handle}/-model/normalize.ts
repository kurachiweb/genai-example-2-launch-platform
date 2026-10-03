import {
  createStateNormalizer,
  describeStateChanges,
} from '#/lib/state-normalizer';
import type { Normalized, StateConstraint } from '#/lib/state-normalizer';

import { OPTIONS, OPTION_LABELS } from './options';
import type { OptionKey, ProfileState } from './options';

const CONSTRAINTS: StateConstraint<OptionKey, ProfileState>[] = [
  {
    keys: ['products', 'awards'],
    test: (s) => s.products !== 'zero' || s.awards === 'none',
    reason: '受賞にはローンチしたプロダクトが必要です。',
  },
  {
    keys: ['products', 'launches'],
    test: (s) => s.products !== 'zero' || s.launches === 'single',
  },
  {
    keys: ['products', 'progress'],
    test: (s) => s.products !== 'zero' || s.progress === 'settled',
  },
  {
    keys: ['awards', 'launches'],
    test: (s) => s.awards === 'none' || s.launches === 'multi',
    reason:
      'Product of the Weekの複数回受賞には、受賞ごとに別のローンチが必要です。',
  },
  {
    keys: ['progress', 'launches'],
    test: (s) => s.progress === 'settled' || s.launches === 'multi',
    reason:
      'マッチ中・キックオフ予定のローンチは、再ローンチした掲載済みプロダクトとして表示します。',
  },
  {
    keys: ['status', 'progress'],
    test: (s) => s.status !== 'suspended' || s.progress === 'settled',
    reason:
      '停止すると未開始のローンチ予定は取り消され、マッチ中のマッチは対戦相手の勝利で終わります(FR-ADMUG-008・FR-GAME-013)。',
  },
  {
    keys: ['status', 'targets'],
    test: (s) => s.status !== 'suspended' || s.targets === 'listed',
    reason: '停止するとマッチ中のUpvoteは取り消されます(FR-VOTE-008)。',
  },
  {
    keys: ['status', 'images'],
    test: (s) => s.status !== 'suspended' || s.images === 'broken',
    reason:
      '停止するとプロフィール画像とプロダクトのロゴは隔離されます(FR-ADMUG-026)。',
  },
  {
    keys: ['upvotes', 'targets'],
    test: (s) => s.upvotes !== 'zero' || s.targets === 'listed',
  },
  {
    keys: ['partial', 'products', 'upvotes'],
    test: (s) =>
      s.partial !== 'more' || s.products === 'many' || s.upvotes === 'many',
    reason: '続きの読み込みは、1度に表示しきれない件数の一覧で起こります。',
  },
];

const normalizer = createStateNormalizer<OptionKey, ProfileState>({
  options: OPTIONS,
  constraints: CONSTRAINTS,
  searchKeys: [
    'auth',
    'status',
    'products',
    'awards',
    'launches',
    'progress',
    'upvotes',
    'targets',
    'images',
    'partial',
  ],
  weights: {
    auth: 8,
    status: 6,
    products: 4,
    upvotes: 4,
    awards: 3,
    launches: 3,
    progress: 2,
    targets: 2,
    images: 2,
  },
});

export function normalize(
  state: ProfileState,
  fixedKey?: OptionKey,
): Normalized<OptionKey, ProfileState> {
  return normalizer.normalize(state, fixedKey);
}

export function describeChanges(
  next: ProfileState,
  changed: OptionKey[],
  trigger: OptionKey,
  reasons: string[],
): string {
  return describeStateChanges(OPTION_LABELS, next, changed, trigger, reasons);
}
