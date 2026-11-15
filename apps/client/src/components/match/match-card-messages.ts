import type { UpvoteRestriction } from '../../graphql/generated/graphql.ts';

export const VERSUS_LABEL = 'VS';

export const matchCardLabel = (leftName: string, rightName: string): string =>
  `${leftName} vs ${rightName}`;

export const upvoteLabel = (productName: string): string =>
  `${productName}にUpvote`;

export const cancelUpvoteLabel = (productName: string): string =>
  `${productName}へのUpvoteを取り消す`;

// Upvoteのボタンを出さない側のUpvote数は、比率のバーの代替テキストと同じ「12票」の形で読ませる
export const VOTE_UNIT = '票';

// 未ログインの閲覧者はボタンを押せる状態で示し、押下でログインへ誘導するため理由を持たない
// APIサーバーが同じ理由で拒否するときの文言(apps/apiのsrc/application/match/match-errors.tsのMATCH_ERRORSのupvote_own_match・upvote_not_accepting・email_not_verified・account_unavailable)と同じにする。一致はルートのconfig/match-contract-copies.unit.test.tsが確かめる
export const UPVOTE_DISABLED_REASONS: Readonly<
  Record<Exclude<UpvoteRestriction, 'GUEST'>, string>
> = Object.freeze({
  OWN_MATCH: '自身のプロダクトとその対戦相手にはUpvoteできません。',
  NOT_ACCEPTING: 'このマッチはUpvoteを受け付けていません。',
  EMAIL_NOT_VERIFIED:
    'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
  ACCOUNT_UNAVAILABLE:
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
});
