import type { SearchSchemaInput } from '@tanstack/react-router';

import type {
  StateOptionLabels,
  StateSection,
} from '#/components/client/state-panel';

export const OPTIONS = {
  auth: ['guest', 'user', 'unverified', 'owner'],
  visibility: ['listed', 'unlisted', 'unavailable'],
  progress: [
    'relaunchable',
    'scheduled',
    'qualifier-live',
    'cooldown',
    'week-pending',
    'week-urgent',
    'week-playing',
    'year-pending',
    'year-playing',
  ],
  awards: ['none', 'week1', 'weekN', 'year'],
  rating: ['many', 'mine', 'one', 'zero'],
  shots: ['10', '1', '0'],
  images: ['ok', 'broken'],
  text: ['normal', 'long'],
  ultras: ['off', 'on'],
  flag: ['on', 'off'],
  history: ['none', 'qualifier', 'week', 'all'],
  votes: ['130-100', '4-30', '30-30', '0-0'],
  bye: ['off', 'on'],
  early: ['off', 'on'],
  opponents: ['public', 'unlisted', 'private', 'mixed'],
  comments: ['many', 'few', 'none'],
  replies: ['none', 'nested', 'deleted'],
  page: ['normal', 'loading', 'error', 'degraded'],
  partial: ['none', 'comments', 'supporters'],
} as const;

export type OptionKey = keyof typeof OPTIONS;

export type ProductSearch = {
  [K in OptionKey]: (typeof OPTIONS)[K][number];
};

export type Progress = ProductSearch['progress'];

export const DEFAULT_SEARCH: ProductSearch = {
  auth: 'guest',
  visibility: 'listed',
  progress: 'relaunchable',
  awards: 'week1',
  rating: 'many',
  shots: '10',
  images: 'ok',
  text: 'normal',
  ultras: 'off',
  flag: 'on',
  history: 'week',
  votes: '130-100',
  bye: 'off',
  early: 'off',
  opponents: 'public',
  comments: 'many',
  replies: 'nested',
  page: 'normal',
  partial: 'none',
};

export const OPTION_LABELS = {
  auth: {
    title: 'ログイン状態',
    values: {
      guest: '未ログイン',
      user: 'ログイン済',
      unverified: 'ログイン済(メールアドレス未確認)',
      owner: 'ログイン済(このプロダクトの投稿者本人)',
    },
  },
  visibility: {
    title: 'プロダクトの公開状態',
    values: {
      listed: '掲載済み',
      unlisted: '未掲載(予選前・予選敗北のみ)',
      unavailable: '閲覧不可(非公開化・退会・停止・論理削除)',
    },
  },
  progress: {
    title: 'プロダクトの進行状況(マッチ中は全員に開催中マッチを表示)',
    values: {
      relaunchable: '再ローンチ可能',
      scheduled: 'ローンチ予定あり(予選前)',
      'qualifier-live': '予選マッチ中',
      cooldown: '予選敗北後の間隔制限中',
      'week-pending': '予選勝利後・Week参加前',
      'week-urgent': '予選勝利後・Week参加前(決済期限が迫っている)',
      'week-playing': 'Weekトーナメント参加中',
      'year-pending': 'Week優勝後・Year参加前',
      'year-playing': 'Yearトーナメント参加中',
    },
  },
  awards: {
    title: '受賞バッジ',
    values: {
      none: '無し',
      week1: 'Product of the Week(1回)',
      weekN: 'Product of the Week(複数回)',
      year: 'Product of the WeekとProduct of the Year',
    },
  },
  rating: {
    title: '5段階評価',
    values: {
      many: '128件(平均4.6)・自分は未評価',
      mine: '128件(平均4.6)・自分も評価済み(4)',
      one: '1件(平均4.0)',
      zero: '0件',
    },
  },
  shots: {
    title: 'スクリーンショットの枚数',
    values: { '10': '10枚(縦長・横長・正方形)', '1': '1枚', '0': '0枚' },
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
  ultras: {
    title: 'Ultras加入状態',
    values: { off: '未加入', on: '加入中' },
  },
  flag: {
    title: 'Ultras導線の機能フラグ(FR-ADMCF-018)',
    values: { on: 'ON', off: 'OFF' },
  },
  history: {
    title: 'マッチ履歴の件数と種別',
    values: {
      none: '0件',
      qualifier: '予選1件のみ',
      week: '予選とWeekトーナメント(5件)',
      all: '予選・Week・Yearの全種別(10件以上・3ローンチ)',
    },
  },
  votes: {
    title: '最新マッチ・開催中マッチのUpvote数(自分-相手)',
    values: {
      '130-100': '130対100',
      '4-30': '4対30',
      '30-30': '30対30(接戦)',
      '0-0': '0対0',
    },
  },
  bye: { title: '不戦勝の履歴', values: { off: '無し', on: 'あり' } },
  early: {
    title: '早期勝敗決定の履歴(FR-GAME-013等)',
    values: { off: '無し', on: 'あり' },
  },
  opponents: {
    title: '対戦相手の公開状態',
    values: {
      public: '全て公開中',
      unlisted: '全て未掲載',
      private: '全て非公開',
      mixed: '混在',
    },
  },
  comments: {
    title: 'トップレベルのコメント件数(最新ローンチ)',
    values: { many: '23件(22件超)', few: '3件', none: '0件' },
  },
  replies: {
    title: 'コメントの返信と削除表示',
    values: {
      none: '返信なし',
      nested: '3階層までの返信',
      deleted: '3階層までの返信と削除表示',
    },
  },
  page: {
    title: 'ページの動作状態',
    values: {
      normal: '通常',
      loading: 'ローディング',
      error: '取得エラー',
      degraded: '縮退運転(決済サービス障害)',
    },
  },
  partial: {
    title: '部分的な読み込みエラー',
    values: {
      none: '無し',
      comments: 'コメントの追加読み込み失敗',
      supporters: 'サポーター一覧の読み込み失敗',
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
    title: 'プロダクト',
    keys: [
      'visibility',
      'progress',
      'awards',
      'rating',
      'shots',
      'images',
      'text',
    ],
  },
  { title: '投稿者本人', keys: ['ultras', 'flag'] },
  {
    title: 'マッチ履歴',
    keys: ['history', 'votes', 'bye', 'early', 'opponents'],
  },
  { title: 'コメント', keys: ['comments', 'replies'] },
  { title: 'ページ動作', keys: ['page', 'partial'] },
];

export function parseSearch(
  raw: Partial<ProductSearch> & SearchSchemaInput,
): ProductSearch {
  const result = { ...DEFAULT_SEARCH };
  for (const key of Object.keys(OPTIONS) as OptionKey[]) {
    const value = String((raw as Record<string, unknown>)[key] ?? '');
    const allowed = OPTIONS[key] as readonly string[];
    if (allowed.includes(value)) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}
