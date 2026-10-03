import type {
  StateOptionLabels,
  StateSection,
} from '#/components/client/state-panel';

export const OPTIONS = {
  auth: ['guest', 'user', 'unverified', 'owner'],
  status: ['public', 'suspended', 'gone'],
  fields: ['full', 'required'],
  followers: ['many', 'one', 'zero'],
  ultras: ['off', 'on'],
  images: ['ok', 'broken'],
  text: ['normal', 'long'],
  products: ['many', 'few', 'zero'],
  awards: ['none', 'some'],
  launches: ['single', 'multi'],
  progress: ['settled', 'live'],
  upvotes: ['many', 'few', 'zero'],
  targets: ['listed', 'mixed'],
  load: ['normal', 'loading', 'tab-loading', 'error'],
  partial: ['none', 'tab', 'more'],
} as const;

export type OptionKey = keyof typeof OPTIONS;

export type ProfileState = {
  [K in OptionKey]: (typeof OPTIONS)[K][number];
};

export const DEFAULT_STATE: ProfileState = {
  auth: 'guest',
  status: 'public',
  fields: 'full',
  followers: 'many',
  ultras: 'off',
  images: 'ok',
  text: 'normal',
  products: 'many',
  awards: 'some',
  launches: 'multi',
  progress: 'settled',
  upvotes: 'many',
  targets: 'listed',
  load: 'normal',
  partial: 'none',
};

// 本番と同じURLクエリでタブの選択を保持する。状態切り替え用のキーとは重ねない
export const TABS = ['launches', 'upvotes'] as const;
export type ProfileTab = (typeof TABS)[number];
export const DEFAULT_TAB: ProfileTab = 'launches';

export type ProfileSearch = ProfileState & { tab: ProfileTab };

export const DEFAULT_SEARCH: ProfileSearch = {
  ...DEFAULT_STATE,
  tab: DEFAULT_TAB,
};

export const OPTION_LABELS = {
  auth: {
    title: 'ログイン状態',
    values: {
      guest: '未ログイン',
      user: 'ログイン済',
      unverified: 'ログイン済(メールアドレス未確認)',
      owner: 'ログイン済(このプロフィールの本人)',
    },
  },
  status: {
    title: 'プロフィールの公開状態',
    values: {
      public: '公開中',
      suspended: '停止中(本人以外は404)',
      gone: '退会済み・存在しない(全員に404)',
    },
  },
  fields: {
    title: 'プロフィールの入力状況',
    values: {
      full: '全項目入力済み',
      required: '必須項目のみ(ニックネーム・ハンドル)',
    },
  },
  followers: {
    title: 'フォロワー数',
    values: { many: '12,345人', one: '1人', zero: '0人' },
  },
  ultras: {
    title: 'Ultras加入状態(特典の有効期間中はバッジを表示)',
    values: { off: '未加入', on: '加入中' },
  },
  images: {
    title: '画像の読み込み状態',
    values: { ok: '正常', broken: '読み込み失敗・隔離中' },
  },
  text: {
    title: 'ユーザー入力テキストの長さ',
    values: { normal: '標準', long: '上限に近い長さ' },
  },
  products: {
    title: '件数',
    values: { many: '多数(30件)', few: '少数(3件)', zero: '0件' },
  },
  awards: {
    title: '受賞バッジ',
    values: {
      none: '無し',
      some: 'あり(Week1回・Week複数回・WeekとYearを混在)',
    },
  },
  launches: {
    title: 'ローンチ回数',
    values: {
      single: '全て1回',
      multi: '再ローンチを重ねたプロダクトを含む',
    },
  },
  progress: {
    title: '進行状況',
    values: {
      settled: '全てマッチ終了済み',
      live: 'マッチ中・キックオフ予定を含む',
    },
  },
  upvotes: {
    title: '件数(FR-VOTE-010)',
    values: { many: '多数(200件)', few: '少数(3件)', zero: '0件' },
  },
  targets: {
    title: 'プロダクトの状態',
    values: { listed: '全て掲載中', mixed: '未掲載とマッチ中を含む' },
  },
  load: {
    title: 'ページの動作状態',
    values: {
      normal: '通常',
      loading: 'ローディング',
      'tab-loading': 'タブ切り替え後の読み込み',
      error: '取得エラー',
    },
  },
  partial: {
    title: '部分的な読み込みエラー',
    values: {
      none: '無し',
      tab: 'タブの内容の読み込み失敗',
      more: '続きの読み込み失敗',
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
  {
    title: 'プロフィール',
    keys: ['status', 'fields', 'followers', 'ultras', 'images', 'text'],
  },
  {
    title: 'ローンチ履歴',
    keys: ['products', 'awards', 'launches', 'progress'],
  },
  { title: 'Upvote履歴', keys: ['upvotes', 'targets'] },
  { title: 'ページ動作', keys: ['load', 'partial'] },
];

function pick<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = String(raw[key] ?? '');
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// 不正な値は黙って既定値に戻す
export function parseSearch(raw: Record<string, unknown>): ProfileSearch {
  const state = Object.fromEntries(
    (Object.keys(OPTIONS) as OptionKey[]).map((key) => [
      key,
      pick(raw, key, OPTIONS[key], DEFAULT_STATE[key]),
    ]),
  ) as ProfileState;
  return { ...state, tab: pick(raw, 'tab', TABS, DEFAULT_TAB) };
}

export function stateOf(search: ProfileSearch): ProfileState {
  return Object.fromEntries(
    (Object.keys(OPTIONS) as OptionKey[]).map((key) => [key, search[key]]),
  ) as ProfileState;
}
