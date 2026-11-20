import { ADMIN_AVATAR_UPLOAD_PURPOSE } from '../admin/admin-avatar-upload.ts';
import {
  PRODUCT_LOGO_PURPOSE,
  PRODUCT_SCREENSHOT_PURPOSE,
} from '../product/product-input-rules.ts';
import { USER_AVATAR_PURPOSE } from '../profile/profile-input-rules.ts';
import type { ModerationAction } from './moderation-actions.ts';

export const MODERATION_ACTION_LABELS: Readonly<
  Record<ModerationAction, string>
> = Object.freeze({
  'user.suspend': 'ユーザーの停止',
  'user.unsuspend': 'ユーザーの停止解除',
  'user.administrative-withdraw': 'ユーザーの代理の退会',
  'product.hide': 'プロダクトの非公開化',
  'product.unhide': 'プロダクトの復元',
  'comment.hide': 'コメントの非公開化',
  'comment.unhide': 'コメントの復元',
  'rating.invalidate': '評価の無効化',
  'rating.revalidate': '評価の無効化の取り消し',
  'image.approve': '画像の公開承認',
  'image.quarantine': '画像の隔離',
  'image.release': '画像の隔離の解除',
  'image.delete': '画像の削除',
});

// 以降の値は上流の照会が返す値の写し。共用部品は他の層を読み込めないため値を持ち、一致はルートの写しの照合のテストで確かめる
export type QuarantineReason =
  'auto' | 'product_hidden' | 'user_suspended' | 'admin_action';

export const QUARANTINE_REASONS: readonly QuarantineReason[] = Object.freeze([
  'auto',
  'product_hidden',
  'user_suspended',
  'admin_action',
]);

export const QUARANTINE_REASON_LABELS: Readonly<
  Record<QuarantineReason, string>
> = Object.freeze({
  auto: '自動判定',
  product_hidden: '非公開化',
  user_suspended: 'ユーザー停止',
  admin_action: '管理者操作',
});

// unverifiedは上流の値ではなく、メールアドレスの確認前で判定の対象にならない利用者を表す
export const DISPOSABLE_EMAIL_JUDGEMENTS = Object.freeze([
  'disposable',
  'regular',
  'undetermined',
  'unverified',
] as const);

export type DisposableEmailJudgement =
  (typeof DISPOSABLE_EMAIL_JUDGEMENTS)[number];

export const DISPOSABLE_EMAIL_LABELS: Readonly<
  Record<DisposableEmailJudgement, string>
> = Object.freeze({
  disposable: '使い捨て',
  regular: '通常',
  undetermined: '判定できず',
  unverified: '未確認',
});

export const ADMIN_LAUNCH_STATES = Object.freeze([
  'scheduled',
  'in_progress',
  'won',
  'lost',
  'canceled',
] as const);

export type AdminProductLaunchState = (typeof ADMIN_LAUNCH_STATES)[number];

export const ADMIN_LAUNCH_STATE_LABELS: Readonly<
  Record<AdminProductLaunchState, string>
> = Object.freeze({
  scheduled: '予約中',
  in_progress: '予選マッチ中',
  won: '勝利',
  lost: '敗北',
  canceled: '取消',
});

export const ADMIN_COMMENT_STATES = Object.freeze([
  'hidden',
  'deleted',
  'anonymized',
  'author_unavailable',
  'shown',
] as const);

export type AdminCommentState = (typeof ADMIN_COMMENT_STATES)[number];

export const ADMIN_COMMENT_STATE_LABELS: Readonly<
  Record<AdminCommentState, string>
> = Object.freeze({
  hidden: '管理者が非公開化',
  deleted: '投稿者が削除',
  anonymized: '匿名化済み',
  author_unavailable: '投稿者が退会・停止中',
  shown: '表示中',
});

export const MEDIA_PURPOSE_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    [USER_AVATAR_PURPOSE]: 'プロフィール画像',
    [PRODUCT_LOGO_PURPOSE]: 'ロゴ',
    [PRODUCT_SCREENSHOT_PURPOSE]: 'スクリーンショット',
    [ADMIN_AVATAR_UPLOAD_PURPOSE]: '管理者のプロフィール画像',
  });

// 後続の機能が足した用途も一覧に出るため、表示名の無い用途は用途名で示す
export const mediaPurposeLabel = (purpose: string): string =>
  Object.hasOwn(MEDIA_PURPOSE_LABELS, purpose)
    ? (MEDIA_PURPOSE_LABELS[purpose] ?? purpose)
    : purpose;
