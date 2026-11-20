import {
  QUARANTINE_REASON_LABELS,
  type QuarantineReason,
} from '../../../../common-lib/moderation/moderation-labels.ts';
import type { ModerationOperation } from './moderation-operations.ts';

export interface ModerationPageCopy {
  readonly title: string;
  readonly description: string;
}

export interface ModerationDialogCopy {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
}

export const MODERATION_PAGE_COPY = Object.freeze({
  users: Object.freeze({
    title: 'ユーザー',
    description: '退会していない利用者を、登録日時の新しい順に表示します。',
  }),
  products: Object.freeze({
    title: 'プロダクト',
    description:
      '削除されていないプロダクトを、登録日時の新しい順に表示します。',
  }),
  comments: Object.freeze({
    title: 'コメント',
    description: 'コメントを、投稿日時の新しい順に表示します。',
  }),
  ratings: Object.freeze({
    title: '評価',
    description: '評価を、更新日時の新しい順に表示します。',
  }),
  mediaModeration: Object.freeze({
    title: '画像モデレーション',
    description:
      '隔離された画像を、隔離理由ごとに隔離された日時の新しい順に表示します。',
  }),
} satisfies Record<string, ModerationPageCopy>);

export const UNREADABLE_USER_LABEL = '表示できない利用者';

export const NO_MODERATION_RECORD_LABEL = '記録なし';

export const MODERATION_REASON_LABEL = '理由';

const countFormat = new Intl.NumberFormat('ja-JP');

const averageFormat = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const nicknameOrUnreadable = (nickname: string | null): string =>
  nickname ?? UNREADABLE_USER_LABEL;

export const userHandleLabel = (handle: string): string => `@${handle}`;

export const USER_LIST_CAPTION = 'ユーザーの一覧';

export const USER_LIST_COLUMNS = Object.freeze({
  avatar: '画像',
  nickname: 'ニックネーム',
  handle: 'ハンドル',
  registeredAt: '登録日時',
  disposableEmail: '使い捨て判定',
  status: '状態',
  actions: '操作',
});

export const USER_FILTER_LABELS = Object.freeze({
  handle: 'ハンドル',
  nickname: 'ニックネーム',
  email: 'メールアドレス',
  status: '停止状態',
  allStatuses: 'すべて',
});

export const EMAIL_SEARCH_AUDIT_NOTICE =
  'メールアドレスの検索は監査ログに記録されます。';

export const USER_STATUS_LABELS = Object.freeze({
  active: '利用中',
  suspended: '停止中',
});

export const SUSPENDED_AT_LABEL = '停止日時';

export const USER_LIST_EMPTY_MESSAGE = '条件に一致するユーザーはいません。';

export const USER_ACTION_LABELS = Object.freeze({
  suspend: '停止',
  unsuspend: '停止解除',
  quarantineAvatar: 'プロフィール画像を隔離',
  withdraw: '代理の退会',
});

export type UserActionKind = keyof typeof USER_ACTION_LABELS;

const USER_ACTION_NAME_SUFFIXES: Readonly<Record<UserActionKind, string>> =
  Object.freeze({
    suspend: 'を停止',
    unsuspend: 'の停止解除',
    quarantineAvatar: 'のプロフィール画像を隔離',
    withdraw: 'の代理の退会',
  });

export const userActionName = (
  kind: UserActionKind,
  nickname: string,
): string => `「${nickname}」${USER_ACTION_NAME_SUFFIXES[kind]}`;

export const suspendUserDialogCopy = (
  nickname: string,
): ModerationDialogCopy => ({
  title: `ユーザー「${nickname}」を停止しますか?`,
  description:
    'この利用者のプロフィール・プロダクト・コメント・評価は他の利用者に表示されなくなり、未開始のマッチ予定は取り消されます(停止を解除しても戻りません)。利用者へ停止の通知を送ります。',
  confirmLabel: '停止する',
});

export const unsuspendUserDialogCopy = (
  nickname: string,
): ModerationDialogCopy => ({
  title: `ユーザー「${nickname}」の停止を解除しますか?`,
  description:
    'この利用者のプロフィール・プロダクト・コメント・評価の表示を再開します。停止の時に取り消したマッチ予定は戻らず、他の理由で隔離された画像は公開に戻りません。利用者へ通知は送りません。',
  confirmLabel: '停止を解除する',
});

export const withdrawUserDialogCopy = ({
  nickname,
  handle,
  suspended,
}: {
  readonly nickname: string;
  readonly handle: string;
  readonly suspended: boolean;
}): ModerationDialogCopy => ({
  title: `ユーザー「${nickname}」を退会させますか?`,
  description: `対象は${userHandleLabel(handle)}(${suspended ? USER_STATUS_LABELS.suspended : USER_STATUS_LABELS.active})の利用者です。退会は取り消せず、利用者のデータは退会の規則どおりに削除されます。本人の意思の確かめと退会の完了の知らせは、システムの外のメールで行ってください。`,
  confirmLabel: '退会させる',
});

export const PRODUCT_LIST_CAPTION = 'プロダクトの一覧';

export const PRODUCT_LIST_COLUMNS = Object.freeze({
  logo: 'ロゴ',
  name: '名称',
  handle: 'ハンドル',
  owner: '投稿者',
  category: 'カテゴリ',
  latestLaunch: '最新のローンチ',
  visibility: '公開状態',
});

export const PRODUCT_FILTER_LABELS = Object.freeze({
  name: '名称',
  handle: 'ハンドル',
  ownerHandle: '投稿者のハンドル',
  category: 'カテゴリ',
  allCategories: 'すべてのカテゴリ',
  launchState: 'ローンチ状態',
  allLaunchStates: 'すべてのローンチ状態',
  visibility: '公開状態',
  allVisibilities: 'すべての公開状態',
});

export const PRODUCT_VISIBILITY_LABELS = Object.freeze({
  visible: '公開中',
  hidden: '非公開化中',
  owner_suspended: '投稿者が停止中',
});

export const productOwnerLabel = (nickname: string, handle: string): string =>
  `${nickname}(${userHandleLabel(handle)})`;

export const latestLaunchLabel = (date: string, state: string): string =>
  `${date}・${state}`;

export const NO_LAUNCH_LABEL = 'なし';

export const PRODUCT_LIST_EMPTY_MESSAGE =
  '条件に一致するプロダクトはありません。';

export const PRODUCT_DETAIL_COPY = Object.freeze({
  pageTitle: 'プロダクトの詳細',
  backToList: 'プロダクトの一覧へ',
  sections: Object.freeze({
    visibility: '公開状態',
    information: 'プロダクトの情報',
    images: '画像',
    ratings: '評価',
    launches: 'ローンチ履歴',
  }),
  items: Object.freeze({
    tagline: 'タグライン',
    category: 'カテゴリ',
    handle: 'ハンドル',
    websiteUrl: '外部Webサイト',
    owner: '投稿者',
    description: '説明文',
    logo: 'ロゴ',
    screenshots: 'スクリーンショット',
    hiddenAt: '非公開化した日時',
  }),
});

export const PRODUCT_ACTION_LABELS = Object.freeze({
  hide: '非公開化',
  unhide: '復元',
});

export const hideProductDialogCopy = (name: string): ModerationDialogCopy => ({
  title: `プロダクト『${name}』を非公開にしますか?`,
  description:
    '未開始のマッチ予定は取り消され、復元しても戻りません。投稿者へ通知を送ります。',
  confirmLabel: '非公開にする',
});

export const unhideProductDialogCopy = (
  name: string,
): ModerationDialogCopy => ({
  title: `プロダクト『${name}』を復元しますか?`,
  description:
    'プロダクトの表示を再開します。非公開化の時に取り消したマッチ予定は戻らず、他の理由で隔離された画像は公開に戻りません。投稿者へ通知は送りません。',
  confirmLabel: '復元する',
});

export const QUARANTINED_IMAGE_MARK = '隔離中';

export const QUARANTINE_REASONS_LABEL = '隔離理由';

export const quarantineReasonsText = (
  reasons: readonly QuarantineReason[],
): string =>
  reasons.map((reason) => QUARANTINE_REASON_LABELS[reason]).join('、');

export const QUARANTINE_IMAGE_LABEL = '隔離';

export const LOGO_QUARANTINE_NAME = 'ロゴを隔離';

// 番号はスクリーンショットの並び順で1から数える
export const screenshotQuarantineName = (position: number): string =>
  `スクリーンショット${String(position)}を隔離`;

export const ratingSummaryText = (average: number, count: number): string =>
  `平均${averageFormat.format(average)}(有効な評価${countFormat.format(count)}件)`;

export const NO_VALID_RATINGS_MESSAGE = '有効な評価はありません。';

export const PRODUCT_RATING_LIST_CAPTION = '評価の一覧';

export const PRODUCT_RATING_LIST_COLUMNS = Object.freeze({
  rater: '評価者',
  score: '点数',
  updatedAt: '日時',
  state: '状態',
  actions: '操作',
});

export const LOAD_MORE_LABEL = 'さらに読み込む';

export const launchHeading = (launchNumber: number): string =>
  `第${String(launchNumber)}回ローンチ`;

export const matchResultsCaption = (launchNumber: number): string =>
  `${launchHeading(launchNumber)}のマッチ結果`;

export const LAUNCH_ITEM_LABELS = Object.freeze({
  launchDate: 'ローンチ日',
  state: '状態',
});

export const MATCH_RESULT_COLUMNS = Object.freeze({
  kind: '種別',
  round: 'ラウンド',
  matchDate: '実施日',
  opponent: '対戦相手',
  upvoteCount: 'Upvote数',
  result: '勝敗',
});

export const MATCH_KIND_LABELS = Object.freeze({
  qualifier: '予選',
  week: 'Weekトーナメント',
  year: 'Yearトーナメント',
});

export const MATCH_RESULT_LABELS = Object.freeze({
  won: '勝利',
  lost: '敗北',
  walkover: '不戦勝',
  bothLost: '両者敗北',
  scheduled: '予定',
  inProgress: 'マッチ中',
});

export const HIDDEN_OPPONENT_LABEL = '非公開のプロダクト';

export const NO_VALUE_LABEL = '—';

export const NO_LAUNCHES_MESSAGE = 'ローンチはまだありません。';

export const NO_MATCHES_MESSAGE = 'マッチはありません。';

export const COMMENT_LIST_CAPTION = 'コメントの一覧';

export const COMMENT_LIST_COLUMNS = Object.freeze({
  body: '本文',
  author: '投稿者',
  product: 'プロダクト',
  launch: 'ローンチ',
  createdAt: '投稿日時',
  state: '状態',
  actions: '操作',
});

export const commentLaunchLabel = (launchNumber: number): string =>
  `第${String(launchNumber)}回`;

export const EMPTY_COMMENT_BODY_LABEL = '本文なし';

export const COMMENT_FILTER_LABELS = Object.freeze({
  authorHandle: '投稿者のハンドル',
  productHandle: 'プロダクトのハンドル',
  from: '投稿日の開始日',
  to: '投稿日の終了日',
  state: '状態',
  allStates: 'すべての状態',
});

export const COMMENT_LIST_EMPTY_MESSAGE =
  '条件に一致するコメントはありません。';

export const COMMENT_ACTION_LABELS = Object.freeze({
  hide: '非公開化',
  unhide: '復元',
});

export const commentActionName = (
  kind: keyof typeof COMMENT_ACTION_LABELS,
  nickname: string | null,
): string =>
  `${nicknameOrUnreadable(nickname)}さんのコメントを${COMMENT_ACTION_LABELS[kind]}`;

const commentSubjectOf = (nickname: string | null): string =>
  nickname === null ? 'コメント' : `${nickname}さんのコメント`;

export const hideCommentDialogCopy = (
  nickname: string | null,
): ModerationDialogCopy => ({
  title: `${commentSubjectOf(nickname)}を非公開にしますか?`,
  description:
    'コメントは「このコメントは削除されました。」の表示に置き換わり、付いている返信はそのまま残ります。投稿者へ通知を送ります。',
  confirmLabel: '非公開にする',
});

export const unhideCommentDialogCopy = (
  nickname: string | null,
): ModerationDialogCopy => ({
  title: `${commentSubjectOf(nickname)}を復元しますか?`,
  description:
    'コメントの表示を再開します。投稿者が削除・退会・停止したコメントと匿名化済みのコメントは、削除された旨の表示のままです。投稿者へ通知は送りません。',
  confirmLabel: '復元する',
});

export const RATING_LIST_CAPTION = '評価の一覧';

export const RATING_LIST_COLUMNS = Object.freeze({
  rater: '評価者',
  product: 'プロダクト',
  score: '点数',
  updatedAt: '更新日時',
  state: '状態',
  actions: '操作',
});

export const ratingScoreLabel = (score: number): string =>
  `5段階中${String(score)}`;

export const RATING_FILTER_LABELS = Object.freeze({
  productHandle: 'プロダクトのハンドル',
  raterHandle: '評価者のハンドル',
  state: '状態',
  allStates: 'すべての状態',
});

export const RATING_STATE_LABELS = Object.freeze({
  valid: '有効',
  invalidated: '無効化済み',
});

export const RATING_LIST_EMPTY_MESSAGE = '条件に一致する評価はありません。';

export const RATING_ACTION_LABELS = Object.freeze({
  invalidate: '無効化',
  revalidate: '無効化の取り消し',
});

const RATING_ACTION_NAME_SUFFIXES = Object.freeze({
  invalidate: 'を無効化',
  revalidate: 'の無効化の取り消し',
});

export const ratingActionName = (
  kind: keyof typeof RATING_ACTION_LABELS,
  nickname: string | null,
): string =>
  `${nicknameOrUnreadable(nickname)}さんの評価${RATING_ACTION_NAME_SUFFIXES[kind]}`;

const ratingSubjectOf = (nickname: string | null): string =>
  nickname === null ? '評価' : `${nickname}さんの評価`;

export const invalidateRatingDialogCopy = (
  nickname: string | null,
): ModerationDialogCopy => ({
  title: `${ratingSubjectOf(nickname)}を無効化しますか?`,
  description:
    '無効化した評価は平均値と件数の算出から除かれます。評価者には自分の評価として表示されたままです。評価者へ通知は送りません。',
  confirmLabel: '無効化する',
});

export const revalidateRatingDialogCopy = (
  nickname: string | null,
): ModerationDialogCopy => ({
  title: `${ratingSubjectOf(nickname)}の無効化を取り消しますか?`,
  description: '評価を平均値と件数の算出に戻します。評価者へ通知は送りません。',
  confirmLabel: '無効化を取り消す',
});

export const QUARANTINE_REASON_TABS_LABEL = '隔離理由';

export const QUARANTINE_REASON_TAB_ORDER: readonly QuarantineReason[] =
  Object.freeze(['auto', 'admin_action', 'product_hidden', 'user_suspended']);

export const QUARANTINED_IMAGE_LIST_CAPTION = '隔離画像の一覧';

export const QUARANTINED_IMAGE_ITEM_LABELS = Object.freeze({
  purpose: '用途',
  owner: '保有者',
  quarantinedAt: '隔離された日時',
  reasons: '隔離理由',
  findings: '検出内容',
});

export const NO_FINDINGS_LABEL = 'なし';

export const userImageOwnerLabel = (nickname: string, handle: string): string =>
  productOwnerLabel(nickname, handle);

export const adminImageOwnerLabel = (nickname: string): string =>
  `${nickname}(管理者)`;

export const SYSTEM_IMAGE_OWNER_LABEL = 'システム';

export const QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE =
  'この隔離理由の画像はありません。';

export type QuarantinedImageOperation = Extract<
  ModerationOperation,
  'image.approve' | 'image.reject' | 'image.release' | 'image.delete'
>;

export const IMAGE_ACTION_LABELS: Readonly<
  Record<QuarantinedImageOperation, string>
> = Object.freeze({
  'image.approve': '公開承認',
  'image.reject': '公開拒否',
  'image.release': '隔離の解除',
  'image.delete': '削除',
});

const IMAGE_ACTION_NAME_SUFFIXES: Readonly<
  Record<QuarantinedImageOperation, string>
> = Object.freeze({
  'image.approve': 'の公開承認',
  'image.reject': 'の公開拒否',
  'image.release': 'の隔離の解除',
  'image.delete': 'の削除',
});

export const imageActionName = (
  operation: QuarantinedImageOperation,
  owner: string,
  purpose: string,
): string => `${owner}の${purpose}${IMAGE_ACTION_NAME_SUFFIXES[operation]}`;

export type ImageOperation = Extract<ModerationOperation, `image.${string}`>;

export const IMAGE_DIALOG_COPY: Readonly<
  Record<ImageOperation, ModerationDialogCopy>
> = Object.freeze({
  'image.approve': Object.freeze({
    title: 'この画像の公開を承認しますか?',
    description:
      '自動判定の隔離理由を外します。他の隔離理由が残っている間は公開に戻りません。',
    confirmLabel: '公開を承認する',
  }),
  'image.reject': Object.freeze({
    title: 'この画像の公開を拒否しますか?',
    description: '画像を削除します。削除した画像は元に戻せません。',
    confirmLabel: '公開を拒否する',
  }),
  'image.quarantine': Object.freeze({
    title: 'この画像を隔離しますか?',
    description:
      '画像を利用者側に表示しないようにします。隔離を解除するまで公開に戻りません。',
    confirmLabel: '隔離する',
  }),
  'image.release': Object.freeze({
    title: 'この画像の隔離を解除しますか?',
    description:
      '管理者操作の隔離理由を外します。他の隔離理由が残っている間は公開に戻りません。',
    confirmLabel: '隔離を解除する',
  }),
  'image.delete': Object.freeze({
    title: 'この画像を削除しますか?',
    description: '削除した画像は元に戻せません。',
    confirmLabel: '削除する',
  }),
});

export const MODERATION_CHANGED_MESSAGES: Readonly<
  Record<ModerationOperation, string>
> = Object.freeze({
  'user.suspend': 'ユーザーを停止しました。',
  'user.unsuspend': 'ユーザーの停止を解除しました。',
  'user.administrative-withdraw': 'ユーザーを退会させました。',
  'product.hide': 'プロダクトを非公開にしました。',
  'product.unhide': 'プロダクトを復元しました。',
  'comment.hide': 'コメントを非公開にしました。',
  'comment.unhide': 'コメントを復元しました。',
  'rating.invalidate': '評価を無効化しました。',
  'rating.revalidate': '評価の無効化を取り消しました。',
  'image.approve': '画像の公開を承認しました。',
  'image.reject': '画像の公開を拒否しました。',
  'image.quarantine': '画像を隔離しました。',
  'image.release': '画像の隔離を解除しました。',
  'image.delete': '画像を削除しました。',
});

const ALREADY_HIDDEN_MESSAGE = '既に非公開です。';

const ALREADY_VISIBLE_MESSAGE = '既に公開中です。';

const ALREADY_REMOVED_REASON_MESSAGE = 'この隔離理由は既に外れています。';

const ALREADY_DELETED_MESSAGE = '既に削除済みです。';

// 代理の退会は退会済みの利用者を照会で除くため変わらない結果を返さないが、全ての操作に文言を持たせる
export const MODERATION_UNCHANGED_MESSAGES: Readonly<
  Record<ModerationOperation, string>
> = Object.freeze({
  'user.suspend': '既に停止中です。',
  'user.unsuspend': '既に利用中です。',
  'user.administrative-withdraw': '既に退会済みです。',
  'product.hide': ALREADY_HIDDEN_MESSAGE,
  'product.unhide': ALREADY_VISIBLE_MESSAGE,
  'comment.hide': ALREADY_HIDDEN_MESSAGE,
  'comment.unhide': ALREADY_VISIBLE_MESSAGE,
  'rating.invalidate': '既に無効化済みです。',
  'rating.revalidate': '既に有効です。',
  'image.approve': ALREADY_REMOVED_REASON_MESSAGE,
  'image.reject': ALREADY_DELETED_MESSAGE,
  'image.quarantine': '既に隔離中です。',
  'image.release': ALREADY_REMOVED_REASON_MESSAGE,
  'image.delete': ALREADY_DELETED_MESSAGE,
});
