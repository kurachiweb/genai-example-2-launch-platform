export const FOLLOW_LABEL = 'フォロー';

export const FOLLOWING_LABEL = 'フォロー中';

export const FOLLOW_LOGIN_REQUIRED_TITLE = 'フォローにはログインが必要です';

export const FOLLOW_LOGIN_REQUIRED_DESCRIPTION =
  'ログインすると、フォローしたユーザーのプロダクトがキックオフする日にメールでお知らせします。';

export const FOLLOW_EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

export const followedMessageOf = (handle: string): string =>
  `@${handle}をフォローしました。`;

export const unfollowedMessageOf = (handle: string): string =>
  `@${handle}のフォローを解除しました。`;

export const avatarLabelOf = (nickname: string): string =>
  `${nickname}のプロフィール画像`;
