import { API_KEY_NAME_MAX_GRAPHEMES } from '../../../common-lib/public-api/api-key-rules.ts';

const MAX = String(API_KEY_NAME_MAX_GRAPHEMES);

// 名前と権限の違反の文言は、APIサーバーの検証の文言(文言規則)と同じにする
export const API_KEY_FORM_MESSAGES = Object.freeze({
  issueTitle: 'APIキーを発行',
  editTitle: 'APIキーを編集',
  issueSubmit: '発行',
  editSubmit: '保存',
  cancel: 'キャンセル',
  nameLabel: '名前(必須)',
  nameDescription: `${MAX}文字以内で入力してください。`,
  nameCounterPrefix: '文字数',
  nameRequired: '名前を入力してください。',
  nameTooLong: `名前は${MAX}文字以内で入力してください。`,
  scopesHeading: '権限',
  scopesDescription:
    '機能ごとに、このキーで行える操作を選びます。読み書きはプロフィールとプロダクトの説明文だけで選べます。',
  scopeNotAllowed: '選べない権限が指定されています。',
  rateLimited: '操作が集中しています。しばらく待ってから再度お試しください。',
});

export const apiKeyNameCounterOf = (count: number): string =>
  `${String(count)}/${MAX}`;
