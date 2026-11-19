export const ISSUED_API_KEY_MESSAGES = Object.freeze({
  title: '新しいAPIキー',
  keyLabel: 'APIキー',
  storageNotice:
    'このキーは今しか表示されません。安全な場所に保管してください。',
  copy: 'コピー',
  close: '閉じる',
  copied: 'APIキーをコピーしました。',
  copyFailed: 'APIキーをコピーできませんでした。',
});

export const API_KEY_CONFIRM_MESSAGES = Object.freeze({
  deleteDescription: 'このキーを使った要求はすぐに使えなくなります。',
  deleteConfirm: '削除',
  reissueDescription:
    '同じ名前と権限の新しいキーを追加で発行します。今のキーはそのまま使えます。不要になったら削除してください。',
  reissueConfirm: '再発行',
});

export const deleteApiKeyTitleOf = (name: string): string =>
  `APIキー『${name}』を削除しますか?`;

export const reissueApiKeyTitleOf = (name: string): string =>
  `APIキー『${name}』を再発行しますか?`;
