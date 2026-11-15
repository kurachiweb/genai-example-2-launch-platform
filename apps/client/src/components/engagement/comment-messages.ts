import type { EngagementViewerKind } from './engagement-viewer.ts';

export const COMMENT_GUEST_NOTICE =
  'ログインすると、コメントや返信を投稿できます。';

export const COMMENT_LOGIN_LINK_LABEL = 'ログインしてコメント';

export const COMMENT_EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

export const COMMENTS_LOADING_LABEL = 'コメントを読み込み中';

export const COMMENTS_LOADING_MORE_LABEL = '続きを読み込み中';

export const COMMENT_POST_PLACEHOLDER =
  'このローンチへのコメントを書く(マークダウン対応)';

export const COMMENT_POST_SUBMIT_LABEL = 'コメントする';

export const COMMENT_REPLY_PLACEHOLDER = '返信を書く';

export const COMMENT_REPLY_SUBMIT_LABEL = '返信する';

export const COMMENT_EDIT_PLACEHOLDER = 'コメントを編集';

export const COMMENT_EDIT_SUBMIT_LABEL = '保存する';

export const COMMENT_CANCEL_LABEL = 'キャンセル';

export const COMMENT_RATING_ROW_LABEL = '評価(任意)';

export const COMMENT_RATING_INPUT_LABEL = 'このプロダクトの評価(任意)';

export const COMMENT_ACTIONS_MENU_LABEL = 'コメントの操作';

export const COMMENT_EDIT_LABEL = '編集';

export const COMMENT_DELETE_LABEL = '削除';

export const COMMENT_DELETE_CONFIRM_TITLE = 'コメントを削除しますか?';

export const COMMENT_DELETE_CONFIRM_DESCRIPTION =
  '削除したコメントは「このコメントは削除されました。」と表示され、付いている返信はそのまま残ります。';

export const COMMENT_POSTED_MESSAGE = 'コメントしました。';

export const COMMENT_WITH_RATING_POSTED_MESSAGE =
  'コメントと評価を投稿しました。';

export const COMMENT_REPLIED_MESSAGE = '返信しました。';

export const COMMENT_UPDATED_MESSAGE = 'コメントを更新しました。';

export const COMMENT_DELETED_MESSAGE = 'コメントを削除しました。';

export const commentLabelOf = (nickname: string): string =>
  `${nickname}さんのコメント`;

export const REMOVED_COMMENT_LABEL = '削除されたコメント';

export const REMOVED_COMMENT_MESSAGE = 'このコメントは削除されました。';

export const COMMENT_PRODUCT_OWNER_BADGE = '投稿者';

export const COMMENT_VIEWER_BADGE = 'あなた';

export const COMMENT_EDITED_MARK = '(編集済み)';

export const COMMENT_REPLY_LABEL = '返信';

export const COMMENT_REPLIES_LABEL = '返信';

export const COMMENT_LOGIN_REQUIRED_TITLE = 'コメントにはログインが必要です';

export const COMMENT_LOGIN_REQUIRED_DESCRIPTION =
  'ログインすると、ローンチごとにコメントや返信を投稿できます。';

export const COMMENTS_LOAD_ERROR_MESSAGE = 'コメントを読み込めませんでした。';

export const COMMENTS_LOAD_MORE_LABEL = 'さらに読み込む';

export const COMMENTS_EMPTY_TITLE = 'まだコメントはありません。';

export const launchCommentsLabel = (number: number): string =>
  `第${number.toString()}回ローンチへのコメント`;

export const COMMENTS_TOGGLE_LABEL = 'コメント';

// 数は表示設定で整えた文字列を受ける
export const commentCountLabel = (count: string): string => `${count}件`;

// 閲覧者の状態ごとに、最初のコメントへ促す一言
export const COMMENTS_EMPTY_HINTS: Readonly<
  Record<EngagementViewerKind, string>
> = Object.freeze({
  guest: 'ログインすると、最初のコメントを書けます。',
  unverified: 'メールアドレスを確認すると、最初のコメントを書けます。',
  owner: 'ローンチの背景や近況を書いて、サポーターに伝えましょう。',
  member: '感想や質問を最初に書いてみましょう。',
});
