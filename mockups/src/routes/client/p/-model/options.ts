import type {
  StateOptionLabels,
  StateSection,
} from '#/components/client/state-panel';

// 検索・絞り込み・並び替え・ページ番号のURLクエリ(q・category・from・to・sort・page)とは重複しないキーにする
export const OPTIONS = {
  auth: ['guest', 'user', 'unverified', 'owner'],
  count: ['many', 'few', 'zero'],
  awards: ['none', 'some'],
  wins: ['single', 'multi'],
  votes: ['high', 'low'],
  bye: ['off', 'on'],
  early: ['off', 'on'],
  categories: ['standard', 'many'],
  images: ['ok', 'broken'],
  text: ['normal', 'long'],
  load: ['normal', 'loading', 'refetch', 'error'],
} as const;

export type OptionKey = keyof typeof OPTIONS;

export type DirectoryState = {
  [K in OptionKey]: (typeof OPTIONS)[K][number];
};

export const DEFAULT_STATE: DirectoryState = {
  auth: 'guest',
  count: 'many',
  awards: 'some',
  wins: 'multi',
  votes: 'high',
  bye: 'off',
  early: 'off',
  categories: 'standard',
  images: 'ok',
  text: 'normal',
  load: 'normal',
};

export const OPTION_LABELS = {
  auth: {
    title: 'ログイン状態',
    values: {
      guest: '未ログイン',
      user: 'ログイン済',
      unverified: 'ログイン済(メールアドレス未確認)',
      owner: 'ログイン済(プロダクトの投稿者本人)',
    },
  },
  count: {
    title: '該当件数',
    values: {
      many: '多数(1,234件・62ページ)',
      few: '少数(3件)',
      zero: '0件',
    },
  },
  awards: {
    title: '受賞バッジ',
    values: {
      none: '受賞プロダクト無し',
      some: '受賞プロダクトあり(Week1回・Week複数回・WeekとYear)',
    },
  },
  wins: {
    title: '予選の勝利回数',
    values: { single: '全て1回', multi: '複数回の勝利を含む' },
  },
  votes: {
    title: '基準勝利マッチのUpvote数',
    values: {
      high: '多い(自身1,234票・相手1,198票)',
      low: '少ない(自身3票・相手1票)',
    },
  },
  bye: { title: '不戦勝による掲載', values: { off: '無し', on: 'あり' } },
  early: {
    title: '早期勝敗決定での掲載(FR-GAME-013)',
    values: { off: '無し', on: 'あり' },
  },
  categories: {
    title: 'カテゴリの登録数',
    values: { standard: '標準(10件)', many: '多数(40件)' },
  },
  images: {
    title: '画像の読み込み状態',
    values: {
      ok: '正常(一部プロフィール画像未設定)',
      broken: '読み込み失敗・隔離中',
    },
  },
  text: {
    title: 'ユーザー入力テキストの長さ',
    values: { normal: '標準', long: '上限に近い長さ' },
  },
  load: {
    title: 'ページの動作状態',
    values: {
      normal: '通常',
      loading: 'ローディング',
      refetch: '条件変更後の再読み込み',
      error: '取得エラー',
    },
  },
} satisfies {
  [K in OptionKey]: {
    title: string;
    values: Record<(typeof OPTIONS)[K][number], string>;
  };
} satisfies StateOptionLabels<OptionKey>;

export const PANEL_SECTIONS: StateSection<OptionKey>[] = [
  { title: '閲覧者', keys: ['auth'] },
  { title: '一覧', keys: ['count', 'categories'] },
  { title: 'プロダクト', keys: ['awards', 'wins', 'images', 'text'] },
  { title: '基準勝利マッチ', keys: ['votes', 'bye', 'early'] },
  { title: 'ページ動作', keys: ['load'] },
];

export function parseState(raw: Record<string, unknown>): DirectoryState {
  const result = { ...DEFAULT_STATE };
  for (const key of Object.keys(OPTIONS) as OptionKey[]) {
    const value = String(raw[key] ?? '');
    const allowed = OPTIONS[key] as readonly string[];
    if (allowed.includes(value)) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

export type NormalizedState = {
  state: DirectoryState;
  changed: OptionKey[];
};

// Product of the Weekを複数回受賞するには、受賞ごとに別のローンチで予選に勝利している必要がある
export function normalizeState(
  state: DirectoryState,
  fixedKey?: OptionKey,
): NormalizedState {
  if (state.awards === 'none' || state.wins === 'multi') {
    return { state, changed: [] };
  }
  if (fixedKey === 'wins') {
    return { state: { ...state, awards: 'none' }, changed: ['awards'] };
  }
  return { state: { ...state, wins: 'multi' }, changed: ['wins'] };
}

export function describeChanges(
  next: DirectoryState,
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
  return `「${titleOf(trigger)}: ${labelOf(trigger)}」と両立させるため、${items}に自動で変更しました。Product of the Weekの複数回受賞には複数回の予選勝利が必要です。`;
}
