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

export const PROFILE_EDIT_LABEL = 'プロフィールを編集';

export const PROFILE_SETUP_LABEL = 'プロフィールを設定';

export const PROFILE_COMPLETION_TITLE = 'プロフィールを充実させましょう';

export const PROFILE_COMPLETION_DESCRIPTION =
  '次の項目はまだ設定されていません。設定すると、このページを訪れた人にあなたのことが伝わります。';

export const PROFILE_COMPLETION_FIELDS: readonly string[] = Object.freeze([
  'プロフィール画像',
  'ヘッドライン',
  '自己紹介',
  '外部Webサイト',
]);

export const PROFILE_BIO_HEADING = '自己紹介';

export const PROFILE_WEBSITES_LABEL = '外部Webサイト';

export const NEW_TAB_NOTICE = '(新しいタブで開きます)';

export const FOLLOWER_LABEL = 'フォロワー';

export const FOLLOWER_UNIT = '人';

export const FOLLOWER_LINK_TITLE = 'フォロワー一覧を設定ページで見る';

export const ACTIONS_MENU_LABEL = 'その他の操作';

export const ULTRAS_AVATAR_LABEL = '加入中';

export const ULTRAS_AVATAR_TOOLTIP = 'プランでLaunch Stadiumを応援しています。';
